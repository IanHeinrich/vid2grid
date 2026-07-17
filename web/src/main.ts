import "./style.css";
import { els } from "./dom";
import { state } from "./state";
import { MODEL_RESOLUTION_PRESETS, CUSTOM_OPTION } from "./modelProfiles";
import { getVideoMetadata } from "./extractor";
import { generateCollages, type GenerationPhase } from "./core";
import { validateCollageRequest, type CollageRequest } from "./types";
import { updateFramePlanningUi } from "./ui/framePlanning";
import { resetGallery, renderGallery, initLightbox } from "./ui/gallery";
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
    els.resolutionCaption.textContent = `Using ${resolution}px — just below ${els.targetModelSelect.value}'s limit.`;
  }
  updateFramePlanningUi({ recomputeSuggestions: true });
}
els.targetModelSelect.addEventListener("change", updateResolutionUi);
updateResolutionUi();

els.jpegQualityInput.addEventListener("input", () => {
  els.jpegQualityValue.textContent = els.jpegQualityInput.value;
});

els.videoFileInput.addEventListener("change", () => {
  void handleVideoSelected();
});

async function handleVideoSelected(): Promise<void> {
  const file = els.videoFileInput.files?.[0] ?? null;
  state.videoFile = file;
  resetResults();
  if (!file) {
    state.videoDuration = 0;
    state.sourceAspect = 0;
    els.generateButton.disabled = true;
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
    return;
  }

  els.statusEl.textContent = "";
  state.videoDuration = metadata.duration;
  state.sourceAspect = metadata.width / metadata.height;
  const roundedDuration = Math.floor(metadata.duration * 10) / 10;
  els.startTimeInput.disabled = false;
  els.endTimeInput.disabled = false;
  els.startTimeInput.max = String(roundedDuration);
  els.endTimeInput.max = String(roundedDuration);
  els.startTimeInput.value = "0";
  els.endTimeInput.value = String(Math.max(roundedDuration, 0.1));
  els.generateButton.disabled = false;
  applyKeyframeModeAvailability(file);
  updateFramePlanningUi();
  void refreshKeyframeCount();
}

[els.startTimeInput, els.endTimeInput].forEach((input) =>
  input.addEventListener("input", () => {
    if (els.keyframeModeInput.checked) void refreshKeyframeCount();
    else updateFramePlanningUi({ recomputeSuggestions: true });
  }),
);
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

function resetResults(): void {
  resetGallery();
  els.emptyState.hidden = state.videoFile !== null;
}

function setProgress(fraction: number, text: string): void {
  els.progressContainer.hidden = false;
  els.progressBar.style.width = `${Math.round(fraction * 100)}%`;
  els.progressText.textContent = text;
}

function hideProgress(): void {
  els.progressContainer.hidden = true;
}

function progressLabel(phase: GenerationPhase): string {
  return phase === "extracting" ? "Extracting frames..." : "Rendering collage sheets...";
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

  try {
    const blobs = await generateCollages(config, {
      sourceAspect: state.sourceAspect || undefined,
      keyframeSampling: els.keyframeModeInput.checked,
      onProgress: (phase, done, total) => {
        const phaseWeight = phase === "extracting" ? 0.7 : 0.3;
        const phaseStart = phase === "extracting" ? 0 : 0.7;
        setProgress(phaseStart + (done / total) * phaseWeight, progressLabel(phase));
      },
      onTiming: (timings) => console.info("[vid2grid] timings", timings),
    });

    state.jpegBlobs = blobs;
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
  void downloadAllAsZip(state.jpegBlobs);
});

els.saveToFolderButton.addEventListener("click", () => {
  void handleSaveToFolderClicked();
});

async function handleSaveToFolderClicked(): Promise<void> {
  const folderName = buildGridsFolderName(state.videoFile?.name ?? "video");
  try {
    await saveAllToFolder(state.jpegBlobs, folderName);
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

