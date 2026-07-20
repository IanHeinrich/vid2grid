import "./style.css";
import { els } from "./dom";
import { state } from "./state";
import { MODEL_RESOLUTION_PRESETS, CUSTOM_OPTION } from "./modelProfiles";
import { getVideoMetadata } from "./extractor";
import { generateCollages, type GenerationPhase } from "./core";
import { validateCollageRequest, type CollageRequest } from "./types";
import { updateFramePlanningUi } from "./ui/framePlanning";
import { resetGallery, renderGallery, initLightbox } from "./ui/gallery";
import {
  initRangeSlider,
  setRangeBounds,
  setRangeValues,
  disableRangeSlider,
  type HandlePosition,
} from "./ui/rangeSlider";
import { downloadAllAsZip, saveAllToFolder, isFolderSaveSupported, buildGridsFolderName } from "./download";

initLightbox();

for (const modelName of Object.keys(MODEL_RESOLUTION_PRESETS)) {
  const option = document.createElement("option");
  option.value = modelName;
  option.textContent = modelName;
  els.targetModelSelect.appendChild(option);
}
const customOption = document.createElement("option");
customOption.value = CUSTOM_OPTION;
customOption.textContent = CUSTOM_OPTION;
els.targetModelSelect.appendChild(customOption);

function updateResolutionUi(): void {
  if (els.targetModelSelect.value === CUSTOM_OPTION) {
    els.customResolutionField.style.display = "";
    els.resolutionCaption.textContent = "";
  } else {
    els.customResolutionField.style.display = "none";
    const resolution = MODEL_RESOLUTION_PRESETS[els.targetModelSelect.value];
    els.outputResolutionInput.value = String(resolution);
    els.resolutionCaption.textContent = `${resolution}px (just under the model's limit)`;
  }
  updateFramePlanningUi({ recomputeSuggestions: true });
}
els.targetModelSelect.addEventListener("change", updateResolutionUi);
updateResolutionUi();

els.jpegQualityInput.addEventListener("input", () => {
  els.jpegQualityValue.textContent = els.jpegQualityInput.value;
});

els.videoFileInput.addEventListener("change", () => {
  void handleFile(els.videoFileInput.files?.[0] ?? null);
});

// Drag-and-drop onto the file dropzone, plus a document-level guard so a stray
// drop anywhere else doesn't make the browser navigate away to the file.
["dragenter", "dragover"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("is-dragover");
  }),
);
["dragleave", "dragend", "drop"].forEach((evt) =>
  els.dropzone.addEventListener(evt, () => els.dropzone.classList.remove("is-dragover")),
);
els.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = (event as DragEvent).dataTransfer?.files?.[0] ?? null;
  if (file) void handleFile(file);
});
["dragover", "drop"].forEach((evt) =>
  document.addEventListener(evt, (event) => event.preventDefault()),
);

// The preview element stays in the DOM with its src loaded (so scrub seeks are
// instant) but is only shown as a floating overlay while a handle is grabbed.
function setPreview(file: File | null): void {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  els.videoPreview.classList.remove("is-scrubbing");
  if (file) {
    state.previewUrl = URL.createObjectURL(file);
    els.videoPreview.src = state.previewUrl;
  } else {
    els.videoPreview.removeAttribute("src");
    els.videoPreview.load();
  }
}

async function handleFile(file: File | null): Promise<void> {
  state.videoFile = file;
  els.dropzoneFilename.textContent = file?.name ?? "";
  els.dropzoneFilename.hidden = !file;
  setPreview(file);
  resetResults();
  if (!file) {
    state.videoDuration = 0;
    state.sourceAspect = 0;
    els.generateButton.disabled = true;
    disableRangeSlider();
    updateFramePlanningUi();
    return;
  }

  els.statusEl.textContent = "Reading video metadata...";
  let metadata: { duration: number; width: number; height: number };
  try {
    metadata = await getVideoMetadata(file);
  } catch (err) {
    els.statusEl.textContent = `Failed to read video: ${(err as Error).message}`;
    els.generateButton.disabled = true;
    disableRangeSlider();
    setPreview(null);
    return;
  }

  els.statusEl.textContent = "";
  state.videoDuration = metadata.duration;
  state.sourceAspect = metadata.width / metadata.height;
  const roundedDuration = Math.floor(metadata.duration * 10) / 10;
  const end = Math.max(roundedDuration, 0.1);
  els.startTimeInput.disabled = false;
  els.endTimeInput.disabled = false;
  els.startTimeInput.max = String(roundedDuration);
  els.endTimeInput.max = String(roundedDuration);
  els.startTimeInput.value = "0";
  els.endTimeInput.value = String(end);
  setRangeBounds(roundedDuration);
  setRangeValues(0, end);
  els.generateButton.disabled = false;
  applyKeyframeModeAvailability(file);
  updateFramePlanningUi();
  void refreshKeyframeCount();
}

const MIN_RANGE_GAP = 0.1;
const PREVIEW_MARGIN = 10;

function seekPreview(seconds: number): void {
  if (state.previewUrl && !Number.isNaN(seconds)) {
    els.videoPreview.currentTime = Math.min(Math.max(0, seconds), state.videoDuration);
  }
}

// Float the preview above the grabbed handle, clamped to stay on screen.
function positionPreview(pos: HandlePosition): void {
  const width = els.videoPreview.offsetWidth || 200;
  const height = els.videoPreview.offsetHeight || 120;
  const left = Math.max(
    PREVIEW_MARGIN,
    Math.min(pos.centerX - width / 2, window.innerWidth - width - PREVIEW_MARGIN),
  );
  const above = pos.sliderTop - height - PREVIEW_MARGIN;
  const top = above >= PREVIEW_MARGIN ? above : pos.sliderBottom + PREVIEW_MARGIN;
  els.videoPreview.style.left = `${left}px`;
  els.videoPreview.style.top = `${top}px`;
}

// Frame-planning + keyframe-count both key off the current start/end, so any
// change to the range funnels through here.
function refreshFramePlanning(): void {
  if (els.keyframeModeInput.checked) void refreshKeyframeCount();
  else updateFramePlanningUi({ recomputeSuggestions: true });
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const numberOr = (raw: string, fallback: number): number => {
  const value = Number(raw);
  return Number.isNaN(value) ? fallback : value;
};

// A handle is being dragged/keyed: enforce start < end, write the moved
// boundary back into its number input (the source of truth), and show the
// floating preview at that frame.
function onScrub(which: "start" | "end", seconds: number, pos: HandlePosition): void {
  const duration = state.videoDuration || 0;
  let start = numberOr(els.startTimeInput.value, 0);
  let end = numberOr(els.endTimeInput.value, duration);
  if (which === "start") {
    start = round1(Math.min(Math.max(0, seconds), Math.max(0, end - MIN_RANGE_GAP)));
    els.startTimeInput.value = String(start);
  } else {
    end = round1(Math.max(Math.min(duration, seconds), start + MIN_RANGE_GAP));
    els.endTimeInput.value = String(end);
  }
  setRangeValues(start, end);
  refreshFramePlanning();

  if (state.previewUrl) {
    els.videoPreview.classList.add("is-scrubbing");
    seekPreview(which === "start" ? start : end);
    positionPreview(pos);
  }
}

function onScrubEnd(): void {
  els.videoPreview.classList.remove("is-scrubbing");
}
initRangeSlider({ onScrub, onScrubEnd });

// Typing into a number input reflects onto the slider without rewriting the
// field mid-keystroke (validation still guards start < end).
function onNumberInput(): void {
  const start = numberOr(els.startTimeInput.value, 0);
  const end = numberOr(els.endTimeInput.value, state.videoDuration || 0);
  setRangeValues(start, end);
  refreshFramePlanning();
}
els.startTimeInput.addEventListener("input", onNumberInput);
els.endTimeInput.addEventListener("input", onNumberInput);
[els.targetFpsInput, els.framesPerGridInput].forEach((input) =>
  input.addEventListener("input", () => updateFramePlanningUi({ recomputeSuggestions: true })),
);
els.outputResolutionInput.addEventListener("input", () =>
  updateFramePlanningUi({ recomputeSuggestions: true }),
);
els.keyframeModeInput.addEventListener("change", () => {
  updateKeyframeModeUi();
  void refreshKeyframeCount();
});
updateKeyframeModeUi();

// The "combined transcript" checkbox is only meaningful once transcript
// generation itself is switched on.
function updateTranscriptModeUi(): void {
  els.transcriptCombinedField.hidden = !els.transcriptModeInput.checked;
}
els.transcriptModeInput.addEventListener("change", updateTranscriptModeUi);
updateTranscriptModeUi();

function resetResults(): void {
  resetGallery();
  els.emptyState.hidden = state.videoFile !== null;
}

function setProgress(fraction: number, text: string): void {
  const percent = Math.round(fraction * 100);
  els.progressContainer.hidden = false;
  els.progressBar.style.width = `${percent}%`;
  els.progressText.textContent = `${text} ${percent}%`;
}

function hideProgress(): void {
  els.progressContainer.hidden = true;
}

function progressLabel(phase: GenerationPhase, transcribeStage?: "model" | "transcribe"): string {
  if (phase === "extracting") return "Extracting frames...";
  if (phase === "rendering") return "Rendering collage sheets...";
  if (transcribeStage === "model") return "Downloading speech model (first use only)...";
  return "Transcribing audio...";
}

// Keyframe fast mode ignores Target FPS (the video's keyframes decide the frame
// count), so hide that field and surface the explanation while it's on.
function updateKeyframeModeUi(): void {
  const on = els.keyframeModeInput.checked;
  els.targetFpsField.style.display = on ? "none" : "";
  els.keyframeModeCaption.hidden = !on;
}

// Keyframe mode only runs on the WebCodecs (ISO-BMFF) path, so it's offered only
// for MP4/MOV. Mirrors looksLikeIsoBmff without importing webcodecsExtractor here
// (which would pull mp4box into the main bundle).
function fileSupportsKeyframeMode(file: File): boolean {
  if (typeof VideoDecoder === "undefined") return false;
  const name = file.name.toLowerCase();
  return (
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    name.endsWith(".mp4") ||
    name.endsWith(".m4v") ||
    name.endsWith(".mov")
  );
}

function applyKeyframeModeAvailability(file: File): void {
  const supported = fileSupportsKeyframeMode(file);
  els.keyframeModeInput.disabled = !supported;
  if (!supported) els.keyframeModeInput.checked = false;
  els.keyframeModeInput.title = supported ? "" : "Keyframe fast mode is only available for MP4/MOV videos.";
  updateKeyframeModeUi();
}

// Demuxes (cached) to count the selected range's keyframes so the planning UI can
// show the real frame/grid count and warn on keyframe-dense videos. The token
// guards against out-of-order resolutions when the file or range changes quickly.
let keyframeCountToken = 0;
async function refreshKeyframeCount(): Promise<void> {
  const token = ++keyframeCountToken;
  if (!els.keyframeModeInput.checked || !state.videoFile) {
    state.keyframeCounting = false;
    state.keyframeCount = null;
    updateFramePlanningUi({ recomputeSuggestions: true });
    return;
  }

  const file = state.videoFile;
  const start = Number(els.startTimeInput.value);
  const end = Number(els.endTimeInput.value);

  state.keyframeCounting = true;
  state.keyframeCount = null;
  updateFramePlanningUi({ recomputeSuggestions: false });

  let count: number | null = null;
  try {
    const { countKeyframesInRange } = await import("./webcodecsExtractor");
    count = await countKeyframesInRange(file, start, end);
  } catch {
    count = null;
  }

  if (token !== keyframeCountToken) return;
  state.keyframeCounting = false;
  state.keyframeCount = count;
  updateFramePlanningUi({ recomputeSuggestions: true });
}

els.generateButton.addEventListener("click", () => {
  void handleGenerateClicked();
});

async function handleGenerateClicked(): Promise<void> {
  if (!state.videoFile) return;
  resetResults();
  els.generateButton.disabled = true;
  els.statusEl.textContent = "";

  const config: CollageRequest = {
    videoFile: state.videoFile,
    startTime: Number(els.startTimeInput.value),
    endTime: Number(els.endTimeInput.value),
    targetFps: Number(els.targetFpsInput.value),
    framesPerGrid: Math.trunc(Number(els.framesPerGridInput.value)),
    outputResolution: Math.trunc(Number(els.outputResolutionInput.value)),
    jpegQuality: Math.trunc(Number(els.jpegQualityInput.value)),
  };

  try {
    validateCollageRequest(config);
  } catch (err) {
    els.statusEl.textContent = (err as Error).message;
    els.generateButton.disabled = false;
    return;
  }

  const transcriptOn = els.transcriptModeInput.checked;
  const phaseWeights = transcriptOn
    ? { extracting: 0.5, rendering: 0.2, transcribing: 0.3 }
    : { extracting: 0.7, rendering: 0.3, transcribing: 0 };
  const phaseStarts = {
    extracting: 0,
    rendering: phaseWeights.extracting,
    transcribing: phaseWeights.extracting + phaseWeights.rendering,
  };

  try {
    const { sheets, transcriptFiles } = await generateCollages(config, {
      sourceAspect: state.sourceAspect || undefined,
      keyframeSampling: els.keyframeModeInput.checked,
      transcript: transcriptOn
        ? { scope: els.transcriptCombinedInput.checked ? "combined" : "per-sheet" }
        : undefined,
      onProgress: (phase, done, total, transcribeStage) => {
        setProgress(
          phaseStarts[phase] + (done / total) * phaseWeights[phase],
          progressLabel(phase, transcribeStage),
        );
      },
      onWarning: (message) => {
        els.statusEl.textContent = message;
      },
      onTiming: (timings) => console.info("[vid2grid] timings", timings),
    });

    state.jpegBlobs = sheets;
    state.transcriptFiles = transcriptFiles;
    renderGallery();
    els.saveToFolderButton.hidden = !isFolderSaveSupported();
  } catch (err) {
    els.statusEl.textContent = `Failed to generate collages: ${(err as Error).message}`;
  } finally {
    hideProgress();
    els.generateButton.disabled = false;
  }
}

els.downloadAllButton.addEventListener("click", () => {
  void downloadAllAsZip(state.jpegBlobs, state.transcriptFiles);
});

els.saveToFolderButton.addEventListener("click", () => {
  void handleSaveToFolderClicked();
});

async function handleSaveToFolderClicked(): Promise<void> {
  const folderName = buildGridsFolderName(state.videoFile?.name ?? "video");
  try {
    await saveAllToFolder(state.jpegBlobs, folderName, state.transcriptFiles);
    els.statusEl.textContent = `Saved ${state.jpegBlobs.length} image(s) to "${folderName}" inside the folder you chose.`;
  } catch (err) {
    const name = (err as DOMException).name;
    if (name === "AbortError") return;
    if (name === "SecurityError" || name === "NotAllowedError") {
      els.statusEl.textContent =
        "Your browser blocked folder access. In Brave, try lowering Shields' fingerprinting protection for this site, or use Chrome/Edge instead.";
      return;
    }
    els.statusEl.textContent = `Failed to save to folder: ${(err as Error).message}`;
  }
}

