import type { AppElements } from "../dom";
import { isCurrentKeyframeRequest, setKeyframes, type AppState } from "../state";
import { readInteger, readNumber } from "../inputs";
import { toUserMessage } from "../errors";
import type { StatusLine } from "./status";
import {
  countGridPackingBlanks,
  CUSTOM_OPTION,
  estimateExtractedFrameCount,
  estimateSheetCount,
  GUTTER_PX,
  isKeyframeDense,
  keyframesPerSecond,
  MODEL_RESOLUTION_PRESETS,
  sourceAspect,
  suggestFramesPerGrid,
  type FramesPerGridSuggestion,
  type GridParams,
} from "@vid2grid/core";
import { countKeyframesInRange, supportsWebCodecs } from "@vid2grid/browser";

const WARNING_CLASS = "frames-hint-status is-warning";

export interface FramePlanPanel {
  render(): void;
  refresh(): void;
  applyVideo(file: File): void;
}

interface FramePlanContext {
  els: Pick<AppElements, "form" | "framePlan">;
  state: AppState;
  status: StatusLine;
  defaultGenerateLabel: string;
  suggestions: FramesPerGridSuggestion[];
  lastKeyframeRequestId: number;
}

interface PlanFigures {
  totalFrames: number;
  framesPerGrid: number;
  outputResolution: number;
  keyframeMode: boolean;
}

export function generateLabel(sheetCount: number, defaultLabel: string): string {
  if (sheetCount === 0) return defaultLabel;
  return `Generate ${sheetCount} Grid Image${sheetCount === 1 ? "" : "s"}`;
}

export function initFramePlanPanel(
  els: Pick<AppElements, "form" | "framePlan">,
  state: AppState,
  deps: { status: StatusLine },
): FramePlanPanel {
  const ctx: FramePlanContext = {
    els,
    state,
    status: deps.status,
    defaultGenerateLabel: els.framePlan.generateLabel.textContent ?? "",
    suggestions: [],
    lastKeyframeRequestId: 0,
  };
  const { form } = els;
  for (const name of [...Object.keys(MODEL_RESOLUTION_PRESETS), CUSTOM_OPTION]) {
    form.targetModelSelect.add(new Option(name, name));
  }
  form.targetModelSelect.addEventListener("change", () => onTargetModelChanged(ctx));
  for (const input of [form.targetFpsInput, form.framesPerGridInput, form.outputResolutionInput]) {
    input.addEventListener("input", () => render(ctx));
  }
  form.keyframeModeInput.addEventListener("change", () => {
    renderKeyframeMode(ctx);
    void refresh(ctx);
  });
  renderKeyframeMode(ctx);
  onTargetModelChanged(ctx);
  return {
    render: () => render(ctx),
    refresh: () => void refresh(ctx),
    applyVideo: (file) => applyVideo(ctx, file),
  };
}

function onTargetModelChanged(ctx: FramePlanContext): void {
  const { form, framePlan } = ctx.els;
  if (form.targetModelSelect.value === CUSTOM_OPTION) {
    framePlan.customResolutionField.style.display = "";
    framePlan.resolutionCaption.textContent = "";
  } else {
    framePlan.customResolutionField.style.display = "none";
    const resolution = MODEL_RESOLUTION_PRESETS[form.targetModelSelect.value];
    form.outputResolutionInput.value = String(resolution);
    framePlan.resolutionCaption.textContent = `${resolution}px (just under the model's limit)`;
  }
  render(ctx);
}

// Keyframe fast mode ignores Target FPS (the video's keyframes decide the frame count).
function renderKeyframeMode(ctx: FramePlanContext): void {
  const on = ctx.els.form.keyframeModeInput.checked;
  ctx.els.framePlan.targetFpsField.style.display = on ? "none" : "";
  ctx.els.framePlan.keyframeModeCaption.hidden = !on;
}

function applyVideo(ctx: FramePlanContext, file: File): void {
  const input = ctx.els.form.keyframeModeInput;
  const supported = supportsWebCodecs(file);
  input.disabled = !supported;
  if (!supported) input.checked = false;
  input.title = supported ? "" : "Keyframe fast mode is only available for MP4/MOV videos.";
  renderKeyframeMode(ctx);
  void refresh(ctx);
}

async function refresh(ctx: FramePlanContext): Promise<void> {
  const { state } = ctx;
  const { form } = ctx.els;
  const file = state.videoFile;
  if (!form.keyframeModeInput.checked || !file) {
    setKeyframes(state, { kind: "idle" });
    render(ctx);
    return;
  }

  const requestId = ++ctx.lastKeyframeRequestId;
  setKeyframes(state, { kind: "counting", requestId });
  render(ctx, { recomputeSuggestions: false });

  let count: number | null = null;
  let failure: string | null = null;
  try {
    count = await countKeyframesInRange(
      file,
      readNumber(form.startTimeInput),
      readNumber(form.endTimeInput),
    );
  } catch (err) {
    failure = toUserMessage(err);
  }

  if (!isCurrentKeyframeRequest(state.keyframes, requestId)) return;
  // Non-fatal: the hint offers Target FPS sampling instead, and status keeps the reason.
  if (failure) ctx.status.show(`Couldn't count keyframes: ${failure}`);
  setKeyframes(state, { kind: "ready", count });
  render(ctx);
}

// One frame count drives both the frames-per-grid hint and the Generate button label,
// so the two can never disagree.
function render(ctx: FramePlanContext, { recomputeSuggestions = true } = {}): void {
  const { form } = ctx.els;
  const keyframeMode = form.keyframeModeInput.checked;
  if (keyframeMode && ctx.state.videoFile && renderKeyframeCountPending(ctx)) return;

  const figures: PlanFigures = {
    totalFrames: plannedFrameCount(ctx, keyframeMode),
    framesPerGrid: readInteger(form.framesPerGridInput),
    outputResolution: readInteger(form.outputResolutionInput),
    keyframeMode,
  };
  if (recomputeSuggestions) ctx.suggestions = computeSuggestions(ctx, figures);
  renderFramesPerGridHint(ctx, figures);
  ctx.els.framePlan.generateLabel.textContent = generateLabel(
    estimateSheetCount(figures.totalFrames, figures.framesPerGrid),
    ctx.defaultGenerateLabel,
  );
}

function renderKeyframeCountPending(ctx: FramePlanContext): boolean {
  const { keyframes } = ctx.state;
  const label = ctx.els.framePlan.generateLabel;
  if (keyframes.kind === "counting") {
    renderHintMessage(ctx, "Counting the video\u2019s keyframes\u2026");
    label.textContent = "Counting keyframes\u2026";
    return true;
  }
  if (keyframes.kind === "idle" || keyframes.count === null) {
    renderHintMessage(
      ctx,
      "Couldn\u2019t read this video\u2019s keyframes \u2014 turn off keyframe mode to sample by Target FPS.",
      WARNING_CLASS,
    );
    label.textContent = ctx.defaultGenerateLabel;
    return true;
  }
  return false;
}

function plannedFrameCount(ctx: FramePlanContext, keyframeMode: boolean): number {
  const { state } = ctx;
  const { form } = ctx.els;
  if (keyframeMode) return state.keyframes.kind === "ready" ? (state.keyframes.count ?? 0) : 0;
  if (!state.videoFile) return 0;
  const durationSeconds = state.videoInfo?.durationSeconds;
  return estimateExtractedFrameCount({
    startSeconds: readNumber(form.startTimeInput),
    endSeconds: readNumber(form.endTimeInput),
    targetFps: readNumber(form.targetFpsInput),
    ...(durationSeconds !== undefined && { durationSeconds }),
  });
}

// No grid until a probed video gives a usable aspect ratio.
function gridParams(state: AppState, outputResolution: number): GridParams | null {
  const info = state.videoInfo;
  if (!info || !(info.width > 0) || !(info.height > 0)) return null;
  return { sourceAspect: sourceAspect(info), outputResolution, gutterPx: GUTTER_PX };
}

function computeSuggestions(
  ctx: FramePlanContext,
  figures: PlanFigures,
): FramesPerGridSuggestion[] {
  const grid = gridParams(ctx.state, figures.outputResolution);
  if (figures.totalFrames <= 0 || !grid) return [];
  return suggestFramesPerGrid({
    totalFrames: figures.totalFrames,
    currentValue: figures.framesPerGrid,
    grid,
  });
}

function renderHintMessage(ctx: FramePlanContext, text: string, className?: string): void {
  const hint = ctx.els.framePlan.framesPerGridHint;
  hint.innerHTML = "";
  hint.hidden = false;
  hint.appendChild(hintLine(text, className));
}

function hintLine(text: string, className?: string): HTMLDivElement {
  const line = document.createElement("div");
  if (className) line.className = className;
  line.textContent = text;
  return line;
}

function renderFramesPerGridHint(ctx: FramePlanContext, figures: PlanFigures): void {
  const hint = ctx.els.framePlan.framesPerGridHint;
  const { totalFrames, framesPerGrid, keyframeMode } = figures;
  hint.innerHTML = "";
  if (totalFrames <= 0 || framesPerGrid <= 0) {
    hint.hidden = true;
    return;
  }
  hint.hidden = false;

  const sheets = estimateSheetCount(totalFrames, framesPerGrid);
  hint.appendChild(
    hintLine(
      keyframeMode
        ? `${totalFrames} keyframe(s) in range \u2192 ${totalFrames} frame(s), ${sheets} grid image(s). Target FPS is ignored.`
        : `About ${totalFrames} frame(s) will be sampled at these settings.`,
    ),
  );
  if (keyframeMode) appendDensityWarning(ctx, totalFrames, sheets);
  hint.appendChild(packingStatusLine(ctx, figures));

  const suggestions = ctx.suggestions.filter((s) => s.framesPerGrid !== framesPerGrid);
  if (suggestions.length === 0) return;
  const chipRow = document.createElement("div");
  chipRow.className = "suggestion-chips";
  for (const suggestion of suggestions) {
    chipRow.appendChild(createSuggestionChip(ctx, suggestion));
  }
  hint.appendChild(chipRow);
}

function appendDensityWarning(ctx: FramePlanContext, totalFrames: number, sheets: number): void {
  const { form, framePlan } = ctx.els;
  const rangeSeconds = readNumber(form.endTimeInput) - readNumber(form.startTimeInput);
  if (!isKeyframeDense(totalFrames, rangeSeconds)) return;
  const perSecond = keyframesPerSecond(totalFrames, rangeSeconds);
  framePlan.framesPerGridHint.appendChild(
    hintLine(
      `Heads up: this video is keyframe-dense (~${perSecond.toFixed(1)}/s), so fast mode makes ` +
        `${sheets} grid image(s) and won\u2019t be much faster than normal sampling.`,
      WARNING_CLASS,
    ),
  );
}

function packingStatusLine(ctx: FramePlanContext, figures: PlanFigures): HTMLDivElement {
  const { framesPerGrid, outputResolution } = figures;
  const grid = gridParams(ctx.state, outputResolution);
  const wastedCells = grid ? countGridPackingBlanks(framesPerGrid, grid) : null;
  const status = hintLine("", "frames-hint-status");
  if (wastedCells === 0) {
    status.classList.add("is-optimal");
    status.textContent = `\u2713 No wasted cells per grid at ${framesPerGrid}.`;
  } else if (wastedCells === null) {
    status.textContent = `${framesPerGrid} per grid \u2014 try:`;
  } else {
    status.textContent = `${framesPerGrid} per grid wastes ${wastedCells} cell(s) in every grid \u2014 try:`;
  }
  return status;
}

function createSuggestionChip(
  ctx: FramePlanContext,
  suggestion: FramesPerGridSuggestion,
): HTMLButtonElement {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "suggestion-chip";
  if (suggestion.wastedCells === 0) {
    chip.classList.add("is-exact");
    chip.textContent = `\u2713 ${suggestion.framesPerGrid}`;
  } else {
    chip.textContent = `${suggestion.framesPerGrid} (${suggestion.wastedCells} wasted)`;
  }
  chip.addEventListener("click", () => {
    ctx.els.form.framesPerGridInput.value = String(suggestion.framesPerGrid);
    render(ctx, { recomputeSuggestions: false });
  });
  return chip;
}
