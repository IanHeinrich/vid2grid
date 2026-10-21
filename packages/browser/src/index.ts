import type { CollagePorts, PortProgressCallback, TranscriptCue } from "@vid2grid/core";
import { readKeyframeTimes, probeVideo } from "./probe/probe";
import { extractFramesAuto } from "./capture/frameExtraction";
import { decodeAudioForTranscription } from "./capture/audioExtraction";
import { renderConcurrency, renderSheetToBlob } from "./render/sheetRenderer";
import { transcribeAudio } from "./transcribe/transcription";

async function transcribeVideoAudio(
  file: File,
  startSeconds: number,
  endSeconds: number,
  onProgress?: PortProgressCallback,
): Promise<TranscriptCue[]> {
  const samples = await decodeAudioForTranscription(file, startSeconds, endSeconds);
  return transcribeAudio(samples, startSeconds, onProgress);
}

export function createBrowserPorts(): CollagePorts<File, ImageBitmap, Blob> {
  return {
    probe: { probe: probeVideo, readKeyframeTimes },
    // The WebCodecs path decides a keyframe decode from the demuxed sync samples, the same
    // times readKeyframeTimes reports, so it also catches a sampled plan that hit only keyframes.
    frames: {
      capture: (file, plan) => extractFramesAuto(file, plan),
      release: (bitmap) => bitmap.close(),
    },
    sheets: { encode: renderSheetToBlob, concurrency: renderConcurrency() },
    text: { encodeText: (text, mimeType) => new Blob([text], { type: mimeType }) },
    transcript: { transcribe: transcribeVideoAudio },
    clock: { now: () => performance.now() },
  };
}

export { probeVideo, countKeyframesInRange } from "./probe/probe";
export { supportsWebCodecs } from "./capture/isoBmff";
