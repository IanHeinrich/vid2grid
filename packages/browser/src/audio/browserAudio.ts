import {
  analyseAudio,
  type AudioAnalysisOptions,
  type AudioAnalysisPorts,
  type AudioAnalysisRequest,
  type AudioTrack,
} from "@vid2grid/core";
import { DECODED_SAMPLE_RATE, decodeAudioRange } from "../capture/audioExtraction";
import { transcribeInPieces } from "../transcribe/transcription";
import { resampleLinear } from "./resample";
import { scoreSoundWindows } from "./soundClassification";

// Each analysis decodes only its own range of an MP4 or MOV (other files are decoded whole and
// sliced), and nothing is cached between analyses.
export function createBrowserAudioPorts(file: File): AudioAnalysisPorts {
  return {
    decode: (startSeconds, endSeconds, call = {}) =>
      decodeAudioRange(file, startSeconds, endSeconds, call.signal),
    scoreWindows: scoreSoundWindows,
    transcribe: (samples, sampleRate, offsetSeconds, call = {}) =>
      transcribeInPieces(
        sampleRate === DECODED_SAMPLE_RATE
          ? samples
          : resampleLinear(samples, sampleRate, DECODED_SAMPLE_RATE),
        DECODED_SAMPLE_RATE,
        offsetSeconds,
        call.onProgress,
        call.signal,
      ),
  };
}

export function analyseVideoAudio(
  file: File,
  request: AudioAnalysisRequest,
  options?: AudioAnalysisOptions,
): Promise<AudioTrack> {
  return analyseAudio(request, createBrowserAudioPorts(file), options);
}
