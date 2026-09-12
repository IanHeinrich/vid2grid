/**
 * Talks to the transcription worker and turns its raw chunk output into
 * timestamped cues on the video's own timeline.
 */
import type { TranscribeStage, TranscriptCue } from "@vid2grid/core";
import type { TranscribeRequest, TranscribeWorkerMessage } from "./transcriptionWorker";

export type TranscribeProgress = (stage: TranscribeStage, percent: number) => void;

let sharedWorker: Worker | null = null;

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL("./transcriptionWorker.ts", import.meta.url), {
      type: "module",
    });
  }
  return sharedWorker;
}

/**
 * Transcribes `samples` (mono 16kHz PCM) and shifts every cue's timestamps by
 * `offsetSeconds` (the request's `startTime`) so cues land on the same
 * absolute video timeline as the frame timestamps already burned into each
 * grid cell.
 */
export function transcribeAudio(
  samples: Float32Array,
  offsetSeconds: number,
  onProgress?: TranscribeProgress,
): Promise<TranscriptCue[]> {
  return new Promise((resolve, reject) => {
    const worker = getWorker();

    const handleMessage = (event: MessageEvent<TranscribeWorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress?.(message.stage, message.percent);
        return;
      }
      cleanup();
      if (message.type === "error") {
        reject(new Error(message.message));
        return;
      }
      resolve(
        message.chunks.map((chunk) => ({
          start: chunk.start + offsetSeconds,
          end: chunk.end + offsetSeconds,
          text: chunk.text,
        })),
      );
    };
    const handleError = (event: ErrorEvent) => {
      cleanup();
      reject(event.error ?? new Error(event.message));
    };
    function cleanup(): void {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    }

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    const request: TranscribeRequest = { samples };
    worker.postMessage(request, [samples.buffer]);
  });
}
