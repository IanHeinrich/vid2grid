/**
 * The browser executor: core's ports implemented with the platform APIs a page
 * already has (`<video>`/`<canvas>`, WebCodecs, OffscreenCanvas workers, Web
 * Audio and a transformers.js Whisper worker).
 */
import type { CollagePorts, TranscribeStage, TranscriptCue } from "@vid2grid/core";
import { probeVideo } from "./probe";
import { extractFramesAuto } from "./extraction/frameExtraction";
import { decodeAudioForTranscription } from "./extraction/audioExtraction";
import { renderSheetsToBlobs } from "./rendering/sheetRenderer";
import { transcribeAudio } from "./transcription/transcription";

async function transcribeVideoAudio(
  file: File,
  startSeconds: number,
  endSeconds: number,
  onProgress?: (stage: TranscribeStage, percent: number) => void,
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
export { extractFramesAuto } from "./extraction/frameExtraction";
export { looksLikeIsoBmff } from "./extraction/isoBmff";
export { renderSheetsToBlobs } from "./rendering/sheetRenderer";
export { transcribeAudio } from "./transcription/transcription";
export { decodeAudioForTranscription } from "./extraction/audioExtraction";
export type { ExtractionProgress } from "./extraction/extractor";
