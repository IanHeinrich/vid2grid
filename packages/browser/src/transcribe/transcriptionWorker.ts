// One reused worker rather than a pool like renderWorker.ts: the model loads once and
// inference is a single sequential job, not parallelizable batches.
import {
  pipeline,
  type AutomaticSpeechRecognitionOutput,
  type AutomaticSpeechRecognitionPipeline,
  type Tensor,
} from "@huggingface/transformers";
import type { PortProgress, TranscriptSegment } from "@vid2grid/core";
import { modelDownloadProgress } from "../shared/modelDownloadProgress";
import { serveWorkerRequests } from "../shared/serveWorkerRequests";
import type { SpeechWindow } from "./speechWindows";

const MODEL_ID = "Xenova/whisper-tiny.en";
const PERCENT_TOTAL = 100;

export interface WindowTokens {
  tokens: number[];
  stride: SpeechWindow["strideSeconds"];
}

// A clip comes back as one untimed segment. Windows of longer audio come back as tokens, to be
// handed over together as a join, which comes back as timed segments.
export type TranscribeRequest =
  | { kind: "clip"; samples: Float32Array }
  | { kind: "window"; samples: Float32Array }
  | { kind: "join"; windows: WindowTokens[] };

// The steps of transformers.js's own long-audio call, which only takes the audio whole. MODEL_ID
// makes the pipeline's parts Whisper ones; its types do not say so.
interface WhisperParts {
  processor: ((samples: Float32Array) => Promise<{ input_features: Tensor }>) & {
    feature_extractor: { config: { chunk_length: number } };
  };
  model: {
    generate(options: { inputs: Tensor; return_timestamps: true }): Promise<Tensor>;
    config: { max_source_positions: number };
  };
  tokenizer: {
    _decode_asr(
      windows: WindowTokens[],
      options: { time_precision: number; return_timestamps: true; force_full_sequences: false },
    ): [text: string, timed: { chunks: { text: string; timestamp: [number, number | null] }[] }];
  };
}

const reportProgress = serveWorkerRequests<
  TranscribeRequest,
  PortProgress,
  TranscriptSegment[] | number[]
>(transcribe);

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

async function transcribeClip(
  transcriber: AutomaticSpeechRecognitionPipeline,
  samples: Float32Array,
): Promise<TranscriptSegment[]> {
  const { text } = onlyResult(await transcriber(samples));
  return [{ text, start: 0, end: null }];
}

async function windowTokens(
  { processor, model }: WhisperParts,
  samples: Float32Array,
): Promise<number[]> {
  const { input_features: inputs } = await processor(samples);
  const output = await model.generate({ inputs, return_timestamps: true });
  const [tokens = []] = output.tolist() as bigint[][];
  return tokens.map(Number);
}

function joinWindows(
  { processor, model, tokenizer }: WhisperParts,
  windows: WindowTokens[],
): TranscriptSegment[] {
  const [, timed] = tokenizer._decode_asr(windows, {
    time_precision:
      processor.feature_extractor.config.chunk_length / model.config.max_source_positions,
    return_timestamps: true,
    force_full_sequences: false,
  });
  return timed.chunks.map(({ text, timestamp: [start, end] }) => ({ text, start, end }));
}

async function transcribe(request: TranscribeRequest): Promise<TranscriptSegment[] | number[]> {
  const transcriber = await getTranscriber();
  const parts = transcriber as unknown as WhisperParts;
  switch (request.kind) {
    case "clip":
      return transcribeClip(transcriber, request.samples);
    case "window":
      return windowTokens(parts, request.samples);
    case "join":
      return joinWindows(parts, request.windows);
  }
}
