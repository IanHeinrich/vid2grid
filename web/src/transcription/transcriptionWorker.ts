/**
 * Off-main-thread Whisper transcription. Downloads (once; cached by the
 * browser afterwards) and runs an automatic-speech-recognition pipeline via
 * transformers.js, so neither the model download nor inference blocks the UI
 * thread. Unlike `renderWorker.ts`, this worker is reused across a whole
 * session (one lazily-created worker, not a pool) since the model only needs
 * loading once and inference is a single sequential job, not independently
 * parallelizable batches.
 */
import {
  pipeline,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
  type WhisperTokenizer,
} from "@huggingface/transformers";

const MODEL_ID = "Xenova/whisper-tiny.en";
const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;

export interface TranscribeRequest {
  samples: Float32Array;
}

export interface TranscriptionChunk {
  text: string;
  start: number;
  end: number;
}

/**
 * "model" covers the one-time (browser-cached) download of the model's
 * weights; "transcribe" covers actually running it on the audio. Reported
 * separately so the UI can show a distinct, honest label for each - the
 * model stage has a real byte-accurate percentage, the transcribe stage
 * only an approximate "still working" heartbeat (transformers.js doesn't
 * expose real inference progress).
 */
export type TranscribeStage = "model" | "transcribe";

export type TranscribeWorkerMessage =
  | { type: "progress"; stage: TranscribeStage; percent: number }
  | { type: "result"; chunks: TranscriptionChunk[] }
  | { type: "error"; message: string };

// The DOM lib types `self` as a Window; cast to just the worker surface we use
// so we don't have to pull in the conflicting WebWorker lib (see renderWorker.ts).
interface TranscriptionWorkerScope {
  onmessage: ((event: MessageEvent<TranscribeRequest>) => void) | null;
  postMessage(message: TranscribeWorkerMessage): void;
}

const scope = self as unknown as TranscriptionWorkerScope;

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    // The model ships as several files (weights, tokenizer, configs); weigh
    // progress by bytes rather than averaging per-file percentages so the
    // (tiny) config/tokenizer files don't get equal billing with the (much
    // larger) weights file.
    const fileBytes = new Map<string, { loaded: number; total: number }>();
    transcriberPromise = pipeline<"automatic-speech-recognition">("automatic-speech-recognition", MODEL_ID, {
      progress_callback: (info) => {
        if (info.status === "progress") {
          fileBytes.set(info.file, { loaded: info.loaded, total: info.total });
        } else if (info.status === "done") {
          const known = fileBytes.get(info.file);
          fileBytes.set(info.file, { loaded: known?.total ?? 1, total: known?.total ?? 1 });
        } else {
          return;
        }
        let loaded = 0;
        let total = 0;
        for (const file of fileBytes.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        scope.postMessage({ type: "progress", stage: "model", percent: total > 0 ? (loaded / total) * 100 : 0 });
      },
    });
  }
  return transcriberPromise;
}

scope.onmessage = async (event) => {
  try {
    const transcriber = await getTranscriber();

    // transformers.js doesn't expose real inference progress, but Whisper's
    // own timestamp tokens mark the start/end of every recognized speech
    // segment - using those as a heartbeat at least proves the model is
    // still working, asymptotically approaching (never reaching) 100% so
    // the jump to the next phase still reads as "finishing", not "stuck".
    let pulses = 0;
    // The pipeline's tokenizer is typed generically as `PreTrainedTokenizer`,
    // but is always a `WhisperTokenizer` here since MODEL_ID is a whisper model.
    const streamer = new WhisperTextStreamer(transcriber.tokenizer as WhisperTokenizer, {
      on_chunk_end: () => {
        pulses++;
        const percent = Math.min(95, 100 - 100 / (1 + pulses * 0.5));
        scope.postMessage({ type: "progress", stage: "transcribe", percent });
      },
    });

    const output = await transcriber(event.data.samples, {
      return_timestamps: true,
      chunk_length_s: CHUNK_LENGTH_S,
      stride_length_s: STRIDE_LENGTH_S,
      streamer,
    });
    scope.postMessage({ type: "progress", stage: "transcribe", percent: 100 });

    const result = Array.isArray(output) ? output[0] : output;
    const chunks: TranscriptionChunk[] = (result.chunks ?? []).map((chunk) => ({
      text: chunk.text.trim(),
      start: chunk.timestamp[0],
      end: chunk.timestamp[1] ?? chunk.timestamp[0],
    }));
    scope.postMessage({ type: "result", chunks });
  } catch (err) {
    scope.postMessage({ type: "error", message: (err as Error).message });
  }
};
