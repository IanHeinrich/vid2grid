/**
 * Talks to the transcription worker and turns its raw chunk output into
 * timestamped cues plus a WebVTT document.
 */
import type { TranscribeRequest, TranscribeStage, TranscribeWorkerMessage } from "./transcriptionWorker";

export type { TranscribeStage };

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export type TranscribeProgress = (stage: TranscribeStage, percent: number) => void;

let sharedWorker: Worker | null = null;

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL("./transcriptionWorker.ts", import.meta.url), { type: "module" });
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

/** WebVTT requires a fixed-width HH:MM:SS.mmm timestamp, unlike the adaptive,
 * component-dropping format `renderer.ts` burns into grid cells. */
export function formatVttTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return (
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    `${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
  );
}

export function cuesToVtt(cues: TranscriptCue[]): string {
  if (cues.length === 0) return "WEBVTT\n";
  const body = cues
    .map((cue) => `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

/** Strips VTT structure down to just the spoken text, for lightweight gallery previews. */
export function vttToPlainText(vtt: string): string {
  return vtt
    .split("\n")
    .filter((line) => line.trim() !== "" && line !== "WEBVTT" && !line.includes("-->"))
    .join(" ")
    .trim();
}
