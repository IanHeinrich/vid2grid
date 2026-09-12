// One reused worker rather than a pool like renderWorker.ts: the model loads once and
// inference is a single sequential job, not parallelizable batches.
import {
  pipeline,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
  type WhisperTokenizer,
} from "@huggingface/transformers";
import type { TranscribeStage } from "@vid2grid/core";

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

export type TranscribeWorkerMessage =
  | { type: "progress"; stage: TranscribeStage; percent: number }
  | { type: "result"; chunks: TranscriptionChunk[] }
  | { type: "error"; message: string };

// The DOM lib types `self` as a Window, so cast to just the surface used here rather
// than pull in the conflicting WebWorker lib (see renderWorker.ts).
interface TranscriptionWorkerScope {
  onmessage: ((event: MessageEvent<TranscribeRequest>) => void) | null;
  postMessage(message: TranscribeWorkerMessage): void;
}

const scope = self as unknown as TranscriptionWorkerScope;

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    // Weighted by bytes, not averaged per file, so the tiny configs don't get equal
    // billing with the weights.
    const fileBytes = new Map<string, { loaded: number; total: number }>();
    transcriberPromise = pipeline<"automatic-speech-recognition">(
      "automatic-speech-recognition",
      MODEL_ID,
      {
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
          scope.postMessage({
            type: "progress",
            stage: "model",
            percent: total > 0 ? (loaded / total) * 100 : 0,
          });
        },
      },
    );
  }
  return transcriberPromise;
}

scope.onmessage = async (event) => {
  try {
    const transcriber = await getTranscriber();

    // transformers.js exposes no real inference progress, so Whisper's own segment
    // boundaries drive a heartbeat that approaches but never reaches 100%.
    let pulses = 0;
    // The pipeline types its tokenizer as `PreTrainedTokenizer`; MODEL_ID makes it a Whisper one.
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
