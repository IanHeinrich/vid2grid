import { Vid2GridError, type DecodedAudio } from "@vid2grid/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAudioForTranscription, decodeAudioRange } from "../src/capture/audioExtraction";

const { decodeMp4AudioRange } = vi.hoisted(() => ({
  decodeMp4AudioRange: vi.fn<() => Promise<DecodedAudio | null>>(),
}));
vi.mock("../src/capture/mp4AudioDecoder", () => ({ decodeMp4AudioRange }));

// jsdom's File has no arrayBuffer().
const file = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(3)) } as unknown as File;

function stubAudioContext(decodeAudioData: () => Promise<unknown>) {
  const close = vi.fn(() => Promise.resolve());
  vi.stubGlobal(
    "AudioContext",
    class {
      decodeAudioData = decodeAudioData;
      close = close;
    },
  );
  return { close };
}

function fakeBuffer(channels: Float32Array[], sampleRate: number) {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData: (channel: number) => channels[channel],
  };
}

beforeEach(() => {
  decodeMp4AudioRange.mockReset();
  decodeMp4AudioRange.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeAudioForTranscription", () => {
  it("keeps the decoder's error as the cause of the no-audio message", async () => {
    const decodeFailure = new DOMException("Unable to decode audio data", "EncodingError");
    const { close } = stubAudioContext(() => Promise.reject(decodeFailure));

    const failure = await decodeAudioForTranscription(file, 0, 1).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Vid2GridError);
    expect((failure as Vid2GridError).code).toBe("no_audio");
    expect((failure as Error).message).toBe("This video has no decodable audio track.");
    expect((failure as Error).cause).toBe(decodeFailure);
    expect(close).toHaveBeenCalled();
  });

  it("downmixes to mono and slices to the requested window", async () => {
    const left = Float32Array.from([1, 1, 1, 1]);
    const right = Float32Array.from([0, 0, 0, 0]);
    stubAudioContext(() => Promise.resolve(fakeBuffer([left, right], 4)));

    const samples = await decodeAudioForTranscription(file, 0.25, 0.75);

    expect(Array.from(samples)).toEqual([0.5, 0.5]);
  });
});

describe("decodeAudioRange", () => {
  it("hands over the whole track without a copy when the range covers it", async () => {
    const mono = Float32Array.from([0.5, 0, 1]);
    stubAudioContext(() => Promise.resolve(fakeBuffer([mono], 16000)));
    const slice = vi.spyOn(Float32Array.prototype, "slice");

    const audio = await decodeAudioRange(file, 0, Number.POSITIVE_INFINITY);

    expect(slice).toHaveBeenCalledOnce();
    slice.mockRestore();

    expect(Array.from(audio.samples)).toEqual([0.5, 0, 1]);
    expect(audio.sampleRate).toBe(16000);
  });

  it("copies only the samples of a partial range", async () => {
    const mono = Float32Array.from([1, 2, 3, 4]);
    stubAudioContext(() => Promise.resolve(fakeBuffer([mono], 2)));

    const audio = await decodeAudioRange(file, 0.5, Number.POSITIVE_INFINITY);

    expect(Array.from(audio.samples)).toEqual([2, 3, 4]);
    expect(audio.samples.buffer).not.toBe(mono.buffer);
  });
});

describe("decodeAudioRange choosing a path", () => {
  it("uses the ranged MP4 decode when it accepts the file, with the signal", async () => {
    const ranged = { samples: new Float32Array(4), sampleRate: 16000 };
    decodeMp4AudioRange.mockResolvedValue(ranged);
    const { close } = stubAudioContext(() => Promise.reject(new Error("unused")));
    const controller = new AbortController();

    expect(await decodeAudioRange(file, 1, 2, controller.signal)).toBe(ranged);
    expect(decodeMp4AudioRange).toHaveBeenCalledWith(file, 1, 2, 16000, controller.signal);
    expect(close).not.toHaveBeenCalled();
  });

  it("decodes the whole file when the ranged decode declines it", async () => {
    const { close } = stubAudioContext(() =>
      Promise.resolve(fakeBuffer([Float32Array.from([1, 2])], 16000)),
    );

    const audio = await decodeAudioRange(file, 0, Number.POSITIVE_INFINITY);

    expect(Array.from(audio.samples)).toEqual([1, 2]);
    expect(close).toHaveBeenCalled();
  });

  it("passes on the ranged decode's no-audio and undecodable errors", async () => {
    const undecodable = new Vid2GridError("undecodable_audio", "Cannot decode.");
    decodeMp4AudioRange.mockRejectedValue(undecodable);

    await expect(decodeAudioRange(file, 0, 1)).rejects.toBe(undecodable);
  });
});

describe("decodeAudioRange abort on the whole-file path", () => {
  it("stops after reading the file", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const reading = {
      arrayBuffer: () => {
        controller.abort(reason);
        return Promise.resolve(new ArrayBuffer(3));
      },
    } as unknown as File;
    const decodeAudioData = vi.fn(() => Promise.resolve(fakeBuffer([new Float32Array(2)], 16000)));
    stubAudioContext(decodeAudioData);

    await expect(decodeAudioRange(reading, 0, 1, controller.signal)).rejects.toBe(reason);
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it("stops after decoding the file", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    stubAudioContext(() => {
      controller.abort(reason);
      return Promise.resolve(fakeBuffer([new Float32Array(2)], 16000));
    });

    await expect(decodeAudioRange(file, 0, 1, controller.signal)).rejects.toBe(reason);
  });

  it("never reads a file once already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(3)));

    await expect(
      decodeAudioRange({ arrayBuffer } as unknown as File, 0, 1, controller.signal),
    ).rejects.toThrow("stopped");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
