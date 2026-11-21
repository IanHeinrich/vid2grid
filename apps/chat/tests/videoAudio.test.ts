import { createBrowserAudioPorts } from "@vid2grid/browser";
import { Vid2GridError, type AudioAnalysisRequest, type AudioTrack } from "@vid2grid/core";
import { describe, expect, it, vi } from "vitest";
import {
  AUDIO_PIECE_SECONDS,
  AudioDecodeError,
  audioCoverage,
  audioProgressText,
  cachedAudioCoverage,
  describeAudioCoverage,
  ensureAudio,
  isRangeHeard,
  loadAudio,
  onAudioChanged,
  timedAudioLines,
  type AnalyseAudio,
  type AudioDeps,
  type AudioLabels,
  type AudioSource,
} from "../src/audio/videoAudio";
import { createMemoryStore } from "../src/chat/store";
import type { VideoAudio } from "../src/types";

vi.mock("@vid2grid/browser", () => ({ createBrowserAudioPorts: vi.fn() }));

const LABELS: AudioLabels = { labels: ["music", "applause"], backgroundLabels: ["silence"] };

let nextKey = 0;

function source(durationSeconds = 900): AudioSource {
  nextKey += 1;
  return { file: new File(["x"], "clip.mp4"), fileKey: `clip-${nextKey}`, durationSeconds };
}

function trackFor(request: AudioAnalysisRequest, speech: boolean): AudioTrack {
  const start = request.startSeconds ?? 0;
  const end = request.endSeconds ?? start;
  const label = request.labels[0];
  return {
    speech: speech ? [{ start, end: start + 2, text: `words at ${start}` }] : [],
    events:
      label === undefined
        ? []
        : [{ startSeconds: start + 3, endSeconds: start + 5, label, score: 0.8, loudnessDb: 2 }],
    startSeconds: start,
    durationSeconds: end - start,
  };
}

function setup(labels: AudioLabels = LABELS) {
  const store = createMemoryStore();
  const analyse = vi.fn<AnalyseAudio>((_file, request, speech) =>
    Promise.resolve(trackFor(request, speech)),
  );
  const deps: AudioDeps = { store, labels, analyse, now: () => 5 };
  return { store, analyse, deps };
}

function requested(analyse: ReturnType<typeof setup>["analyse"]) {
  return analyse.mock.calls.map(([, request, speech]) => ({
    start: request.startSeconds,
    end: request.endSeconds,
    labels: request.labels,
    speech,
  }));
}

function spansOf(analyse: ReturnType<typeof setup>["analyse"]): (number | undefined)[][] {
  return requested(analyse).map(({ start, end }) => [start, end]);
}

describe("ensureAudio pieces", () => {
  it("analyses whole five-minute pieces, saving after each", async () => {
    const { deps, analyse, store } = setup();
    const video = source();
    const saved: VideoAudio[] = [];
    const stop = onAudioChanged((audio) => {
      if (audio.fileKey === video.fileKey) saved.push(audio);
    });
    const audio = await ensureAudio(deps, video, { startSeconds: 60, endSeconds: 400 });
    stop();
    expect(AUDIO_PIECE_SECONDS).toBe(300);
    expect(requested(analyse)).toEqual([
      { start: 0, end: 300, labels: LABELS.labels, speech: true },
      { start: 300, end: 600, labels: LABELS.labels, speech: true },
    ]);
    expect(saved.map((record) => record.speechSpans)).toEqual([
      [{ startSeconds: 0, endSeconds: 300 }],
      [{ startSeconds: 0, endSeconds: 600 }],
    ]);
    expect(audio.speech.map((cue) => cue.start)).toEqual([0, 300]);
    expect(await store.getAudio(video.fileKey)).toEqual(audio);
  });

  it("analyses only the pieces not yet heard, and keeps the range inside the video", async () => {
    const { deps, analyse } = setup();
    const video = source(700);
    await ensureAudio(deps, video, { startSeconds: 10, endSeconds: 20 });
    await ensureAudio(deps, video, { startSeconds: -5, endSeconds: 5000 });
    await ensureAudio(deps, video, { startSeconds: 100, endSeconds: 650 });
    expect(spansOf(analyse)).toEqual([
      [0, 300],
      [300, 600],
      [600, 700],
    ]);
  });

  it("folds a sliver at the end into the last piece and re-analyses a partly heard piece once", async () => {
    const { deps, analyse, store } = setup();
    const video = source(600.3);
    await store.putAudio({
      fileKey: video.fileKey,
      labels: [...LABELS.labels],
      backgroundLabels: [...LABELS.backgroundLabels],
      speechSpans: [{ startSeconds: 0, endSeconds: 100 }],
      soundSpans: [{ startSeconds: 0, endSeconds: 200 }],
      speech: [{ start: 50, end: 52, text: "old words" }],
      events: [],
      updatedAt: 1,
    });
    const audio = await ensureAudio(deps, video, { startSeconds: 0, endSeconds: 600.3 });
    expect(spansOf(analyse)).toEqual([
      [0, 300],
      [300, 600.3],
    ]);
    expect(audio.speech.map((cue) => cue.text)).toEqual(["words at 0", "words at 300"]);
    expect(audio.speechSpans).toEqual([{ startSeconds: 0, endSeconds: 600.3 }]);
  });
});

describe("ensureAudio signal", () => {
  it("passes the signal and progress callback to the analysis", async () => {
    const { deps, analyse } = setup();
    const controller = new AbortController();
    const onProgress = vi.fn();
    await ensureAudio(
      deps,
      source(),
      { startSeconds: 0, endSeconds: 10 },
      { signal: controller.signal, onProgress },
    );
    expect(analyse.mock.calls[0]?.[3]).toEqual({ signal: controller.signal, onProgress });
  });

  it("keeps the pieces finished before a stop, and analyses nothing after it", async () => {
    const { deps, analyse, store } = setup();
    const video = source();
    const controller = new AbortController();
    analyse.mockImplementationOnce((_file, request, speech) => {
      controller.abort();
      return Promise.resolve(trackFor(request, speech));
    });
    const run = ensureAudio(
      deps,
      video,
      { startSeconds: 0, endSeconds: 900 },
      { signal: controller.signal },
    );
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(async () => expect(await store.getAudio(video.fileKey)).toBeDefined());
    expect(analyse).toHaveBeenCalledTimes(1);
    expect((await store.getAudio(video.fileKey))?.speechSpans).toEqual([
      { startSeconds: 0, endSeconds: 300 },
    ]);
  });
});

describe("ensureAudio in flight", () => {
  it("reuses an analysis in flight instead of running the same piece twice", async () => {
    const { deps, analyse } = setup();
    const video = source();
    const first = ensureAudio(deps, video, { startSeconds: 0, endSeconds: 60 });
    const same = ensureAudio(deps, video, { startSeconds: 0, endSeconds: 60 });
    const overlapping = ensureAudio(deps, video, { startSeconds: 30, endSeconds: 400 });
    await Promise.all([first, same, overlapping]);
    expect(spansOf(analyse)).toEqual([
      [0, 300],
      [300, 600],
    ]);
    expect((await overlapping).speechSpans).toEqual([{ startSeconds: 0, endSeconds: 600 }]);
  });

  it("stops waiting on abort, and the next call analyses what is still missing", async () => {
    const { deps, analyse } = setup();
    const video = source();
    let finish = (): void => {};
    analyse.mockImplementationOnce(
      (_file, request, speech) =>
        new Promise((resolve) => {
          finish = () => resolve(trackFor(request, speech));
        }),
    );
    const first = ensureAudio(deps, video, { startSeconds: 0, endSeconds: 60 });
    const controller = new AbortController();
    const waiting = ensureAudio(
      deps,
      video,
      { startSeconds: 300, endSeconds: 400 },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    finish();
    await first;
    await ensureAudio(deps, video, { startSeconds: 0, endSeconds: 400 });
    expect(spansOf(analyse)).toEqual([
      [0, 300],
      [300, 600],
    ]);
  });
});

describe("ensureAudio with new labels or no audio", () => {
  it("scores sounds again with new labels, keeping the speech already heard", async () => {
    const { deps, analyse, store } = setup();
    const video = source();
    await ensureAudio(deps, video, { startSeconds: 0, endSeconds: 60 });
    const relabelled = { labels: ["footsteps"], backgroundLabels: ["silence"] };
    const audio = await ensureAudio({ ...deps, labels: relabelled }, video, {
      startSeconds: 0,
      endSeconds: 60,
    });
    expect(requested(analyse)[1]).toEqual({
      start: 0,
      end: 300,
      labels: ["footsteps"],
      speech: false,
    });
    expect(audio.events.map((event) => event.label)).toEqual(["footsteps"]);
    expect(audio.speech).toHaveLength(1);
    expect(await store.getAudio(video.fileKey)).toEqual(audio);
  });

  it("records a video with no audio track and does not decode it again", async () => {
    const { deps, analyse } = setup();
    analyse.mockRejectedValue(new Vid2GridError("no_audio", "No audio."));
    const video = source();
    const audio = await ensureAudio(deps, video, { startSeconds: 0, endSeconds: 60 });
    expect(audio.noAudio).toBe(true);
    await ensureAudio(deps, video, { startSeconds: 300, endSeconds: 400 });
    expect(analyse).toHaveBeenCalledTimes(1);
  });

  it("saves nothing when the audio exists but cannot be decoded", async () => {
    const { deps, analyse, store } = setup();
    analyse.mockRejectedValueOnce(new AudioDecodeError("Unsupported codec."));
    const video = source();
    await expect(ensureAudio(deps, video, { startSeconds: 0, endSeconds: 60 })).rejects.toThrow(
      AudioDecodeError,
    );
    expect(await store.getAudio(video.fileKey)).toBeUndefined();
    const audio = await ensureAudio(deps, video, { startSeconds: 0, endSeconds: 60 });
    expect(audio.noAudio).toBeUndefined();
    expect(analyse).toHaveBeenCalledTimes(2);
  });
});

describe("ensureAudio with the browser's decoder", () => {
  function decoderFailing(error: Error) {
    vi.mocked(createBrowserAudioPorts).mockReturnValue({
      decode: () => Promise.reject(error),
      scoreWindows: () => Promise.resolve([]),
    });
    const { store } = setup();
    return { store, deps: { store, labels: LABELS } };
  }

  it("treats any decode failure but a missing track as undecodable, saving nothing", async () => {
    const { store, deps } = decoderFailing(new Error("Unsupported codec."));
    const video = source();
    await expect(ensureAudio(deps, video, { startSeconds: 0, endSeconds: 60 })).rejects.toThrow(
      AudioDecodeError,
    );
    expect(await store.getAudio(video.fileKey)).toBeUndefined();
  });

  it("records a missing track the decoder reports", async () => {
    const { deps } = decoderFailing(new Vid2GridError("no_audio", "No audio."));
    const audio = await ensureAudio(deps, source(), { startSeconds: 0, endSeconds: 60 });
    expect(audio.noAudio).toBe(true);
  });
});

function heard(extra: Partial<VideoAudio> = {}): VideoAudio {
  return {
    fileKey: "k",
    labels: [...LABELS.labels],
    backgroundLabels: [...LABELS.backgroundLabels],
    speechSpans: [{ startSeconds: 0, endSeconds: 750 }],
    soundSpans: [{ startSeconds: 0, endSeconds: 750 }],
    speech: [{ start: 12, end: 14, text: "Hello there." }],
    events: [{ startSeconds: 30, endSeconds: 40, label: "music", score: 0.7, loudnessDb: -8 }],
    updatedAt: 1,
    ...extra,
  };
}

describe("audio lines", () => {
  it("lists speech and sounds inside the range in time order, with their start times", () => {
    expect(timedAudioLines(heard(), { startSeconds: 0, endSeconds: 60 }, LABELS)).toEqual([
      { startSeconds: 12, line: '[0:12] "Hello there."' },
      { startSeconds: 30, line: "[0:30-0:40] music 0.70, quiet (-8 dB)" },
    ]);
    const timed = timedAudioLines(heard(), { startSeconds: 20, endSeconds: 60 }, LABELS);
    expect(timed.map((entry) => entry.line)).toEqual(["[0:30-0:40] music 0.70, quiet (-8 dB)"]);
  });

  it("lists a cue that is one sound tag as a sound, at its start time", () => {
    const tagged = heard({ speech: [{ start: 20, end: 25, text: "(laughter)" }] });
    expect(timedAudioLines(tagged, { startSeconds: 0, endSeconds: 60 }, LABELS)).toEqual([
      { startSeconds: 20, line: "[0:20] sound: laughter" },
      { startSeconds: 30, line: "[0:30-0:40] music 0.70, quiet (-8 dB)" },
    ]);
  });

  it("keeps events heard with grouped wordings while the label lines are unchanged", () => {
    const labels = { labels: ["music: piano music; a band playing"], backgroundLabels: [] };
    const audio = heard({ labels: [...labels.labels], backgroundLabels: [] });
    const timed = timedAudioLines(audio, { startSeconds: 20, endSeconds: 60 }, labels);
    expect(timed.map((entry) => entry.line)).toEqual(["[0:30-0:40] music 0.70, quiet (-8 dB)"]);
    expect(isRangeHeard(audio, { startSeconds: 10, endSeconds: 20 }, labels)).toBe(true);
  });

  it("leaves out sound events scored against other labels", () => {
    const labels = { labels: ["footsteps"], backgroundLabels: ["silence"] };
    const timed = timedAudioLines(heard(), { startSeconds: 0, endSeconds: 60 }, labels);
    expect(timed.map((entry) => entry.line)).toEqual(['[0:12] "Hello there."']);
  });

  it("tells a heard range from one not analysed", () => {
    expect(isRangeHeard(heard(), { startSeconds: 10, endSeconds: 20 }, LABELS)).toBe(true);
    expect(isRangeHeard(heard(), { startSeconds: 740, endSeconds: 760 }, LABELS)).toBe(false);
    const nothing = heard({ speechSpans: [], soundSpans: [] });
    expect(isRangeHeard(nothing, { startSeconds: 0, endSeconds: 0.3 }, LABELS)).toBe(false);
  });
});

describe("audio coverage", () => {
  it("says what has been heard", () => {
    expect(describeAudioCoverage(undefined, LABELS)).toBe("not analysed yet");
    expect(describeAudioCoverage(heard(), LABELS)).toBe(
      "analysed 0:00 to 12:30 (speech and sounds)",
    );
    expect(audioCoverage(heard({ noAudio: true }), LABELS)).toEqual({
      text: "the video has no audio track",
      canListen: false,
    });
  });

  it("names speech and sounds apart when they cover different stretches", () => {
    const labels = { labels: ["footsteps"], backgroundLabels: ["silence"] };
    expect(describeAudioCoverage(heard(), labels)).toBe(
      "speech analysed 0:00 to 12:30; sounds not analysed yet",
    );
    const twoStretches = heard({
      soundSpans: [
        { startSeconds: 0, endSeconds: 60 },
        { startSeconds: 120, endSeconds: 180 },
      ],
    });
    expect(describeAudioCoverage(twoStretches, LABELS)).toBe(
      "speech analysed 0:00 to 12:30; sounds analysed 0:00 to 1:00, 2:00 to 3:00",
    );
  });

  it("keeps a cached coverage fresh as records are loaded and saved", async () => {
    const { deps, store } = setup();
    const video = source();
    expect(cachedAudioCoverage(video.fileKey, LABELS)).toEqual({
      text: "not analysed yet",
      canListen: true,
    });
    await store.putAudio(heard({ fileKey: video.fileKey }));
    await loadAudio(store, video.fileKey);
    expect(cachedAudioCoverage(video.fileKey, LABELS).text).toBe(
      "analysed 0:00 to 12:30 (speech and sounds)",
    );
    await ensureAudio(deps, video, { startSeconds: 800, endSeconds: 850 });
    expect(cachedAudioCoverage(video.fileKey, LABELS).text).toBe(
      "analysed 0:00 to 15:00 (speech and sounds)",
    );
  });
});

describe("helpers", () => {
  it("words analysis progress", () => {
    expect(audioProgressText({ stage: "speech", done: 1, total: 4 })).toBe(
      "Transcribing speech… 25%",
    );
    expect(audioProgressText({ stage: "sound-model", done: 0, total: 0 })).toBe(
      "Loading the sound model…",
    );
  });
});
