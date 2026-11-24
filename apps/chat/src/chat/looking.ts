import { modelVisionProfile } from "@vid2grid/core";
import { isAbortError } from "../abort";
import { textRequest, type ModelReply } from "../api/modelCall";
import { splitThink } from "../api/think";
import { blobToDataUrl } from "../dataUrl";
import { imageLabel } from "../imageRefs";
import { errorText, plural } from "../text";
import type {
  ApiSettings,
  ChatRequest,
  ContentPart,
  ImageRef,
  ImageStore,
  ModelInfo,
  SeenNote,
  StreamChat,
  TokenUsage,
} from "../types";
import { reasoningLimit, reasoningLoopWatch } from "./reasoningWatch";
import { isAbout } from "./seen";
import { renderedSide } from "./tokenEstimate";

// Images leave room in the looking model's context for what it is asked and what it answers.
const IMAGE_CONTEXT_SHARE = 0.5;
const MAX_EARLIER_NOTES = 6;
const MAX_EARLIER_CHARS = 6000;
const MAX_QUESTION_CHARS = 1500;
const MAX_EARLIER_QUESTION_CHARS = 300;
export const MAX_ANSWER_CHARS = 6000;
// Past the answer limit, since thinking can come as text before a closing tag that ends it.
const MAX_STREAMED_CHARS = 2 * MAX_ANSWER_CHARS;

export const LOOKING_SYSTEM_PROMPT = [
  "You look at pictures for another assistant, which cannot see them and relies on what you write.",
  "Describe only what is visible. Do not refuse to describe anything, do not moralise, and do not speculate beyond the picture.",
  "Give times in the video as [m:ss]. A frame from a video has its timestamp printed on it.",
  "Say when something is unclear or too small to make out.",
  "Call each picture by the name written before it. Be complete but brief.",
].join("\n");

export interface Looker {
  model: ModelInfo;
  api: ApiSettings;
  veniceParameters: boolean;
  streamChat: StreamChat;
  store: Pick<ImageStore, "getImage">;
  // Sheet side in px, for how many images fit in the looking model's context.
  resolution: number;
}

export interface LookRequest {
  kind: SeenNote["kind"];
  images: readonly ImageRef[];
  question: string;
  // What was said about the same images before.
  earlier?: readonly SeenNote[];
  signal: AbortSignal;
}

export class LookingError extends Error {
  constructor({ model, api }: Pick<Looker, "model" | "api">, problem: string, cause?: unknown) {
    super(
      `The looking model ${model.name} at ${serverName(api.baseUrl)} could not look at the pictures: ${problem}`,
      { cause },
    );
    this.name = "LookingError";
  }
}

export function serverName(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).host;
  } catch {
    return baseUrl.trim() === "" ? "no server" : baseUrl.trim();
  }
}

// In order, as many to a request as the model takes and half its context holds, each image counted
// at its own size.
export function lookBatches(
  { model, resolution }: Pick<Looker, "model" | "resolution">,
  images: readonly ImageRef[],
): ImageRef[][] {
  const most = Math.max(1, model.maxImages);
  const imageTokens = modelVisionProfile(model.id).imageTokens;
  const cost = (image: ImageRef) => imageTokens?.(renderedSide(image) ?? resolution) ?? 0;
  const room = (model.contextTokens ?? Number.POSITIVE_INFINITY) * IMAGE_CONTEXT_SHARE;
  const batches: ImageRef[][] = [];
  let used = 0;
  for (const image of images) {
    const batch = batches.at(-1);
    if (batch && batch.length < most && used + cost(image) <= room) {
      batch.push(image);
      used += cost(image);
    } else {
      batches.push([image]);
      used = cost(image);
    }
  }
  return batches;
}

function startOf({ source }: ImageRef): number | undefined {
  if (source.kind === "sheet") return source.startSeconds;
  return source.kind === "zoom" && source.target.kind === "moment"
    ? source.target.seconds
    : undefined;
}

// Those without a time, such as uploads, keep their order after the rest.
export function inTimeOrder(images: readonly ImageRef[]): ImageRef[] {
  const at = (image: ImageRef) => startOf(image) ?? Number.POSITIVE_INFINITY;
  return [...images].sort((a, b) => (at(a) === at(b) ? 0 : at(a) - at(b)));
}

export async function storedImages(
  store: Looker["store"],
  images: readonly ImageRef[],
): Promise<ImageRef[]> {
  const blobs = await Promise.all(images.map((image) => store.getImage(image.id)));
  return images.filter((_, index) => blobs[index] !== undefined);
}

async function imageParts(
  store: Looker["store"],
  images: readonly ImageRef[],
): Promise<ContentPart[]> {
  const parts = await Promise.all(
    images.map(async (image): Promise<ContentPart[]> => {
      const blob = await store.getImage(image.id);
      if (blob === undefined) throw new Error(`${imageLabel(image)} is no longer stored.`);
      return [
        { type: "text", text: imageLabel(image) },
        { type: "image_url", image_url: { url: await blobToDataUrl(blob) } },
      ];
    }),
  );
  return parts.flat();
}

function clipped(text: string, most: number): string {
  return text.length <= most ? text : `${text.slice(0, most).trimEnd()}…`;
}

// The newest notes that fit, oldest first.
function earlierText(request: LookRequest): string {
  const about = new Set(request.images.map((image) => image.id));
  const related = (request.earlier ?? []).filter((note) => isAbout(note, about));
  const lines: string[] = [];
  let left = MAX_EARLIER_CHARS;
  for (const { question, text } of related.slice(-MAX_EARLIER_NOTES).reverse()) {
    const asked = clipped(question?.trim() ?? "", MAX_EARLIER_QUESTION_CHARS);
    const line = `Asked: ${asked || "Describe the pictures."}\nAnswered: ${text}`;
    if (line.length > left) continue;
    left -= line.length;
    lines.unshift(line);
  }
  if (lines.length === 0) return "";
  return `What was asked and answered about these pictures before:\n\n${lines.join("\n\n")}`;
}

function taskText({ kind, images, question }: LookRequest): string {
  const asked = clipped(question.trim(), MAX_QUESTION_CHARS);
  if (kind === "answered") return `Answer this from the pictures: ${asked}`;
  const describe = `Describe ${images.length === 1 ? "this picture" : `these ${plural(images.length, "picture")}`}.`;
  return asked === "" ? describe : `${describe} Pay attention to what this asks: ${asked}`;
}

function answerIn(text: string): string {
  return splitThink(text, "").text.trim();
}

function longEnough(text: string): boolean {
  if (text.length >= MAX_STREAMED_CHARS) return true;
  return text.includes("</think>") && answerIn(text).length >= MAX_ANSWER_CHARS;
}

// Left as soon as there is enough, so a model that never stops costs no more than that.
async function streamAnswer(
  { api, streamChat }: Looker,
  request: ChatRequest,
  signal: AbortSignal,
): Promise<ModelReply> {
  signal.throwIfAborted();
  const enough = new AbortController();
  const looping = reasoningLoopWatch(reasoningLimit("normal"));
  let text = "";
  let usage: TokenUsage | undefined;
  const limited = AbortSignal.any([signal, enough.signal]);
  for await (const event of streamChat(api, request, limited)) {
    if (event.type === "text") text += event.delta;
    if (event.type === "usage") usage = event.usage;
    if (event.type === "reasoning" && text === "" && looping(event.delta)) {
      enough.abort();
      throw new Error("it kept thinking without answering.");
    }
    if (longEnough(text)) {
      enough.abort();
      break;
    }
  }
  signal.throwIfAborted();
  return { text: clipped(answerIn(text), MAX_ANSWER_CHARS), ...(usage ? { usage } : {}) };
}

export async function lookAt(looker: Looker, request: LookRequest): Promise<SeenNote> {
  const { model, veniceParameters } = looker;
  const { kind, images, question, signal } = request;
  let reply: ModelReply;
  try {
    const texts = [earlierText(request), taskText(request)].filter((text) => text !== "");
    const content: ContentPart[] = [
      ...(await imageParts(looker.store, images)),
      ...texts.map((text): ContentPart => ({ type: "text", text })),
    ];
    const chatRequest = textRequest(
      { modelId: model.id, veniceParameters },
      [
        { role: "system", content: LOOKING_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      { usage: true },
    );
    reply = await streamAnswer(looker, chatRequest, signal);
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error;
    throw new LookingError(looker, errorText(error), error);
  }
  const { text } = reply;
  if (text === "") throw new LookingError(looker, "its answer was empty.");
  return {
    kind,
    imageIds: images.map((image) => image.id),
    modelId: model.id,
    ...(question.trim() === "" ? {} : { question }),
    text,
    ...(reply.usage ? { usage: reply.usage } : {}),
  };
}
