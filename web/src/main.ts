import "./style.css";
import { els } from "./dom";
import { state } from "./state";
import { MODEL_RESOLUTION_PRESETS, CUSTOM_OPTION } from "./modelProfiles";
import { getVideoMetadata } from "./extractor";
import { generateCollages, canvasToJpegBlob, type GenerationPhase } from "./core";
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
  updateFramePlanningUi();
}

[els.startTimeInput, els.endTimeInput, els.targetFpsInput, els.framesPerGridInput].forEach(
  (input) => {
    input.addEventListener("input", () => updateFramePlanningUi({ recomputeSuggestions: true }));
  },
);
els.outputResolutionInput.addEventListener("input", () =>
  updateFramePlanningUi({ recomputeSuggestions: true }),
);

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
    const collages = await generateCollages(config, {
      onProgress: (phase, done, total) => {
        const phaseWeight = phase === "extracting" ? 0.7 : 0.3;
        const phaseStart = phase === "extracting" ? 0 : 0.7;
        setProgress(phaseStart + (done / total) * phaseWeight, progressLabel(phase));
      },
    });

    state.jpegBlobs = await Promise.all(
      collages.map((canvas) => canvasToJpegBlob(canvas, config.jpegQuality)),
    );
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

