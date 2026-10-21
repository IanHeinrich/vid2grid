import { describe, expect, it } from "vitest";
import type { GenerationResults } from "../src/state";
import {
  createAppState,
  isCurrentKeyframeRequest,
  setGenerating,
  setKeyframes,
  setResults,
  setVideoFile,
  setVideoInfo,
} from "../src/state";

const results = { plan: {}, sheets: [], transcriptFiles: [] } as unknown as GenerationResults;

describe("createAppState", () => {
  it("starts with no video, idle keyframes and no results", () => {
    expect(createAppState()).toEqual({
      videoFile: null,
      videoInfo: null,
      keyframes: { kind: "idle" },
      results: null,
      generating: false,
    });
  });
});

describe("setVideoFile", () => {
  it("clears everything derived from the previous video", () => {
    const state = createAppState();
    setVideoInfo(state, { durationSeconds: 12, width: 1920, height: 1080 });
    setKeyframes(state, { kind: "ready", count: 4 });
    setResults(state, results);

    const file = new File([], "clip.mp4");
    setVideoFile(state, file);

    expect(state.videoFile).toBe(file);
    expect(state.videoInfo).toBeNull();
    expect(state.keyframes).toEqual({ kind: "idle" });
    expect(state.results).toBeNull();
  });
});

describe("keyframe status", () => {
  it("moves from idle to counting to ready", () => {
    const state = createAppState();
    setKeyframes(state, { kind: "counting", requestId: 1 });
    expect(isCurrentKeyframeRequest(state.keyframes, 1)).toBe(true);

    setKeyframes(state, { kind: "ready", count: 7 });
    expect(state.keyframes).toEqual({ kind: "ready", count: 7 });
  });

  it("treats a superseded request as stale", () => {
    const state = createAppState();
    setKeyframes(state, { kind: "counting", requestId: 1 });
    setKeyframes(state, { kind: "counting", requestId: 2 });
    expect(isCurrentKeyframeRequest(state.keyframes, 1)).toBe(false);
    expect(isCurrentKeyframeRequest(state.keyframes, 2)).toBe(true);
  });

  it("treats a request as stale once counting stops", () => {
    const state = createAppState();
    setKeyframes(state, { kind: "counting", requestId: 3 });
    setKeyframes(state, { kind: "idle" });
    expect(isCurrentKeyframeRequest(state.keyframes, 3)).toBe(false);
  });

  it("keeps an unreadable count as null", () => {
    const state = createAppState();
    setKeyframes(state, { kind: "ready", count: null });
    expect(state.keyframes).toEqual({ kind: "ready", count: null });
  });
});

describe("setResults and setGenerating", () => {
  it("stores and clears results", () => {
    const state = createAppState();
    setResults(state, results);
    expect(state.results).toBe(results);
    setResults(state, null);
    expect(state.results).toBeNull();
  });

  it("toggles the generating flag", () => {
    const state = createAppState();
    setGenerating(state, true);
    expect(state.generating).toBe(true);
    setGenerating(state, false);
    expect(state.generating).toBe(false);
  });
});
