import type { AbortSignalLike, DecodedAudio } from "@vid2grid/core";
import { abortError } from "../shared/workerRequest";
import { noDecodableAudioError } from "./audioErrors";
import { decodeMp4AudioRange } from "./mp4AudioDecoder";

// `decodeAudioData` resamples to its `AudioContext`'s rate, so constructing the context at
// Whisper's rate gets the resample for free.
export const DECODED_SAMPLE_RATE = 16000;

function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

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

export async function decodeAudioForTranscription(
  file: File,
  startTime: number,
  endTime: number,
): Promise<Float32Array> {
  return (await decodeWholeFile(file, startTime, endTime)).samples;
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
