import type {
  AbortSignalLike,
  CollagePorts,
  PortProgressCallback,
  TranscriptCue,
} from "@vid2grid/core";
import { readKeyframeTimes, probeVideo } from "./probe/probe";
import { extractFramesAuto } from "./capture/frameExtraction";
import { openSpeechAudio } from "./capture/audioExtraction";
import { renderConcurrency, renderSheetToBlob } from "./render/sheetRenderer";
import { transcribeTimed } from "./transcribe/transcription";

async function transcribeVideoAudio(
  file: File,
  startSeconds: number,
  endSeconds: number,
  onProgress?: PortProgressCallback,
  signal?: AbortSignalLike,
): Promise<TranscriptCue[]> {
  const audio = await openSpeechAudio(file, startSeconds, endSeconds, signal);
  return transcribeTimed(audio, startSeconds, onProgress, signal);
}

export function createBrowserPorts(): CollagePorts<File, ImageBitmap, Blob> {
  return {
    probe: { probe: probeVideo, readKeyframeTimes },
    // The WebCodecs path decides a keyframe decode from the demuxed sync samples, the same
    // times readKeyframeTimes reports, so it also catches a sampled plan that hit only keyframes.
    frames: {
      capture: (file, plan, _info, signal) => extractFramesAuto(file, plan, signal),
      release: (bitmap) => bitmap.close(),
    },
    sheets: { encode: renderSheetToBlob, concurrency: renderConcurrency() },
    text: { encodeText: (text, mimeType) => new Blob([text], { type: mimeType }) },
    transcript: { transcribe: transcribeVideoAudio },
    clock: { now: () => performance.now() },
  };
}

export { probeVideo, readFrameTimes, countKeyframesInRange } from "./probe/probe";
export { supportsWebCodecs } from "./capture/isoBmff";
export { analyseVideoAudio, createBrowserAudioPorts } from "./audio/browserAudio";
