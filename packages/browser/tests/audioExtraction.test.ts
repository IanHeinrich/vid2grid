import { Vid2GridError, type DecodedAudio } from "@vid2grid/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAudioRange, openSpeechAudio } from "../src/capture/audioExtraction";
import type { Mp4Audio } from "../src/capture/mp4AudioDecoder";

const { decodeMp4AudioRange, openMp4Audio } = vi.hoisted(() => ({
  decodeMp4AudioRange: vi.fn<() => Promise<DecodedAudio | null>>(),
  openMp4Audio: vi.fn<() => Promise<Mp4Audio | null>>(),
}));
vi.mock("../src/capture/mp4AudioDecoder", () => ({ decodeMp4AudioRange, openMp4Audio }));

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
  openMp4Audio.mockReset();
  openMp4Audio.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openSpeechAudio on a file decoded whole", () => {
  it("keeps the decoder's error as the cause of the no-audio message", async () => {
    const decodeFailure = new DOMException("Unable to decode audio data", "EncodingError");
    const { close } = stubAudioContext(() => Promise.reject(decodeFailure));

    const failure = await openSpeechAudio(file, 0, 1).catch((err: unknown) => err);

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

    const audio = await openSpeechAudio(file, 0.25, 0.75);

    expect(audio.sampleCount).toBe(2);
    expect(Array.from(await audio.read(0, 2))).toEqual([0.5, 0.5]);
    expect(Array.from(await audio.read(1, 2))).toEqual([0.5]);
  });

  it.each([
    ["a codec AudioDecoder refuses", new Vid2GridError("undecodable_audio", "Cannot decode.")],
    ["a movie mp4box chokes on", new TypeError("Cannot read properties of undefined")],
  ])("is where %s ends up", async (_what, failure) => {
    openMp4Audio.mockRejectedValue(failure);
    stubAudioContext(() => Promise.resolve(fakeBuffer([Float32Array.from([1, 2])], 16000)));

    expect((await openSpeechAudio(file, 0, 1)).sampleCount).toBe(2);
  });

  it("stops waiting for the decode once aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    stubAudioContext(() => {
      controller.abort(reason);
      return new Promise(() => undefined);
    });

    await expect(openSpeechAudio(file, 0, 1, controller.signal)).rejects.toBe(reason);
  });
});

describe("openSpeechAudio on an MP4", () => {
  function mp4Audio(endSeconds: number, decoded: Float32Array) {
    const decodeRange = vi.fn<Mp4Audio["decodeRange"]>(() =>
      Promise.resolve({ samples: decoded, sampleRate: 16000 }),
    );
    openMp4Audio.mockResolvedValue({ endSeconds, decodeRange });
    return decodeRange;
  }

  it("counts the samples from the range's start to the track's end, decoding nothing", async () => {
    const decodeRange = mp4Audio(90, new Float32Array(0));

    expect((await openSpeechAudio(file, 30, 60)).sampleCount).toBe(30 * 16000);
    expect((await openSpeechAudio(file, 30, 1000)).sampleCount).toBe(60 * 16000);
    expect((await openSpeechAudio(file, 95, 1000)).sampleCount).toBe(0);
    expect(decodeRange).not.toHaveBeenCalled();
  });

  it("decodes just what is read, with the signal", async () => {
    const decodeRange = mp4Audio(90, new Float32Array(16000).fill(1));
    const { signal } = new AbortController();
    const audio = await openSpeechAudio(file, 30, 60);

    await audio.read(16000, 32000, signal);

    const [start, end, rate, passed] = decodeRange.mock.calls[0] ?? [];
    expect([start, end, rate]).toEqual([31, 32, 16000]);
    expect(passed).toBe(signal);
  });

  it("pads what the track does not reach, so every read has the length asked for", async () => {
    mp4Audio(90, Float32Array.from([1, 1]));
    const audio = await openSpeechAudio(file, 0, 60);

    expect(Array.from(await audio.read(0, 4))).toEqual([1, 1, 0, 0]);
  });

  const undecodable = new Vid2GridError("undecodable_audio", "Cannot decode.");
  const speechOf = (seconds: number, value: number) =>
    fakeBuffer([new Float32Array(seconds * 16000).fill(value)], 16000);

  it("decodes the whole file when the first read cannot be decoded", async () => {
    const decodeRange = mp4Audio(2, new Float32Array(0));
    decodeRange.mockRejectedValue(undecodable);
    const decodeAudioData = vi.fn(() => Promise.resolve(speechOf(1, 0.5)));
    stubAudioContext(decodeAudioData);
    const audio = await openSpeechAudio(file, 0, 2);

    expect(Array.from(await audio.read(0, 2))).toEqual([0.5, 0.5]);
    expect(Array.from(await audio.read(15999, 16001))).toEqual([0.5, 0]);
    expect(decodeRange).toHaveBeenCalledTimes(1);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("leaves a later stretch that cannot be decoded silent", async () => {
    const decodeRange = mp4Audio(90, new Float32Array(2).fill(1));
    const { close } = stubAudioContext(() => Promise.reject(new Error("unused")));
    const audio = await openSpeechAudio(file, 0, 90);
    await audio.read(0, 2);
    decodeRange.mockRejectedValueOnce(undecodable);

    expect(Array.from(await audio.read(2, 4))).toEqual([0, 0]);
    expect(Array.from(await audio.read(4, 6))).toEqual([1, 1]);
    expect(close).not.toHaveBeenCalled();
  });

  it("passes on a later read of the file that fails", async () => {
    const decodeRange = mp4Audio(90, new Float32Array(2).fill(1));
    const audio = await openSpeechAudio(file, 0, 90);
    await audio.read(0, 2);
    const unreadable = new DOMException("gone", "NotReadableError");
    decodeRange.mockRejectedValue(unreadable);

    await expect(audio.read(2, 4)).rejects.toBe(unreadable);
  });

  it("does not decode anything else for a read that was aborted", async () => {
    const reason = new Error("stopped");
    const controller = new AbortController();
    const decodeRange = mp4Audio(90, new Float32Array(0));
    decodeRange.mockImplementation(() => {
      controller.abort(reason);
      return Promise.reject(reason);
    });
    const { close } = stubAudioContext(() => Promise.reject(new Error("unused")));
    const audio = await openSpeechAudio(file, 0, 90);

    await expect(audio.read(0, 2, controller.signal)).rejects.toBe(reason);
    expect(close).not.toHaveBeenCalled();
  });

  it("does not decode anything else for an open that was aborted", async () => {
    const reason = new Error("stopped");
    openMp4Audio.mockRejectedValue(reason);

    await expect(openSpeechAudio(file, 0, 1, AbortSignal.abort(reason))).rejects.toBe(reason);
  });

  it("passes on the error for a video with no audio track", async () => {
    const noAudio = new Vid2GridError("no_audio", "No audio.");
    openMp4Audio.mockRejectedValue(noAudio);

    await expect(openSpeechAudio(file, 0, 1)).rejects.toBe(noAudio);
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
