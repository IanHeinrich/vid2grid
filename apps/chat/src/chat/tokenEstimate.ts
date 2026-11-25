import { addUsage, usageCostUsd } from "../api/usage";
import { imagesOf } from "../imageRefs";
import type {
  ChatMessage,
  ChatRequest,
  ImageRef,
  ModelInfo,
  TokenUsage,
  WireMessage,
} from "../types";
import { seenNotes } from "./seen";

export const CHARS_PER_TOKEN = 4;
export const FALLBACK_IMAGE_TOKENS = 1500;
const WARN_SHARE = 0.7;
const DANGER_SHARE = 0.9;

export type ContextLevel = "ok" | "warn" | "danger";

function wireText(message: WireMessage): string {
  switch (message.role) {
    case "system":
    case "tool":
      return message.content;
    case "user":
      if (typeof message.content === "string") return message.content;
      return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    case "assistant":
      return [
        message.content ?? "",
        ...(message.tool_calls ?? []).map((call) => call.function.name + call.function.arguments),
      ].join("");
  }
}

function imageUrls(message: WireMessage): string[] {
  if (message.role !== "user" || typeof message.content === "string") return [];
  return message.content.flatMap((part) => (part.type === "image_url" ? [part.image_url.url] : []));
}

export function requestImageCount(request: ChatRequest): number {
  return request.messages.reduce((sum, message) => sum + imageUrls(message).length, 0);
}

// A zoom is not square, so it is priced as the square of the same area.
export function renderedSide({ source }: ImageRef): number | undefined {
  if (source.kind === "sheet") return source.resolution;
  return source.kind === "zoom" ? Math.ceil(Math.sqrt(source.width * source.height)) : undefined;
}

// Keyed by the URL each image is sent as, since the request no longer names its images.
export function sheetSidesByUrl(
  messages: readonly ChatMessage[],
  dataUrls: ReadonlyMap<string, string>,
): Map<string, number> {
  const sides = new Map<string, number>();
  for (const message of messages) {
    for (const image of imagesOf(message)) {
      const url = dataUrls.get(image.id);
      const side = renderedSide(image);
      if (url !== undefined && side !== undefined) sides.set(url, side);
    }
  }
  return sides;
}

// A rough count before sending, for display only: four characters a token plus a cost per image.
// Images missing from sides, such as uploads and older sheets, are priced at resolution.
export function estimateRequestTokens(
  request: ChatRequest,
  resolution: number,
  imageTokens?: (side: number) => number,
  sides: ReadonlyMap<string, number> = new Map(),
): number {
  const characters =
    request.messages.reduce((sum, message) => sum + wireText(message).length, 0) +
    (request.tools ? JSON.stringify(request.tools).length : 0);
  const imageCost = (url: string) =>
    imageTokens?.(sides.get(url) ?? resolution) ?? FALLBACK_IMAGE_TOKENS;
  const images = request.messages.flatMap(imageUrls);
  return (
    Math.ceil(characters / CHARS_PER_TOKEN) + images.reduce((sum, url) => sum + imageCost(url), 0)
  );
}

function trimmed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "");
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 10_000) return `${trimmed(count / 1000, 1)}k`;
  if (count < 999_500) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${trimmed(count / 1_000_000, 1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? "< $0.01" : `$${usd.toFixed(2)}`;
}

function totalOf(usages: readonly (TokenUsage | undefined)[]): TokenUsage | undefined {
  return usages.reduce((total, usage) => addUsage(total, usage), undefined);
}

function writerUsages(messages: readonly ChatMessage[]): (TokenUsage | undefined)[] {
  return messages.map((message) => (message.role === "assistant" ? message.usage : undefined));
}

// The writer's tokens and the looking model's.
export function usageTotals(messages: readonly ChatMessage[]): TokenUsage | undefined {
  const looking = messages.flatMap(seenNotes).map((note) => note.usage);
  return totalOf([...writerUsages(messages), ...looking]);
}

// Each model's tokens at its own price; whichever has no known price is left out.
export function totalCostUsd(
  messages: readonly ChatMessage[],
  pricing: ModelInfo["pricing"],
  lookingPricing: (modelId: string) => ModelInfo["pricing"] = () => undefined,
): number | undefined {
  const writer = totalOf(writerUsages(messages));
  const costs = [
    writer && usageCostUsd(writer, pricing),
    ...messages
      .flatMap(seenNotes)
      .map(({ usage, modelId }) => usage && usageCostUsd(usage, lookingPricing(modelId))),
  ].filter((cost) => cost !== undefined);
  return costs.length === 0 ? undefined : costs.reduce((sum, cost) => sum + cost, 0);
}

export function replyUsageText(messages: readonly ChatMessage[]): string {
  const usage = usageTotals(messages);
  return usage
    ? `${formatTokens(usage.promptTokens)} in / ${formatTokens(usage.completionTokens)} out`
    : "";
}

export function contextLevel(used: number, window: number | undefined): ContextLevel {
  if (window === undefined || window <= 0) return "ok";
  const share = used / window;
  return share > DANGER_SHARE ? "danger" : share > WARN_SHARE ? "warn" : "ok";
}
