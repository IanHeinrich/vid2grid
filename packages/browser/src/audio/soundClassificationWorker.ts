// One reused worker like transcriptionWorker.ts: the models load once, and each wording's
// text embedding is computed once and reused for every window scored against it.
import {
  AutoProcessor,
  AutoTokenizer,
  ClapAudioModelWithProjection,
  ClapTextModelWithProjection,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
  type Tensor,
} from "@huggingface/transformers";
import type { LabelWordings, PortProgress } from "@vid2grid/core";
import { modelDownloadProgress } from "../shared/modelDownloadProgress";
import { serveWorkerRequests } from "../shared/serveWorkerRequests";
import { clapPrompt } from "./clapPrompt";
import { meanDirection, similarityLogits, unitVector } from "./similarity";

const MODEL_ID = "Xenova/clap-htsat-unfused";
// Measured: the joint ClapModel's logits_per_audio divided by the projection embeddings' cosine.
const CLAP_LOGIT_SCALE = 18.66;
const PERCENT_TOTAL = 100;

export interface SoundScoreRequest {
  labels: readonly LabelWordings[];
  windows: Float32Array[];
}

interface ClapModels {
  tokenizer: PreTrainedTokenizer;
  textModel: PreTrainedModel;
  processor: Processor;
  audioModel: PreTrainedModel;
}

const reportProgress = serveWorkerRequests<SoundScoreRequest, PortProgress, number[][]>(
  scoreWindows,
);

let modelsPromise: Promise<ClapModels> | null = null;
const wordingEmbeddings = new Map<string, Float32Array>();

function getModels(): Promise<ClapModels> {
  if (!modelsPromise) {
    const progress_callback = modelDownloadProgress((percent) =>
      reportProgress({ done: percent, total: PERCENT_TOTAL }),
    );
    modelsPromise = Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
      ClapTextModelWithProjection.from_pretrained(MODEL_ID, { progress_callback }),
      AutoProcessor.from_pretrained(MODEL_ID, { progress_callback }),
      ClapAudioModelWithProjection.from_pretrained(MODEL_ID, { progress_callback }),
    ]).then(([tokenizer, textModel, processor, audioModel]) => ({
      tokenizer,
      textModel,
      processor,
      audioModel,
    }));
  }
  return modelsPromise;
}

function tensorRows(tensor: Tensor): Float32Array[] {
  const [rows = 0, width = 0] = tensor.dims;
  const data = Float32Array.from(tensor.data as ArrayLike<number>);
  return Array.from({ length: rows }, (_, row) => data.subarray(row * width, (row + 1) * width));
}

async function embedWordings(models: ClapModels, wordings: readonly string[]): Promise<void> {
  const missing = [...new Set(wordings)].filter((wording) => !wordingEmbeddings.has(wording));
  if (missing.length === 0) return;
  const textInputs: unknown = models.tokenizer(missing.map(clapPrompt), {
    padding: true,
    truncation: true,
  });
  const { text_embeds } = (await models.textModel(textInputs)) as { text_embeds: Tensor };
  tensorRows(text_embeds).forEach((embedding, index) => {
    const wording = missing[index];
    if (wording !== undefined) wordingEmbeddings.set(wording, unitVector(embedding));
  });
}

async function labelEmbeddings(
  models: ClapModels,
  labels: readonly LabelWordings[],
): Promise<Float32Array[]> {
  await embedWordings(models, labels.flat());
  return labels.map((wordings) =>
    meanDirection(
      wordings
        .map((wording) => wordingEmbeddings.get(wording))
        .filter((embedding) => embedding !== undefined),
    ),
  );
}

async function audioEmbedding(models: ClapModels, window: Float32Array): Promise<Float32Array> {
  const audioInputs: unknown = await models.processor(window);
  const { audio_embeds } = (await models.audioModel(audioInputs)) as { audio_embeds: Tensor };
  const [embedding] = tensorRows(audio_embeds);
  if (!embedding) throw new Error("CLAP returned no audio embedding");
  return embedding;
}

async function scoreWindows({ labels, windows }: SoundScoreRequest): Promise<number[][]> {
  const models = await getModels();
  const labelVectors = await labelEmbeddings(models, labels);
  const logits: number[][] = [];
  for (const window of windows) {
    const embedding = await audioEmbedding(models, window);
    logits.push(similarityLogits(embedding, labelVectors, CLAP_LOGIT_SCALE));
  }
  return logits;
}
