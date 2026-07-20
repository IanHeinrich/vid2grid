import { els } from "../dom";
import { state } from "../state";
import { GUTTER_PX } from "../rendering/renderer";
import {
  countGridPackingBlanks,
  estimateExtractedFrameCount,
  estimateSheetCount,
  suggestFramesPerGrid,
  type FramesPerGridSuggestion,
} from "../grid/frameSuggestions";

// Above this keyframe density (keyframes per second) the "fast" mode stops being
// meaningfully faster and starts producing far more grids than the user expects,
// so we surface a warning.
const KEYFRAME_DENSE_PER_SECOND = 2;

/**
 * Recomputes the frame count once and drives both the frames-per-grid hint and
 * the Generate button's live grid-image count from it. In normal mode the count
 * is estimated from Target FPS; in keyframe mode it's the real keyframe count
 * (state.keyframeCount, demuxed asynchronously) so the same suggestions and grid
 * count stay accurate.
 */
export function updateFramePlanningUi(options: { recomputeSuggestions?: boolean } = {}): void {
  const currentValue = Math.trunc(Number(els.framesPerGridInput.value));
  const outputResolution = Math.trunc(Number(els.outputResolutionInput.value));
  const keyframeMode = els.keyframeModeInput.checked;

  // In keyframe mode the count comes from the video's keyframes, demuxed async;
  // show a placeholder while pending, and a fallback note if it can't be read.
  if (keyframeMode && state.videoFile) {
    if (state.keyframeCounting) {
      renderCountingHint();
      els.generateButton.textContent = "Counting keyframes\u2026";
      return;
    }
    if (state.keyframeCount === null) {
      renderKeyframeUnavailableHint();
      els.generateButton.textContent = "Generate Grid Images";
      return;
    }
  }

  const totalFrames = keyframeMode
    ? state.keyframeCount ?? 0
    : state.videoFile
      ? estimateExtractedFrameCount(
          Number(els.startTimeInput.value),
          Number(els.endTimeInput.value),
          Number(els.targetFpsInput.value),
          state.videoDuration,
        )
      : 0;

  if (options.recomputeSuggestions ?? true) {
    state.cachedSuggestions =
      totalFrames > 0 && state.sourceAspect > 0
        ? suggestFramesPerGrid(totalFrames, currentValue, state.sourceAspect, outputResolution, GUTTER_PX)
        : [];
  }

  renderFramesPerGridHint(totalFrames, currentValue, outputResolution, keyframeMode);
  renderGenerateButtonLabel(totalFrames, currentValue);
}

function renderCountingHint(): void {
  const { framesPerGridHint } = els;
  framesPerGridHint.innerHTML = "";
  framesPerGridHint.hidden = false;
  const summary = document.createElement("div");
  summary.textContent = "Counting the video\u2019s keyframes\u2026";
  framesPerGridHint.appendChild(summary);
}

function renderKeyframeUnavailableHint(): void {
  const { framesPerGridHint } = els;
  framesPerGridHint.innerHTML = "";
  framesPerGridHint.hidden = false;
  const summary = document.createElement("div");
  summary.className = "frames-hint-status is-warning";
  summary.textContent =
    "Couldn\u2019t read this video\u2019s keyframes \u2014 turn off keyframe mode to sample by Target FPS.";
  framesPerGridHint.appendChild(summary);
}

function renderFramesPerGridHint(
  totalFrames: number,
  currentValue: number,
  outputResolution: number,
  keyframeMode: boolean,
): void {
  const { framesPerGridHint } = els;
  framesPerGridHint.innerHTML = "";
  if (totalFrames <= 0 || currentValue <= 0) {
    framesPerGridHint.hidden = true;
    return;
  }
  framesPerGridHint.hidden = false;

  const sheets = estimateSheetCount(totalFrames, currentValue);
  const summary = document.createElement("div");
  summary.textContent = keyframeMode
    ? `${totalFrames} keyframe(s) in range \u2192 ${totalFrames} frame(s), ${sheets} grid image(s). Target FPS is ignored.`
    : `About ${totalFrames} frame(s) will be sampled at these settings.`;
  framesPerGridHint.appendChild(summary);

  if (keyframeMode) {
    const rangeDuration = Number(els.endTimeInput.value) - Number(els.startTimeInput.value);
    const perSecond = rangeDuration > 0 ? totalFrames / rangeDuration : 0;
    if (perSecond >= KEYFRAME_DENSE_PER_SECOND) {
      const warning = document.createElement("div");
      warning.className = "frames-hint-status is-warning";
      warning.textContent =
        `Heads up: this video is keyframe-dense (~${perSecond.toFixed(1)}/s), so fast mode makes ` +
        `${sheets} grid image(s) and won\u2019t be much faster than normal sampling.`;
      framesPerGridHint.appendChild(warning);
    }
  }

  const wastedCells =
    state.sourceAspect > 0
      ? countGridPackingBlanks(currentValue, state.sourceAspect, outputResolution, GUTTER_PX)
      : null;
  const status = document.createElement("div");
  status.className = "frames-hint-status";
  if (wastedCells === 0) {
    status.classList.add("is-optimal");
    status.textContent = `\u2713 No wasted cells per grid at ${currentValue}.`;
  } else if (wastedCells === null) {
    status.textContent = `${currentValue} per grid \u2014 try:`;
  } else {
    status.textContent = `${currentValue} per grid wastes ${wastedCells} cell(s) in every grid \u2014 try:`;
  }
  framesPerGridHint.appendChild(status);

  const suggestions = state.cachedSuggestions.filter((s) => s.framesPerGrid !== currentValue);
  if (suggestions.length === 0) return;

  const chipRow = document.createElement("div");
  chipRow.className = "suggestion-chips";
  for (const suggestion of suggestions) {
    chipRow.appendChild(createSuggestionChip(suggestion));
  }
  framesPerGridHint.appendChild(chipRow);
}

function createSuggestionChip(suggestion: FramesPerGridSuggestion): HTMLButtonElement {
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
    els.framesPerGridInput.value = String(suggestion.framesPerGrid);
    updateFramePlanningUi({ recomputeSuggestions: false });
  });
  return chip;
}

function renderGenerateButtonLabel(totalFrames: number, currentValue: number): void {
  const sheetCount = estimateSheetCount(totalFrames, currentValue);
  els.generateButton.textContent =
    sheetCount === 0
      ? "Generate Grid Images"
      : `Generate ${sheetCount} Grid Image${sheetCount === 1 ? "" : "s"}`;
}
