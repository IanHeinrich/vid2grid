import type { FramesPerGridSuggestion } from "./grid/frameSuggestions";
import type { TranscriptFile } from "./core";

export const state = {
  videoFile: null as File | null,
  videoDuration: 0,
  sourceAspect: 0,
  jpegBlobs: [] as Blob[],
  transcriptFiles: [] as TranscriptFile[],
  galleryUrls: [] as string[],
  previewUrl: null as string | null,
  cachedSuggestions: [] as FramesPerGridSuggestion[],
  keyframeCount: null as number | null,
  keyframeCounting: false,
};
