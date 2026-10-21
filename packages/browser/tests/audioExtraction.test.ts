import { Vid2GridError } from "@vid2grid/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeAudioForTranscription } from "../src/capture/audioExtraction";

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
