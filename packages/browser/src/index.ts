import type { CollagePorts, PortProgressCallback, TranscriptCue } from "@vid2grid/core";
import { readKeyframeTimes, probeVideo } from "./probe/probe";
import { extractFramesAuto } from "./capture/frameExtraction";
import { decodeAudioForTranscription } from "./capture/audioExtraction";
import { renderSheetsToBlobs } from "./render/sheetRenderer";
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
    frames: { capture: extractFramesAuto },
    sheets: { encode: renderSheetsToBlobs },
    text: { encodeText: (text, mimeType) => new Blob([text], { type: mimeType }) },
    transcript: { transcribe: transcribeVideoAudio },
    clock: { now: () => performance.now() },
  };
}

export { probeVideo, countKeyframesInRange } from "./probe/probe";
export { supportsWebCodecs } from "./capture/isoBmff";
