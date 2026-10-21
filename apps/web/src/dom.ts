function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing or mistyped element: #${id}`);
  return el;
}

function queryFormElements() {
  return {
    startTimeInput: byId("startTime", HTMLInputElement),
    endTimeInput: byId("endTime", HTMLInputElement),
    targetFpsInput: byId("targetFps", HTMLInputElement),
    framesPerGridInput: byId("framesPerGrid", HTMLInputElement),
    targetModelSelect: byId("targetModel", HTMLSelectElement),
    outputResolutionInput: byId("outputResolution", HTMLInputElement),
    keyframeModeInput: byId("keyframeMode", HTMLInputElement),
    transcriptModeInput: byId("transcriptMode", HTMLInputElement),
    transcriptCombinedInput: byId("transcriptCombinedMode", HTMLInputElement),
    jpegQualityInput: byId("jpegQuality", HTMLInputElement),
  };
}

export function queryElements() {
  return {
    form: queryFormElements(),
    preview: {
      videoFileInput: byId("videoFile", HTMLInputElement),
      dropzone: byId("dropzone", HTMLElement),
      dropzoneFilename: byId("dropzoneFilename", HTMLElement),
      videoPreview: byId("videoPreview", HTMLVideoElement),
    },
    rangeSlider: {
      startRange: byId("startRange", HTMLInputElement),
      endRange: byId("endRange", HTMLInputElement),
      rangeFill: byId("rangeFill", HTMLElement),
      rangeMinLabel: byId("rangeMinLabel", HTMLElement),
      rangeMaxLabel: byId("rangeMaxLabel", HTMLElement),
    },
    framePlan: {
      targetFpsField: byId("targetFpsField", HTMLElement),
      keyframeModeCaption: byId("keyframeModeCaption", HTMLElement),
      framesPerGridHint: byId("framesPerGridHint", HTMLElement),
      customResolutionField: byId("customResolutionField", HTMLElement),
      resolutionCaption: byId("resolutionCaption", HTMLElement),
      generateLabel: byId("generateLabel", HTMLElement),
    },
    generate: {
      generateButton: byId("generateButton", HTMLButtonElement),
      jpegQualityValue: byId("jpegQualityValue", HTMLElement),
      transcriptCombinedField: byId("transcriptCombinedField", HTMLElement),
      progressContainer: byId("progressContainer", HTMLElement),
      progressBar: byId("progressBar", HTMLElement),
      progressText: byId("progressText", HTMLElement),
    },
    status: {
      message: byId("status", HTMLElement),
    },
    gallery: {
      emptyState: byId("emptyState", HTMLElement),
      resultsHeader: byId("resultsHeader", HTMLElement),
      resultsCount: byId("resultsCount", HTMLElement),
      grid: byId("gallery", HTMLElement),
      lightbox: byId("lightbox", HTMLElement),
      lightboxImage: byId("lightboxImage", HTMLImageElement),
      lightboxClose: byId("lightboxClose", HTMLButtonElement),
    },
    save: {
      downloadAllButton: byId("downloadAllButton", HTMLButtonElement),
      saveToFolderButton: byId("saveToFolderButton", HTMLButtonElement),
    },
  };
}

export type AppElements = ReturnType<typeof queryElements>;
export type FormElements = ReturnType<typeof queryFormElements>;
