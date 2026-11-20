import { describe, expect, it, vi } from "vitest";
import {
  analyseAudio,
  type AudioAnalysisPorts,
  type AudioAnalysisProgress,
  type DecodedAudio,
} from "../src/audio/audioAnalysis";
import { Vid2GridError } from "../src/errors";
import type { TranscriptCue } from "../src/transcript/vtt";

const SAMPLE_RATE = 100;
const LABELS = ["applause", "music"];
const CONFIDENT = 10;

type ScoreWindows = AudioAnalysisPorts["scoreWindows"];
type Transcribe = NonNullable<AudioAnalysisPorts["transcribe"]>;

function decoded(seconds: number, fill = 0.1): DecodedAudio {
  return { samples: new Float32Array(seconds * SAMPLE_RATE).fill(fill), sampleRate: SAMPLE_RATE };
}

function fakePorts(audio: DecodedAudio, overrides: Partial<AudioAnalysisPorts> = {}) {
  const scoreWindows = vi.fn<ScoreWindows>((windows, _rate, labels) =>
    Promise.resolve(windows.map(() => labels.map((_, index) => (index === 0 ? CONFIDENT : 0)))),
  );
  const transcribe = vi.fn<Transcribe>((_samples, _rate, offset) =>
    Promise.resolve([{ start: offset, end: offset + 1, text: "hi" }]),
  );
  const decode = vi.fn<AudioAnalysisPorts["decode"]>(() => Promise.resolve(audio));
  const ports: AudioAnalysisPorts = { decode, scoreWindows, transcribe, ...overrides };
  return { ports, decode, scoreWindows, transcribe };
}

describe("analyseAudio", () => {
  it("decodes the range once and builds a track on the video's timeline", async () => {
    const { ports, decode } = fakePorts(decoded(5));

    const track = await analyseAudio({ labels: LABELS, startSeconds: 10, endSeconds: 15 }, ports);

    expect(decode).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledWith(10, 15, {});
    expect(track.startSeconds).toBe(10);
    expect(track.durationSeconds).toBe(5);
    expect(track.speech).toEqual([{ start: 10, end: 11, text: "hi" }]);
    expect(track.events).toEqual([
      expect.objectContaining({ label: "applause", startSeconds: 10, endSeconds: 15 }),
    ]);
  });

  it("decodes from the start to the end when no range is given", async () => {
    const { ports, decode } = fakePorts(decoded(1));

    await analyseAudio({ labels: LABELS, startSeconds: -3 }, ports);

    expect(decode).toHaveBeenCalledWith(0, Number.POSITIVE_INFINITY, {});
  });
});

describe("analyseAudio scoring", () => {
  it("applies the caller's minimum score", async () => {
    const { ports } = fakePorts(decoded(4));

    const track = await analyseAudio({ labels: LABELS, minScore: 0.99999 }, ports);

    expect(track.events).toEqual([]);
  });

  it("sends windows in chunks, each window in a buffer of its own", async () => {
    const audio = decoded(40);
    const { ports, scoreWindows } = fakePorts(audio);

    await analyseAudio({ labels: LABELS }, ports);

    const batches = scoreWindows.mock.calls.map(([windows]) => windows);
    expect(batches.map((windows) => windows.length)).toEqual([16, 16, 7]);
    expect(scoreWindows.mock.calls.every(([, rate]) => rate === SAMPLE_RATE)).toBe(true);
    const [first] = batches[0] ?? [];
    expect(first).toHaveLength(2 * SAMPLE_RATE);
    expect(first?.buffer).not.toBe(audio.samples.buffer);
  });

  it("reports model loading, each chunk and transcription as stages", async () => {
    const scoreWindows = vi.fn<ScoreWindows>((windows, _rate, labels, call) => {
      call?.onProgress?.({ done: 50, total: 100 });
      return Promise.resolve(windows.map(() => labels.map(() => 0)));
    });
    const transcribe = vi.fn<Transcribe>((_samples, _rate, _offset, call) => {
      call?.onProgress?.({ done: 10, total: 100, stage: "model" });
      call?.onProgress?.({ done: 60, total: 100, stage: "transcribe" });
      return Promise.resolve([]);
    });
    const { ports } = fakePorts(decoded(20), { scoreWindows, transcribe });
    const progress: AudioAnalysisProgress[] = [];

    await analyseAudio({ labels: LABELS }, ports, { onProgress: (p) => progress.push(p) });

    expect(progress).toEqual([
      { stage: "sound-model", done: 50, total: 100 },
      { stage: "sounds", done: 16, total: 19 },
      { stage: "sound-model", done: 50, total: 100 },
      { stage: "sounds", done: 19, total: 19 },
      { stage: "speech-model", done: 10, total: 100 },
      { stage: "speech", done: 60, total: 100 },
    ]);
  });
});

describe("analyseAudio labels", () => {
  it("scores background labels after the reported ones but never reports them", async () => {
    const scoreWindows = vi.fn<ScoreWindows>((windows) =>
      Promise.resolve(windows.map(() => [0, 0, CONFIDENT])),
    );
    const { ports } = fakePorts(decoded(4), { scoreWindows });

    const track = await analyseAudio(
      { labels: LABELS, backgroundLabels: ["background noise"] },
      ports,
    );

    expect(scoreWindows.mock.calls[0]?.[2]).toEqual([
      ["applause"],
      ["music"],
      ["background noise"],
    ]);
    expect(track.events).toEqual([]);
  });

  it("prompts with each label's wordings and reports its name", async () => {
    const scoreWindows = vi.fn<ScoreWindows>((windows) =>
      Promise.resolve(windows.map(() => [CONFIDENT, 0, 0])),
    );
    const { ports } = fakePorts(decoded(4), { scoreWindows });

    const track = await analyseAudio(
      {
        labels: ["crowd: applause; people clapping", "music"],
        backgroundLabels: ["quiet: silence; room tone"],
      },
      ports,
    );

    expect(scoreWindows.mock.calls[0]?.[2]).toEqual([
      ["applause", "people clapping"],
      ["music"],
      ["silence", "room tone"],
    ]);
    expect(track.events).toEqual([expect.objectContaining({ label: "crowd" })]);
  });

  it("leaves out label lines with no name, scoring nothing if none is left", async () => {
    const { ports, scoreWindows } = fakePorts(decoded(4));

    await analyseAudio({ labels: [":", "music"], backgroundLabels: [" : ; "] }, ports);
    const unnamed = await analyseAudio({ labels: [":"] }, ports);

    expect(scoreWindows.mock.calls.map(([, , labels]) => labels)).toEqual([[["music"]]]);
    expect(unnamed.events).toEqual([]);
  });

  it("never reports a background label by its name", async () => {
    const scoreWindows = vi.fn<ScoreWindows>((windows) =>
      Promise.resolve(windows.map(() => [0, CONFIDENT])),
    );
    const { ports } = fakePorts(decoded(4), { scoreWindows });

    const track = await analyseAudio(
      { labels: ["music"], backgroundLabels: ["quiet: silence; room tone"] },
      ports,
    );

    expect(track.events).toEqual([]);
  });
});

describe("analyseAudio abort", () => {
  it("stops between chunks once aborted, with the signal's reason", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const scoreWindows = vi.fn<ScoreWindows>((windows, _rate, labels) => {
      controller.abort(reason);
      return Promise.resolve(windows.map(() => labels.map(() => 0)));
    });
    const { ports, transcribe } = fakePorts(decoded(40), { scoreWindows });

    await expect(
      analyseAudio({ labels: LABELS }, ports, { signal: controller.signal }),
    ).rejects.toBe(reason);

    expect(scoreWindows).toHaveBeenCalledOnce();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("does not decode when already aborted, and falls back to its own error without a reason", async () => {
    const { ports, decode } = fakePorts(decoded(1));
    const signal = { aborted: true, addEventListener() {}, removeEventListener() {} };

    await expect(analyseAudio({ labels: LABELS }, ports, { signal })).rejects.toThrow(
      "Audio analysis was aborted.",
    );

    expect(decode).not.toHaveBeenCalled();
  });

  it("hands the signal to every port call", async () => {
    const controller = new AbortController();
    const { ports, decode, scoreWindows, transcribe } = fakePorts(decoded(2));

    await analyseAudio({ labels: LABELS }, ports, { signal: controller.signal });

    expect(decode.mock.calls[0]?.[2]).toEqual({ signal: controller.signal });
    expect(scoreWindows.mock.calls[0]?.[3]?.signal).toBe(controller.signal);
    expect(transcribe.mock.calls[0]?.[3]?.signal).toBe(controller.signal);
  });

  it.each(["decode", "scoreWindows", "transcribe"] as const)(
    "stops at once when aborted during %s, even if the port never settles",
    async (stuck) => {
      const controller = new AbortController();
      const reason = new Error("stopped");
      const never = () => {
        setTimeout(() => controller.abort(reason), 0);
        return new Promise<never>(() => {});
      };
      const { ports } = fakePorts(decoded(2), { [stuck]: never });

      await expect(
        analyseAudio({ labels: LABELS }, ports, { signal: controller.signal }),
      ).rejects.toBe(reason);
    },
  );

  it("stops listening for abort once a port call settles", async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const { ports } = fakePorts(decoded(2));

    await analyseAudio({ labels: LABELS }, ports, { signal: controller.signal });

    expect(removeEventListener).toHaveBeenCalledTimes(3);
  });
});

describe("analyseAudio edge cases", () => {
  it("finishes with the samples before a transcriber transfers them away", async () => {
    const audio = decoded(6);
    const transcribe = vi.fn((samples: Float32Array) => {
      const buffer = samples.buffer as ArrayBuffer;
      structuredClone(buffer, { transfer: [buffer] });
      return Promise.resolve<TranscriptCue[]>([]);
    });
    const { ports } = fakePorts(audio, { transcribe });

    const track = await analyseAudio({ labels: LABELS }, ports);

    expect(audio.samples.length).toBe(0);
    expect(track.durationSeconds).toBe(6);
    expect(track.events).toHaveLength(1);
  });

  it("skips scoring without labels and speech without a transcriber", async () => {
    const { ports, scoreWindows } = fakePorts(decoded(3));
    delete ports.transcribe;

    const track = await analyseAudio({ labels: [] }, ports);

    expect(scoreWindows).not.toHaveBeenCalled();
    expect(track).toEqual({ speech: [], events: [], startSeconds: 0, durationSeconds: 3 });
  });

  it("gives an empty track when the range holds no samples", async () => {
    const { ports, scoreWindows, transcribe } = fakePorts(decoded(0));

    const track = await analyseAudio({ labels: LABELS, startSeconds: 99 }, ports);

    expect(track).toEqual({ speech: [], events: [], startSeconds: 99, durationSeconds: 0 });
    expect(scoreWindows).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("passes on the decoder's no-audio error", async () => {
    const noAudio = new Vid2GridError("no_audio", "This video has no decodable audio track.");
    const { ports } = fakePorts(decoded(1), { decode: () => Promise.reject(noAudio) });

    await expect(analyseAudio({ labels: LABELS }, ports)).rejects.toBe(noAudio);
  });

  it("rejects a scorer that returns the wrong number of scores", async () => {
    const scoreWindows = vi.fn<ScoreWindows>(() => Promise.resolve([[1]]));
    const { ports } = fakePorts(decoded(3), { scoreWindows });

    await expect(analyseAudio({ labels: LABELS }, ports)).rejects.toThrow(
      "Expected 2 scores for each of 2 windows.",
    );
  });
});
