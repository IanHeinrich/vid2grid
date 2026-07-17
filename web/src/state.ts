import type { FramesPerGridSuggestion } from "./frameSuggestions";

export const state = {
  videoFile: null as File | null,
  videoDuration: 0,
  sourceAspect: 0,
  jpegBlobs: [] as Blob[],
  galleryUrls: [] as string[],
  cachedSuggestions: [] as FramesPerGridSuggestion[],
};
