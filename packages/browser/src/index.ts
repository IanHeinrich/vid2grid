import type { CollagePorts, TranscribeProgressCallback, TranscriptCue } from "@vid2grid/core";
import { probeVideo } from "./probe";
import { extractFramesAuto } from "./extraction/frameExtraction";
import { decodeAudioForTranscription } from "./extraction/audioExtraction";
import { renderSheetsToBlobs } from "./rendering/sheetRenderer";
import { transcribeAudio } from "./transcription/transcription";

async function transcribeVideoAudio(
  file: File,
  startSeconds: number,
  endSeconds: number,
  onProgress?: TranscribeProgressCallback,
): Promise<TranscriptCue[]> {
  const samples = await decodeAudioForTranscription(file, startSeconds, endSeconds);
  return transcribeAudio(samples, startSeconds, onProgress);
}

export function createBrowserPorts(): CollagePorts<File, ImageBitmap, Blob> {
  return {
    probe: { probe: probeVideo },
    frames: { capture: extractFramesAuto },
    sheets: { encodeSheets: renderSheetsToBlobs },
    text: { encodeText: (text, mimeType) => new Blob([text], { type: mimeType }) },
    transcript: { transcribe: transcribeVideoAudio },
    clock: { now: () => performance.now() },
  };
}

export { probeVideo, countKeyframesInRange } from "./probe";
export { supportsWebCodecs } from "./extraction/isoBmff";
