import {
  analyseAudio,
  Vid2GridError,
  type AbortSignalLike,
  type DecodedAudio,
  type LabelWordings,
  type PortCallOptions,
  type PortProgressCallback,
} from "@vid2grid/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyseVideoAudio, createBrowserAudioPorts } from "../src/audio/browserAudio";

const { decodeAudioRange, transcribeInPieces, scoreSoundWindows } = vi.hoisted(() => ({
  decodeAudioRange:
    vi.fn<
      (file: File, start: number, end: number, signal?: AbortSignalLike) => Promise<DecodedAudio>
    >(),
  transcribeInPieces:
    vi.fn<
      (
        samples: Float32Array,
        sampleRate: number,
        offset: number,
        onProgress?: PortProgressCallback,
        signal?: AbortSignalLike,
      ) => Promise<[]>
    >(),
  scoreSoundWindows:
    vi.fn<
      (
        windows: Float32Array[],
        rate: number,
        labels: readonly LabelWordings[],
        call?: PortCallOptions,
      ) => Promise<number[][]>
    >(),
}));
vi.mock("../src/capture/audioExtraction", () => ({ DECODED_SAMPLE_RATE: 16000, decodeAudioRange }));
vi.mock("../src/transcribe/transcription", () => ({ transcribeInPieces }));
vi.mock("../src/audio/soundClassification", () => ({ scoreSoundWindows }));

const SAMPLE_RATE = 16000;
const file = {} as File;
const LABELS = ["applause", "music"];

function detach(samples: Float32Array): void {
  const buffer = samples.buffer as ArrayBuffer;
  structuredClone(buffer, { transfer: [buffer] });
}

beforeEach(() => {
  decodeAudioRange.mockReset();
  decodeAudioRange.mockImplementation((_file, start, end) =>
    Promise.resolve({
      samples: new Float32Array((Math.min(end, 40) - start) * SAMPLE_RATE).fill(0.1),
      sampleRate: SAMPLE_RATE,
    }),
  );
  transcribeInPieces.mockReset();
  transcribeInPieces.mockImplementation((samples) => {
    detach(samples);
    return Promise.resolve([]);
  });
  scoreSoundWindows.mockReset();
  scoreSoundWindows.mockImplementation((windows, _rate, labels) => {
    windows.forEach(detach);
    return Promise.resolve(windows.map(() => labels.map((_, index) => (index === 0 ? 10 : 0))));
  });
});

describe("createBrowserAudioPorts", () => {
  it("decodes just the asked range of the file each time, keeping nothing", async () => {
    const ports = createBrowserAudioPorts(file);

    const first = await analyseAudio({ labels: LABELS, endSeconds: 6 }, ports);
    const second = await analyseAudio({ labels: LABELS, startSeconds: 6, endSeconds: 12 }, ports);

    expect(decodeAudioRange.mock.calls).toEqual([
      [file, 0, 6, undefined],
      [file, 6, 12, undefined],
    ]);
    expect(first.events).toEqual([expect.objectContaining({ label: "applause", endSeconds: 6 })]);
    expect(second.durationSeconds).toBe(6);
  });

  it("hands Whisper 16 kHz audio, the range's offset and the abort signal", async () => {
    const onProgress = vi.fn();
    const controller = new AbortController();
    let receivedLength = 0;
    transcribeInPieces.mockImplementationOnce((samples) => {
      receivedLength = samples.length;
      return Promise.resolve([]);
    });

    await createBrowserAudioPorts(file).transcribe?.(new Float32Array(8000), 8000, 5, {
      onProgress,
      signal: controller.signal,
    });

    expect(transcribeInPieces).toHaveBeenCalledWith(
      expect.any(Float32Array),
      SAMPLE_RATE,
      5,
      onProgress,
      controller.signal,
    );
    expect(receivedLength).toBe(SAMPLE_RATE);
  });

  it("passes 16 kHz audio to Whisper as it is", async () => {
    const samples = new Float32Array(SAMPLE_RATE);
    transcribeInPieces.mockResolvedValueOnce([]);

    await createBrowserAudioPorts(file).transcribe?.(samples, SAMPLE_RATE, 0);

    expect(transcribeInPieces.mock.calls[0]?.[0]).toBe(samples);
  });
});

describe("analyseVideoAudio", () => {
  it("analyses the whole file when no range is given", async () => {
    const track = await analyseVideoAudio(file, { labels: LABELS });

    expect(decodeAudioRange).toHaveBeenCalledWith(file, 0, Number.POSITIVE_INFINITY, undefined);
    expect(track.durationSeconds).toBe(40);
    expect(transcribeInPieces).toHaveBeenCalledOnce();
  });

  it("rejects promptly when aborted while the sound model is still loading", async () => {
    const controller = new AbortController();
    scoreSoundWindows.mockImplementationOnce((_windows, _rate, _labels, call) => {
      expect(call?.signal).toBe(controller.signal);
      setTimeout(() => controller.abort(), 0);
      return new Promise(() => {});
    });

    const failure = await analyseVideoAudio(
      file,
      { labels: LABELS },
      { signal: controller.signal },
    ).catch((err: unknown) => err);

    expect((failure as Error).name).toBe("AbortError");
    expect(transcribeInPieces).not.toHaveBeenCalled();
  });

  it("hands the signal to the decode and stops waiting on it once aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    decodeAudioRange.mockImplementationOnce(() => {
      setTimeout(() => controller.abort(reason), 0);
      return new Promise(() => {});
    });

    await expect(
      analyseVideoAudio(file, { labels: LABELS }, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(decodeAudioRange).toHaveBeenCalledWith(
      file,
      0,
      Number.POSITIVE_INFINITY,
      controller.signal,
    );
    expect(scoreSoundWindows).not.toHaveBeenCalled();
  });

  it("rejects with no_audio when the file has no audio track", async () => {
    const noAudio = new Vid2GridError("no_audio", "This video has no decodable audio track.");
    decodeAudioRange.mockRejectedValue(noAudio);

    await expect(analyseVideoAudio(file, { labels: LABELS })).rejects.toBe(noAudio);
  });
});
