import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyseAudio } from "../src/audio/videoAudio";
import { blankChat } from "../src/chat/chats";
import { currentPending, pendingVideo, replaceChat, setCurrentChat } from "../src/state";
import { fileKey } from "../src/video/render";
import {
  cleanUpVideoPanel,
  els,
  MODEL,
  panel,
  resetVideoPanel,
  settle,
  spies,
  state,
  store,
  video,
} from "./support/videoPanel";
import type { AudioAnalysisOptions, AudioAnalysisRequest, AudioTrack } from "@vid2grid/core";

beforeEach(resetVideoPanel);

afterEach(cleanUpVideoPanel);

describe("audio ready in advance", () => {
  function silentTrack(request: AudioAnalysisRequest): AudioTrack {
    const start = request.startSeconds ?? 0;
    return {
      speech: [],
      events: [],
      startSeconds: start,
      durationSeconds: (request.endSeconds ?? start) - start,
    };
  }

  it("analyses the whole video's audio once the overview is ready, when audio is on", async () => {
    const analyseAudio = vi.fn<AnalyseAudio>((_file, request) =>
      Promise.resolve(silentTrack(request)),
    );
    const file = video("beach.mp4");
    await panel({ audioWanted: () => true, analyseAudio }).attach(file);
    await vi.waitFor(() => expect(analyseAudio).toHaveBeenCalledTimes(1));
    const [analysed, request] = analyseAudio.mock.calls[0] ?? [];
    expect(analysed).toBe(file);
    expect(request).toMatchObject({ startSeconds: 0, endSeconds: 60 });
    await vi.waitFor(async () =>
      expect((await store.getAudio(fileKey(file)))?.speechSpans).toEqual([
        { startSeconds: 0, endSeconds: 60 },
      ]),
    );
    await vi.waitFor(() => expect(els.video.chipMeta.textContent).toBe("1:00"));
  });

  it("leaves the audio alone when the Audio toggle is off", async () => {
    const analyseAudio = vi.fn<AnalyseAudio>((_file, request) =>
      Promise.resolve(silentTrack(request)),
    );
    await panel({ audioWanted: () => false, analyseAudio }).attach(video("beach.mp4"));
    await settle();
    expect(analyseAudio).not.toHaveBeenCalled();
  });
});

describe("audio ready in advance, cancelled", () => {
  it("shows progress quietly and stops when the video changes, without failing", async () => {
    const signals: NonNullable<AudioAnalysisOptions["signal"]>[] = [];
    const analyseAudio = vi.fn<AnalyseAudio>(
      (_file, _request, _speech, options) =>
        new Promise((_resolve, reject) => {
          options.onProgress?.({ stage: "sounds", done: 1, total: 4 });
          const { signal } = options;
          if (signal) {
            signals.push(signal);
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        }),
    );
    const videos = panel({ audioWanted: () => true, analyseAudio });
    await videos.attach(video("one.mp4", 1));
    await vi.waitFor(() =>
      expect(els.video.chipMeta.textContent).toBe("1:00 · Listening for sounds… 25%"),
    );
    await videos.attach(video("two.mp4", 2));
    expect(signals[0]?.aborted).toBe(true);
    expect(pendingVideo(currentPending(state))?.name).toBe("two.mp4");
    expect(spies.status.show).not.toHaveBeenCalledWith(expect.stringContaining("aborted"), "error");
  });

  it("stops when another chat is opened", async () => {
    const signals: NonNullable<AudioAnalysisOptions["signal"]>[] = [];
    const analyseAudio = vi.fn<AnalyseAudio>(
      (_file, _request, _speech, options) =>
        new Promise((_resolve, reject) => {
          const { signal } = options;
          if (!signal) return;
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const videos = panel({ audioWanted: () => true, analyseAudio });
    await videos.attach(video("one.mp4", 1));
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const other = blankChat(MODEL, "other", 2);
    await store.putChat(other);
    replaceChat(state, other);
    setCurrentChat(state, other, []);
    await videos.restore();
    expect(signals[0]?.aborted).toBe(true);
  });
});
