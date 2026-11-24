import { Vid2GridError, type AbortSignalLike, type DecodedAudio } from "@vid2grid/core";
import { resampleLinear } from "../audio/resample";
import { throwIfAborted, untilAborted } from "./abort";
import { noDecodableAudioError } from "./audioErrors";
import { downsample } from "./downsample";
import { decodeMp4AudioRange, openMp4Audio, type Mp4Audio } from "./mp4AudioDecoder";

// `decodeAudioData` resamples to its `AudioContext`'s rate, so constructing the context at
// Whisper's rate gets the resample for free.
export const DECODED_SAMPLE_RATE = 16000;

// MP4 and MOV decode just the range; anything else, such as WebM, is decoded whole and sliced.
export async function decodeAudioRange(
  file: File,
  startTime: number,
  endTime: number,
  signal?: AbortSignalLike,
): Promise<DecodedAudio> {
  const ranged = await decodeMp4AudioRange(file, startTime, endTime, DECODED_SAMPLE_RATE, signal);
  return ranged ?? decodeWholeFile(file, startTime, endTime, signal);
}

export async function decodeWholeFile(
  file: File,
  startTime: number,
  endTime: number,
  signal?: AbortSignalLike,
): Promise<DecodedAudio> {
  throwIfAborted(signal);
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);
  const audioCtx = new AudioContext({ sampleRate: DECODED_SAMPLE_RATE });

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    throw noDecodableAudioError(err);
  } finally {
    void audioCtx.close();
  }
  throwIfAborted(signal);

  const mono = downmixToMono(audioBuffer);
  return {
    samples: sliceSamples(mono, audioBuffer.sampleRate, startTime, endTime),
    sampleRate: audioBuffer.sampleRate,
  };
}

/** Mono audio at `DECODED_SAMPLE_RATE`, in samples counted from the start of a range. */
export interface SpeechAudio {
  readonly sampleCount: number;
  // Each call's result is a buffer of its own, so it may be transferred.
  read(startIndex: number, endIndex: number, signal?: AbortSignalLike): Promise<Float32Array>;
}

// MP4 and MOV decode only what is read; anything else, such as WebM, is decoded whole here.
export async function openSpeechAudio(
  file: File,
  startTime: number,
  endTime: number,
  signal?: AbortSignalLike,
): Promise<SpeechAudio> {
  const decodeWhole = (): Promise<DecodedAudio> =>
    untilAborted(decodeWholeFile(file, startTime, endTime, signal), signal);
  const mp4 = await openDecodableMp4(file, signal);
  if (mp4) return rangedSpeech(mp4, startTime, endTime, decodeWhole);
  const { samples } = await decodeWhole();
  return {
    sampleCount: samples.length,
    read: (startIndex, endIndex) => Promise.resolve(samples.slice(startIndex, endIndex)),
  };
}

function isUndecodable(err: unknown): boolean {
  return err instanceof Vid2GridError && err.code === "undecodable_audio";
}

function isNoAudio(err: unknown): boolean {
  return err instanceof Vid2GridError && err.code === "no_audio";
}

// decodeAudioData reads its own way, so it may take what mp4box or AudioDecoder cannot, such as
// PCM in a MOV.
async function openDecodableMp4(
  file: File,
  signal: AbortSignalLike | undefined,
): Promise<Mp4Audio | null> {
  try {
    return await openMp4Audio(file, signal);
  } catch (err) {
    if (signal?.aborted || isNoAudio(err)) throw err;
    return null;
  }
}

function rangedSpeech(
  audio: Mp4Audio,
  startTime: number,
  endTime: number,
  decodeWhole: () => Promise<DecodedAudio>,
): SpeechAudio {
  const end = Math.min(endTime, audio.endSeconds);
  const toSeconds = (index: number): number => startTime + index / DECODED_SAMPLE_RATE;
  let hasDecoded = false;
  let whole: DecodedAudio | undefined;

  const decode: SpeechAudio["read"] = async (startIndex, endIndex, signal) => {
    if (!whole) {
      try {
        const { samples } = await audio.decodeRange(
          toSeconds(startIndex),
          toSeconds(endIndex),
          DECODED_SAMPLE_RATE,
          signal,
          resampleForSpeech,
        );
        hasDecoded ||= samples.length > 0;
        return samples;
      } catch (err) {
        throwIfAborted(signal);
        // A track that has decoded before is damaged only here, and decoding a long file whole for
        // that could run the tab out of memory. One that never has may suit decodeAudioData.
        if (hasDecoded && isUndecodable(err)) return new Float32Array(0);
        if (hasDecoded) throw err;
        whole = await decodeWhole();
      }
    }
    return whole.samples.subarray(startIndex, endIndex);
  };

  return {
    sampleCount: Math.max(0, Math.round((end - startTime) * DECODED_SAMPLE_RATE)),
    async read(startIndex, endIndex, signal) {
      const samples = await decode(startIndex, endIndex, signal);
      const speech = new Float32Array(endIndex - startIndex);
      speech.set(samples.subarray(0, speech.length));
      return speech;
    },
  };
}

function resampleForSpeech(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  return fromRate > toRate
    ? downsample(samples, fromRate, toRate)
    : resampleLinear(samples, fromRate, toRate);
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();

  const mixed = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    mixed.forEach((sum, i) => {
      mixed[i] = sum + (data[i] ?? 0) / buffer.numberOfChannels;
    });
  }
  return mixed;
}

// The decoded track is not kept, so a range covering all of it is handed over without a copy.
function sliceSamples(
  samples: Float32Array,
  sampleRate: number,
  startTime: number,
  endTime: number,
): Float32Array {
  const startIndex = Math.max(0, Math.floor(startTime * sampleRate));
  const endIndex = Math.min(samples.length, Math.ceil(endTime * sampleRate));
  if (startIndex === 0 && endIndex === samples.length) return samples;
  return samples.slice(startIndex, endIndex);
}
