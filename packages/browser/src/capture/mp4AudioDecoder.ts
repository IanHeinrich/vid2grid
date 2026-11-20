// Decodes only the audio a range needs: the top-level boxes are walked header by header to
// find the moov, and only the sample bytes in range are read, so the mdat is never loaded whole.
import {
  createFile,
  MP4BoxBuffer,
  type Descriptor,
  type ISOFile,
  type Movie,
  type Sample,
  type Track,
} from "mp4box";
import {
  MICROSECONDS_PER_SECOND,
  secondsToMicroseconds,
  type AbortSignalLike,
  type DecodedAudio,
} from "@vid2grid/core";
import { resampleLinear } from "../audio/resample";
import { abortError } from "../shared/workerRequest";
import { noAudioTrackError, undecodableAudioError } from "./audioErrors";
import {
  BOX_HEADER_BYTES,
  byteRuns,
  LARGE_BOX_HEADER_BYTES,
  presentationOffsetSeconds,
  readBoxHeader,
  sampleEndSeconds,
  sampleSeconds,
  samplesForRange,
  trimToRange,
  type ByteRun,
  type SampleSpan,
} from "./audioRange";
import { looksLikeIsoBmff } from "./isoBmff";

const FILE_TYPE_BOX = "ftyp";
const MOVIE_BOX = "moov";
// Bounds each read, so a long range never pulls a large slice of the file at once.
const MAX_READ_BYTES = 4 * 1024 * 1024;
const MAX_DECODE_QUEUE_SIZE = 64;
// Room for a decoder that emits a little more than the samples' stated durations.
const DECODER_SLACK_SECONDS = 1;
const DECODER_CONFIG_DESCRIPTOR_TAG = 4;
const DECODER_SPECIFIC_INFO_TAG = 5;
const AAC_CODEC_PREFIX = "mp4a.40";
const MP3_IN_MP4_CODECS = new Set(["mp4a.6b", "mp4a.69"]);

interface EsdsEntry {
  esds?: { esd?: Descriptor };
  wave?: { esds?: { esd?: Descriptor } };
}

interface ParsedMovie {
  isoFile: ISOFile;
  movie: Movie;
}

interface DecodedSpan {
  samples: Float32Array;
  sampleRate: number;
  startSeconds: number;
}

function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

async function readBytes(
  file: File,
  offset: number,
  length: number,
  signal: AbortSignalLike | undefined,
): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  const bytes = await file.slice(offset, offset + length).arrayBuffer();
  throwIfAborted(signal);
  return bytes;
}

async function findTopLevelBox(
  file: File,
  type: string,
  signal: AbortSignalLike | undefined,
): Promise<{ offset: number; size: number } | null> {
  let offset = 0;
  while (offset + BOX_HEADER_BYTES <= file.size) {
    const view = new DataView(await readBytes(file, offset, LARGE_BOX_HEADER_BYTES, signal));
    const header = readBoxHeader(view, file.size - offset);
    if (!header) return null;
    if (header.type === type) return { offset, size: header.size };
    offset += header.size;
  }
  return null;
}

// ftyp plus moov is enough for mp4box to build the sample table, whose offsets are absolute.
// getInfo reads the brand from ftyp, so the moov alone is not.
async function readMovie(
  file: File,
  signal: AbortSignalLike | undefined,
): Promise<ParsedMovie | null> {
  const typeBox = await findTopLevelBox(file, FILE_TYPE_BOX, signal);
  const movieBox = await findTopLevelBox(file, MOVIE_BOX, signal);
  if (!typeBox || !movieBox) return null;
  const typeBytes = await readBytes(file, typeBox.offset, typeBox.size, signal);
  const movieBytes = await readBytes(file, movieBox.offset, movieBox.size, signal);
  const bytes = new Uint8Array(typeBytes.byteLength + movieBytes.byteLength);
  bytes.set(new Uint8Array(typeBytes));
  bytes.set(new Uint8Array(movieBytes), typeBytes.byteLength);
  const isoFile = createFile();
  let parseFailed = false;
  isoFile.onError = () => {
    parseFailed = true;
  };
  isoFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes.buffer, 0));
  isoFile.flush();
  if (parseFailed) return null;
  const movie = isoFile.getInfo();
  return movie.isFragmented ? null : { isoFile, movie };
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

function createMonoAccumulator(startSeconds: number, spanSeconds: number) {
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
  samples: readonly Sample[],
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

async function decodeSpan(
  file: File,
  samples: readonly Sample[],
  span: SampleSpan,
  offsetSeconds: number,
  config: AudioDecoderConfig,
  signal: AbortSignalLike | undefined,
): Promise<DecodedSpan> {
  const first = samples[span.first];
  const last = samples[span.end - 1];
  if (!first || !last) throw undecodableAudioError(config.codec);
  const startSeconds = sampleSeconds(first, offsetSeconds);
  const accumulator = createMonoAccumulator(
    startSeconds,
    sampleEndSeconds(last, offsetSeconds) - startSeconds,
  );
  let failure: unknown;
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
      const bytes = new Uint8Array(await readBytes(file, run.offset, run.length, signal));
      if (failure !== undefined) break;
      decodeRun(decoder, samples, run, bytes, offsetSeconds);
      await roomInQueue();
    }
    if (failure === undefined) await decoder.flush();
  } catch (err) {
    if (signal?.aborted) throw err;
    failure ??= err;
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }

  const decoded = accumulator.result();
  if (failure !== undefined || !decoded) throw undecodableAudioError(config.codec, failure);
  return decoded;
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

/** `null` means this path declines the file and the caller should decode it whole. */
export async function decodeMp4AudioRange(
  file: File,
  startSeconds: number,
  endSeconds: number,
  sampleRate: number,
  signal?: AbortSignalLike,
): Promise<DecodedAudio | null> {
  if (typeof AudioDecoder === "undefined" || !looksLikeIsoBmff(file)) return null;
  const parsed = await readMovie(file, signal);
  if (!parsed) return null;
  const track = parsed.movie.audioTracks[0];
  if (!track) throw noAudioTrackError();
  const config = await supportedConfig(parsed.isoFile, track);
  throwIfAborted(signal);

  const samples = parsed.isoFile.getTrackSamplesInfo(track.id);
  const offsetSeconds = presentationOffsetSeconds(
    track.edits,
    track.movie_timescale,
    track.timescale,
  );
  const span = samplesForRange(samples, offsetSeconds, startSeconds, endSeconds);
  const last = span && samples[span.end - 1];
  if (!span || !last) return { samples: new Float32Array(0), sampleRate };

  const decoded = await decodeSpan(file, samples, span, offsetSeconds, config, signal);
  const resampled = resampleLinear(decoded.samples, decoded.sampleRate, sampleRate);
  const audioEnd = Math.min(endSeconds, sampleEndSeconds(last, offsetSeconds));
  return {
    samples: trimToRange(resampled, sampleRate, decoded.startSeconds, startSeconds, audioEnd),
    sampleRate,
  };
}
