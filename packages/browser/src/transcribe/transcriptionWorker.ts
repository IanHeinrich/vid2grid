// One reused worker rather than a pool like renderWorker.ts: the model loads once and
// inference is a single sequential job, not parallelizable batches.
import {
  pipeline,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionOutput,
  type AutomaticSpeechRecognitionPipeline,
  type WhisperTokenizer,
} from "@huggingface/transformers";
import type { PortProgress, TranscriptSegment } from "@vid2grid/core";
import { modelDownloadProgress } from "../shared/modelDownloadProgress";
import { serveWorkerRequests } from "../shared/serveWorkerRequests";

const MODEL_ID = "Xenova/whisper-tiny.en";
const CHUNK_LENGTH_S = 30;
const STRIDE_LENGTH_S = 5;
const PERCENT_TOTAL = 100;

export interface TranscribeRequest {
  samples: Float32Array;
  // Without timestamps the whole clip comes back as one segment at its start.
  timestamps: boolean;
}

const reportProgress = serveWorkerRequests<TranscribeRequest, PortProgress, TranscriptSegment[]>(
  transcribe,
);

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline<"automatic-speech-recognition">(
      "automatic-speech-recognition",
      MODEL_ID,
      {
        progress_callback: modelDownloadProgress((percent) =>
          reportProgress({ stage: "model", done: percent, total: PERCENT_TOTAL }),
        ),
      },
    );
  }
  return transcriberPromise;
}

function onlyResult(
  output: AutomaticSpeechRecognitionOutput | AutomaticSpeechRecognitionOutput[],
): AutomaticSpeechRecognitionOutput {
  const result = Array.isArray(output) ? output[0] : output;
  if (!result) throw new Error("Transcriber returned no result");
  return result;
}

async function transcribeWhole(
  transcriber: AutomaticSpeechRecognitionPipeline,
  samples: Float32Array,
): Promise<TranscriptSegment[]> {
  const { text } = onlyResult(await transcriber(samples));
  return [{ text, start: 0, end: null }];
}

async function transcribeTimed(
  transcriber: AutomaticSpeechRecognitionPipeline,
  samples: Float32Array,
): Promise<TranscriptSegment[]> {
  // transformers.js exposes no real inference progress, so Whisper's own segment
  // boundaries drive a heartbeat that approaches but never reaches 100%.
  let pulses = 0;
  // The pipeline types its tokenizer as `PreTrainedTokenizer`; MODEL_ID makes it a Whisper one.
  const streamer = new WhisperTextStreamer(transcriber.tokenizer as WhisperTokenizer, {
    on_chunk_end: () => {
      pulses++;
      const percent = Math.min(95, 100 - 100 / (1 + pulses * 0.5));
      reportProgress({ stage: "transcribe", done: percent, total: PERCENT_TOTAL });
    },
  });

  const output = await transcriber(samples, {
    return_timestamps: true,
    chunk_length_s: CHUNK_LENGTH_S,
    stride_length_s: STRIDE_LENGTH_S,
    streamer,
  });
  reportProgress({ stage: "transcribe", done: PERCENT_TOTAL, total: PERCENT_TOTAL });

  return (onlyResult(output).chunks ?? []).map((chunk) => ({
    text: chunk.text,
    start: chunk.timestamp[0],
    end: chunk.timestamp[1] ?? null,
  }));
}

async function transcribe(request: TranscribeRequest): Promise<TranscriptSegment[]> {
  const transcriber = await getTranscriber();
  return request.timestamps
    ? transcribeTimed(transcriber, request.samples)
    : transcribeWhole(transcriber, request.samples);
}
