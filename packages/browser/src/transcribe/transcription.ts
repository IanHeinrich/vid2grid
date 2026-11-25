import {
  cuesFromSegments,
  type AbortSignalLike,
  type PortProgress,
  type PortProgressCallback,
  type TranscriptCue,
  type TranscriptSegment,
} from "@vid2grid/core";
import { DECODED_SAMPLE_RATE, type SpeechAudio } from "../capture/audioExtraction";
import { abortError, requestFromWorker, type WorkerRequestOptions } from "../shared/workerRequest";
import { speechPieces, spokenText } from "./speechPieces";
import { speechWindows } from "./speechWindows";
import type { TranscribeRequest, WindowTokens } from "./transcriptionWorker";

let sharedWorker: Worker | null = null;

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL("./transcriptionWorker.ts", import.meta.url), {
      type: "module",
    });
  }
  return sharedWorker;
}

function requestTranscription<TResult>(
  request: TranscribeRequest,
  options: WorkerRequestOptions<PortProgress>,
): Promise<TResult> {
  const transfer = request.kind === "join" ? [] : [request.samples.buffer];
  return requestFromWorker(getWorker(), request, transfer, options);
}

// The worker times only its model download; the work itself is counted here.
function modelProgressOnly(onProgress: PortProgressCallback | undefined): PortProgressCallback {
  return (progress) => {
    if (progress.stage === "model") onProgress?.(progress);
  };
}

/** Timed cues for the whole of `audio`, holding one window of it at a time. `offsetSeconds` puts
 * the cues back on the absolute video timeline. */
export async function transcribeTimed(
  audio: SpeechAudio,
  offsetSeconds: number,
  onProgress?: PortProgressCallback,
  signal?: AbortSignalLike,
): Promise<TranscriptCue[]> {
  const options = { onProgress: modelProgressOnly(onProgress), signal };
  const windows = [...speechWindows(audio.sampleCount, DECODED_SAMPLE_RATE)];
  if (windows.length === 0) return [];
  const heard: WindowTokens[] = [];
  for (const { startIndex, endIndex, strideSeconds } of windows) {
    if (signal?.aborted) throw abortError(signal);
    const samples = await audio.read(startIndex, endIndex, signal);
    const tokens = await requestTranscription<number[]>({ kind: "window", samples }, options);
    heard.push({ tokens, stride: strideSeconds });
    onProgress?.({ stage: "transcribe", done: heard.length, total: windows.length });
  }
  const segments = await requestTranscription<TranscriptSegment[]>(
    { kind: "join", windows: heard },
    options,
  );
  return cuesFromSegments(segments, offsetSeconds);
}

// Whisper's timestamp mode often returns nothing for brief speech on its own, so each piece is
// decoded as plain text and stamped with the piece's own start and end.
export async function transcribeInPieces(
  samples: Float32Array,
  sampleRate: number,
  offsetSeconds: number,
  onProgress?: PortProgressCallback,
  signal?: AbortSignalLike,
): Promise<TranscriptCue[]> {
  const pieces = speechPieces(samples, sampleRate);
  const options = { onProgress: modelProgressOnly(onProgress), signal };
  const cues: TranscriptCue[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (signal?.aborted) throw abortError(signal);
    if (piece.audible) {
      const clip = samples.slice(piece.startIndex, piece.endIndex);
      const segments = await requestTranscription<TranscriptSegment[]>(
        { kind: "clip", samples: clip },
        options,
      );
      const text = spokenText(segments);
      if (text !== "") {
        cues.push({
          start: piece.startSeconds + offsetSeconds,
          end: piece.endSeconds + offsetSeconds,
          text,
        });
      }
    }
    onProgress?.({ stage: "transcribe", done: index + 1, total: pieces.length });
  }
  return cues;
}
