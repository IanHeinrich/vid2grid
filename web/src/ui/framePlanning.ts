import { els } from "../dom";
import { state } from "../state";
import { GUTTER_PX } from "../renderer";
import {
  countGridPackingBlanks,
  estimateExtractedFrameCount,
  estimateSheetCount,
  suggestFramesPerGrid,
  type FramesPerGridSuggestion,
} from "../frameSuggestions";

/**
 * Recomputes the sampled frame count once and drives both the frames-per-grid
 * hint and the Generate button's live grid-image count from it - both are
 * cheap (just arithmetic on the estimated frame count, no video decoding).
 */
export function updateFramePlanningUi(options: { recomputeSuggestions?: boolean } = {}): void {
  const currentValue = Math.trunc(Number(els.framesPerGridInput.value));
  const outputResolution = Math.trunc(Number(els.outputResolutionInput.value));
  const totalFrames = state.videoFile
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

  renderFramesPerGridHint(totalFrames, currentValue, outputResolution);
  renderGenerateButtonLabel(totalFrames, currentValue);
}

function renderFramesPerGridHint(
  totalFrames: number,
  currentValue: number,
  outputResolution: number,
): void {
  const { framesPerGridHint } = els;
  framesPerGridHint.innerHTML = "";
  if (totalFrames <= 0 || currentValue <= 0) {
    framesPerGridHint.hidden = true;
    return;
  }
  framesPerGridHint.hidden = false;

  const summary = document.createElement("div");
  summary.textContent = `About ${totalFrames} frame(s) will be sampled at these settings.`;
  framesPerGridHint.appendChild(summary);

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
