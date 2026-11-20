import type { LabelWordings, PortCallOptions, PortProgress } from "@vid2grid/core";
import { requestFromWorker } from "../shared/workerRequest";
import { resampleLinear } from "./resample";
import type { SoundScoreRequest } from "./soundClassificationWorker";

// CLAP's feature extractor expects 48 kHz audio.
export const CLAP_SAMPLE_RATE = 48000;

let sharedWorker: Worker | null = null;

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL("./soundClassificationWorker.ts", import.meta.url), {
      type: "module",
    });
  }
  return sharedWorker;
}

export function scoreSoundWindows(
  windows: Float32Array[],
  sampleRate: number,
  labels: readonly LabelWordings[],
  call: PortCallOptions = {},
): Promise<number[][]> {
  const clips = windows.map((window) => resampleLinear(window, sampleRate, CLAP_SAMPLE_RATE));
  const request: SoundScoreRequest = { labels, windows: clips };
  return requestFromWorker<SoundScoreRequest, PortProgress, number[][]>(
    getWorker(),
    request,
    clips.map((clip) => clip.buffer),
    { onProgress: call.onProgress, signal: call.signal },
  );
}
