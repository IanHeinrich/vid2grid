// Decodes only the audio a range needs, reading its sample bytes rather than the whole mdat.
import type { Descriptor, ISOFile, Movie, Track } from "mp4box";
import {
  MICROSECONDS_PER_SECOND,
  secondsToMicroseconds,
  type AbortSignalLike,
  type DecodedAudio,
} from "@vid2grid/core";
import { resampleLinear } from "../audio/resample";
import { throwIfAborted } from "./abort";
import { noAudioTrackError, undecodableAudioError } from "./audioErrors";
import {
  AUDIO_PREROLL_SECONDS,
  byteRuns,
  presentationOffsetSeconds,
  sampleEndSeconds,
  sampleSeconds,
  samplesForRange,
  trimToRange,
  type ByteRun,
  type SampleSpan,
  type StoredSample,
} from "./audioRange";
import { MAX_READ_BYTES, readBytes } from "./fileBytes";
import { looksLikeIsoBmff } from "./isoBmff";
import { readMovie } from "./mp4Movie";

const MAX_DECODE_QUEUE_SIZE = 64;
// Room for a decoder that emits a little more than the samples' stated durations.
const DECODER_SLACK_SECONDS = 1;
const DECODER_CONFIG_DESCRIPTOR_TAG = 4;
const DECODER_SPECIFIC_INFO_TAG = 5;
const SOUND_HANDLER = "soun";
const AAC_CODEC_PREFIX = "mp4a.40";
const MP3_IN_MP4_CODECS = new Set(["mp4a.6b", "mp4a.69"]);

interface EsdsEntry {
  esds?: { esd?: Descriptor };
  wave?: { esds?: { esd?: Descriptor } };
}

interface SecondsRange {
  startSeconds: number;
  endSeconds: number;
}

interface DecodedSpan {
  samples: Float32Array;
  sampleRate: number;
  startSeconds: number;
}

function audioSpecificConfig(isoFile: ISOFile, track: Track): Uint8Array | undefined {
  const [entry] = isoFile.getTrackById(track.id).mdia.minf.stbl.stsd.entries as EsdsEntry[];
  const esd = entry?.esds?.esd ?? entry?.wave?.esds?.esd;
  const decoderConfig = esd?.findDescriptor(DECODER_CONFIG_DESCRIPTOR_TAG) as
    Descriptor | undefined;
  const specificInfo = decoderConfig?.findDescriptor(DECODER_SPECIFIC_INFO_TAG) as
    Descriptor | undefined;
  return specificInfo?.data;
}

export function audioDecoderConfig(isoFile: ISOFile, track: Track): AudioDecoderConfig | null {
  const sampleRate = track.audio?.sample_rate;
  const numberOfChannels = track.audio?.channel_count;
  if (!sampleRate || !numberOfChannels) return null;
  const codec = track.codec.toLowerCase();
  if (codec.startsWith(AAC_CODEC_PREFIX)) {
    const description = audioSpecificConfig(isoFile, track);
    return description ? { codec: track.codec, sampleRate, numberOfChannels, description } : null;
  }
  if (MP3_IN_MP4_CODECS.has(codec)) return { codec: "mp3", sampleRate, numberOfChannels };
  if (codec === "opus") return { codec: "opus", sampleRate, numberOfChannels };
  return { codec: track.codec, sampleRate, numberOfChannels };
}

function createMonoAccumulator({ startSeconds, endSeconds }: SecondsRange) {
  const spanSeconds = Math.max(0, endSeconds - startSeconds);
  let mono: Float32Array | null = null;
  let sampleRate = 0;
  return {
    write(data: AudioData): void {
      sampleRate ||= data.sampleRate;
      mono ??= new Float32Array(Math.ceil((spanSeconds + DECODER_SLACK_SECONDS) * sampleRate));
      const target = mono;
      const at = Math.round((data.timestamp / MICROSECONDS_PER_SECOND - startSeconds) * sampleRate);
      const plane = new Float32Array(data.numberOfFrames);
      for (let channel = 0; channel < data.numberOfChannels; channel++) {
        data.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
        plane.forEach((value, frame) => {
          const index = at + frame;
          if (index < 0 || index >= target.length) return;
          target[index] = (target[index] ?? 0) + value / data.numberOfChannels;
        });
      }
    },
    result(): DecodedSpan | null {
      return mono ? { samples: mono, sampleRate, startSeconds } : null;
    },
  };
}

function decodeRun(
  decoder: AudioDecoder,
  samples: readonly StoredSample[],
  run: ByteRun,
  bytes: Uint8Array,
  offsetSeconds: number,
): void {
  let at = 0;
  for (let index = run.first; index < run.end; index++) {
    const sample = samples[index];
    if (!sample) continue;
    decoder.decode(
      new EncodedAudioChunk({
        type: "key",
        timestamp: secondsToMicroseconds(sampleSeconds(sample, offsetSeconds)),
        duration: secondsToMicroseconds(sample.duration / sample.timescale),
        data: bytes.subarray(at, at + sample.size),
      }),
    );
    at += sample.size;
  }
}

// A wrapper because TS otherwise carries stale "state !== closed" narrowing across an `await`.
function isDecoderOpen(decoder: AudioDecoder): boolean {
  return decoder.state === "configured";
}

// A sample can claim far more time than the range asked for, which bounds the buffer instead.
function clampToRange(samples: SecondsRange, range: SecondsRange): SecondsRange {
  return {
    startSeconds: Math.max(samples.startSeconds, range.startSeconds - AUDIO_PREROLL_SECONDS),
    endSeconds: Math.min(samples.endSeconds, range.endSeconds),
  };
}

async function decodeSpan(
  file: File,
  samples: readonly StoredSample[],
  span: SampleSpan,
  bounds: SecondsRange,
  offsetSeconds: number,
  config: AudioDecoderConfig,
  signal: AbortSignalLike | undefined,
): Promise<DecodedSpan> {
  const accumulator = createMonoAccumulator(bounds);
  let failure: unknown;
  let reading = false;
  let wake = (): void => {};
  const decoder = new AudioDecoder({
    output: (data) => {
      try {
        accumulator.write(data);
      } finally {
        data.close();
      }
    },
    error: (error) => {
      failure = error;
      wake();
    },
  });

  const roomInQueue = async (): Promise<void> => {
    while (decoder.decodeQueueSize > MAX_DECODE_QUEUE_SIZE && isDecoderOpen(decoder)) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        decoder.addEventListener("dequeue", () => resolve(), { once: true });
      });
    }
  };

  try {
    decoder.configure(config);
    for (const run of byteRuns(samples, span, MAX_READ_BYTES)) {
      reading = true;
      const bytes = new Uint8Array(await readBytes(file, run.offset, run.length, signal));
      reading = false;
      if (failure !== undefined) break;
      decodeRun(decoder, samples, run, bytes, offsetSeconds);
      await roomInQueue();
    }
    if (failure === undefined) await decoder.flush();
  } catch (err) {
    if (signal?.aborted || reading) throw err;
    failure ??= err;
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }

  const decoded = accumulator.result();
  if (failure !== undefined || !decoded) throw undecodableAudioError(config.codec, failure);
  return decoded;
}

// mp4box files a sample entry it does not know, such as PCM or ALAC in a MOV, with no media type.
function missingAudioError({ moov }: ISOFile, movie: Movie): Error {
  const sound = moov?.traks.find((trak) => trak.mdia.hdlr.handler === SOUND_HANDLER);
  if (!sound) return noAudioTrackError();
  const track = movie.tracks.find(({ id }) => id === sound.tkhd.track_id);
  return undecodableAudioError(track?.codec ?? "unknown");
}

async function supportedConfig(isoFile: ISOFile, track: Track): Promise<AudioDecoderConfig> {
  const config = audioDecoderConfig(isoFile, track);
  if (!config) throw undecodableAudioError(track.codec);
  try {
    const support = await AudioDecoder.isConfigSupported(config);
    if (support.supported) return config;
  } catch (err) {
    throw undecodableAudioError(track.codec, err);
  }
  throw undecodableAudioError(track.codec);
}

export type Resample = (samples: Float32Array, fromRate: number, toRate: number) => Float32Array;

export interface Mp4Audio {
  // Where the track ends on the video's timeline.
  readonly endSeconds: number;
  decodeRange(
    startSeconds: number,
    endSeconds: number,
    sampleRate: number,
    signal?: AbortSignalLike,
    resample?: Resample,
  ): Promise<DecodedAudio>;
}

/** `null` means this path declines the file and the caller should decode it whole. */
export async function openMp4Audio(file: File, signal?: AbortSignalLike): Promise<Mp4Audio | null> {
  if (typeof AudioDecoder === "undefined" || !looksLikeIsoBmff(file)) return null;
  const parsed = await readMovie(file, signal);
  if (!parsed || parsed.movie.isFragmented) return null;
  const track = parsed.movie.audioTracks[0];
  if (!track) throw missingAudioError(parsed.isoFile, parsed.movie);
  const config = await supportedConfig(parsed.isoFile, track);
  throwIfAborted(signal);

  // Copied so that the parsed movie, video sample table included, can be collected.
  const samples: StoredSample[] = parsed.isoFile
    .getTrackSamplesInfo(track.id)
    .map(({ cts, duration, timescale, offset, size }) => ({
      cts,
      duration,
      timescale,
      offset,
      size,
    }));
  const offsetSeconds = presentationOffsetSeconds(
    track.edits,
    track.movie_timescale,
    track.timescale,
  );
  const lastSample = samples.at(-1);

  return {
    endSeconds: lastSample ? sampleEndSeconds(lastSample, offsetSeconds) : 0,
    async decodeRange(startSeconds, endSeconds, sampleRate, signal, resample = resampleLinear) {
      const span = samplesForRange(samples, offsetSeconds, startSeconds, endSeconds);
      const first = span && samples[span.first];
      const last = span && samples[span.end - 1];
      if (!first || !last) return { samples: new Float32Array(0), sampleRate };

      const spanSeconds = {
        startSeconds: sampleSeconds(first, offsetSeconds),
        endSeconds: sampleEndSeconds(last, offsetSeconds),
      };
      const decoded = await decodeSpan(
        file,
        samples,
        span,
        clampToRange(spanSeconds, { startSeconds, endSeconds }),
        offsetSeconds,
        config,
        signal,
      );
      const resampled = resample(decoded.samples, decoded.sampleRate, sampleRate);
      const audioEnd = Math.min(endSeconds, sampleEndSeconds(last, offsetSeconds));
      return {
        samples: trimToRange(resampled, sampleRate, decoded.startSeconds, startSeconds, audioEnd),
        sampleRate,
      };
    },
  };
}

/** `null` as for openMp4Audio. */
export async function decodeMp4AudioRange(
  file: File,
  startSeconds: number,
  endSeconds: number,
  sampleRate: number,
  signal?: AbortSignalLike,
): Promise<DecodedAudio | null> {
  const audio = await openMp4Audio(file, signal);
  return audio ? audio.decodeRange(startSeconds, endSeconds, sampleRate, signal) : null;
}
