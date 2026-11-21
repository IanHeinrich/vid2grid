import { describe, expect, it, vi } from "vitest";
import { turnAudio, type TurnAudioInput } from "../src/audio/turnAudio";
import { createMemoryStore } from "../src/chat/store";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { VideoAudio } from "../src/types";

function input(extra: Partial<TurnAudioInput> = {}) {
  const status = { show: vi.fn(), clear: vi.fn() };
  const store = createMemoryStore();
  const base: TurnAudioInput = {
    on: true,
    fileKey: "turn-audio-key",
    store,
    settings: DEFAULT_SETTINGS,
    status,
    signal: new AbortController().signal,
    ...extra,
  };
  return { base, status, store };
}

function names(audio: Awaited<ReturnType<typeof turnAudio>>): string[] {
  return audio.tools.map((tool) => tool.function.name);
}

describe("turnAudio", () => {
  it("is off without the flag or without a loaded video", async () => {
    const off = await turnAudio(input({ on: false }).base);
    expect(off.on).toBe(false);
    expect(names(off)).not.toContain("listen");
    const noVideo = await turnAudio(input({ fileKey: undefined }).base);
    expect(noVideo.on).toBe(false);
  });

  it("offers listen with the turn's signal and labels when audio is on", async () => {
    const { base } = input();
    const audio = await turnAudio(base);
    expect(names(audio)).toContain("listen");
    if (!audio.on) throw new Error("Expected audio on");
    expect(audio.coverage).toEqual({ text: "not analysed yet", canListen: true });
    expect(audio.listen).toMatchObject({
      signal: base.signal,
      labels: { labels: DEFAULT_SETTINGS.soundLabels },
    });
  });

  it("offers no listen for a video with no audio track", async () => {
    const { base, store } = input({ fileKey: "silent-key" });
    const silent: VideoAudio = {
      fileKey: "silent-key",
      labels: [],
      backgroundLabels: [],
      speechSpans: [],
      soundSpans: [],
      speech: [],
      events: [],
      noAudio: true,
      updatedAt: 1,
    };
    await store.putAudio(silent);
    const audio = await turnAudio(base);
    if (!audio.on) throw new Error("Expected audio on");
    expect(audio.coverage.canListen).toBe(false);
    expect(audio.listen).toBeUndefined();
    expect(names(audio)).not.toContain("listen");
  });

  it("shows analysis progress and clears only what it showed", async () => {
    const { base, status } = input();
    const { progress } = await turnAudio(base);
    progress.clear();
    expect(status.clear).not.toHaveBeenCalled();
    progress.show({ stage: "sounds", done: 1, total: 2 });
    expect(status.show).toHaveBeenCalledWith("Listening for sounds… 50%");
    progress.clear();
    expect(status.clear).toHaveBeenCalledTimes(1);
  });
});
