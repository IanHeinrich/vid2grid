import { imagesOf } from "../imageRefs";
import type { ChatMessage, ChatRequest, WireMessage } from "../types";

const CHARS_PER_TOKEN = 4;
export const FALLBACK_IMAGE_TOKENS = 1500;

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

// Keyed by the URL each image is sent as, since the request no longer names its images.
export function sheetSidesByUrl(
  messages: readonly ChatMessage[],
  dataUrls: ReadonlyMap<string, string>,
): Map<string, number> {
  const sides = new Map<string, number>();
  for (const message of messages) {
    for (const { id, source } of imagesOf(message)) {
      const url = dataUrls.get(id);
      if (url !== undefined && source.kind === "sheet" && source.resolution !== undefined) {
        sides.set(url, source.resolution);
      }
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
