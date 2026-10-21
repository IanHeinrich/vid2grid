import type { GeneratedFile, RenderPlan, VideoInfo } from "@vid2grid/core";

export type KeyframeStatus =
  | { kind: "idle" }
  | { kind: "counting"; requestId: number }
  | { kind: "ready"; count: number | null };

export interface GenerationResults {
  plan: RenderPlan;
  sheets: GeneratedFile<Blob>[];
  transcriptFiles: GeneratedFile<Blob>[];
}

// Readonly to every other module, so the setters below are the only writers.
export interface AppState {
  readonly videoFile: File | null;
  readonly videoInfo: VideoInfo | null;
  readonly keyframes: KeyframeStatus;
  readonly results: GenerationResults | null;
  readonly generating: boolean;
}

type WritableAppState = { -readonly [K in keyof AppState]: AppState[K] };

export function createAppState(): AppState {
  return {
    videoFile: null,
    videoInfo: null,
    keyframes: { kind: "idle" },
    results: null,
    generating: false,
  };
}

export function setVideoFile(state: WritableAppState, file: File | null): void {
  state.videoFile = file;
  state.videoInfo = null;
  state.keyframes = { kind: "idle" };
  state.results = null;
}

export function setVideoInfo(state: WritableAppState, info: VideoInfo | null): void {
  state.videoInfo = info;
}

export function setKeyframes(state: WritableAppState, keyframes: KeyframeStatus): void {
  state.keyframes = keyframes;
}

export function isCurrentKeyframeRequest(keyframes: KeyframeStatus, requestId: number): boolean {
  return keyframes.kind === "counting" && keyframes.requestId === requestId;
}

export function setResults(state: WritableAppState, results: GenerationResults | null): void {
  state.results = results;
}

export function setGenerating(state: WritableAppState, generating: boolean): void {
  state.generating = generating;
}
