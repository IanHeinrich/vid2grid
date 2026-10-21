import type { FramesPerGridSuggestion, GeneratedFile, VideoInfo } from "@vid2grid/core";

export const state = {
  videoFile: null as File | null,
  videoInfo: null as VideoInfo | null,
  sheets: [] as GeneratedFile<Blob>[],
  transcriptFiles: [] as GeneratedFile<Blob>[],
  galleryUrls: [] as string[],
  previewUrl: null as string | null,
  cachedSuggestions: [] as FramesPerGridSuggestion[],
  keyframeCount: null as number | null,
  keyframeCounting: false,
};
