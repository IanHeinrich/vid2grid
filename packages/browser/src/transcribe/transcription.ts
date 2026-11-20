import {
  cuesFromSegments,
  type AbortSignalLike,
  type PortProgress,
  type PortProgressCallback,
  type TranscriptCue,
  type TranscriptSegment,
} from "@vid2grid/core";
import { abortError, requestFromWorker, type WorkerRequestOptions } from "../shared/workerRequest";
import { speechPieces, spokenText } from "./speechPieces";
import type { TranscribeRequest } from "./transcriptionWorker";

let sharedWorker: Worker | null = null;

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL("./transcriptionWorker.ts", import.meta.url), {
      type: "module",
    });
  }
  return sharedWorker;
}

function requestTranscription(
  request: TranscribeRequest,
  options: WorkerRequestOptions<PortProgress>,
): Promise<TranscriptSegment[]> {
  return requestFromWorker(getWorker(), request, [request.samples.buffer], options);
}

/** `samples` is mono 16kHz PCM; `offsetSeconds` puts cues back on the absolute video timeline. */
export async function transcribeAudio(
  samples: Float32Array,
  offsetSeconds: number,
  onProgress?: PortProgressCallback,
  signal?: AbortSignalLike,
): Promise<TranscriptCue[]> {
  const segments = await requestTranscription(
    { samples, timestamps: true },
    { onProgress, signal },
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
  const onModelProgress = (progress: PortProgress): void => {
    if (progress.stage === "model") onProgress?.(progress);
  };
  const cues: TranscriptCue[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (signal?.aborted) throw abortError(signal);
    if (piece.audible) {
      const clip = samples.slice(piece.startIndex, piece.endIndex);
      const segments = await requestTranscription(
        { samples: clip, timestamps: false },
        { onProgress: onModelProgress, signal },
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
