import { imagesOf } from "../imageRefs";
import type { ChatMessage, EarlierImages, ImageRef, UserMessage } from "../types";

function pinnedIds(messages: readonly ChatMessage[]): Set<string> {
  const pinned = new Set<string>();
  for (const message of messages) {
    for (const image of imagesOf(message)) if (image.pinned) pinned.add(image.id);
  }
  return pinned;
}

export function latestOverview(messages: readonly ChatMessage[]): ImageRef[] {
  for (const message of [...messages].reverse()) {
    const overview = imagesOf(message).filter(
      (image) => image.source.kind === "sheet" && image.source.call === "overview",
    );
    if (overview.length > 0) return overview;
  }
  return [];
}

function newestUserIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

export function newestUserMessage(messages: readonly ChatMessage[]): UserMessage | undefined {
  const newest = messages[newestUserIndex(messages)];
  return newest?.role === "user" ? newest : undefined;
}

// Keep going continues the investigation it follows, so a continuation does not start a turn.
function turnStartIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user" && message.continuation !== true) return index;
  }
  return newestUserIndex(messages);
}

// From the user message that started the investigation: what it asked and has produced so far.
export function currentTurn(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  return messages.slice(Math.max(0, turnStartIndex(messages)));
}

export function earlierMessageIds(
  messages: readonly ChatMessage[],
  earlierImages: EarlierImages,
): Set<string> {
  if (earlierImages === "send") return new Set();
  const earlier = messages.slice(0, Math.max(0, turnStartIndex(messages)));
  return new Set(earlier.map((message) => message.id));
}

// Send mode: the overview keeps up to half the free slots, so the whole video stays in view.
// Describe mode: only pins and the current turn's images, overview included, are candidates;
// anything earlier, an earlier overview too, is a stub the model can recall.
export function selectImages(
  messages: readonly ChatMessage[],
  maxImages: number,
  earlierImages: EarlierImages = "describe",
): Set<string> {
  const kept = pinnedIds(messages);
  const candidates = earlierImages === "send" ? messages : currentTurn(messages);
  let overviewSlots = Math.floor(Math.max(0, maxImages - kept.size) / 2);
  for (const image of latestOverview(candidates)) {
    if (overviewSlots === 0) break;
    if (kept.has(image.id)) continue;
    kept.add(image.id);
    overviewSlots -= 1;
  }
  let slots = Math.max(0, maxImages - kept.size);
  for (const message of [...candidates].reverse()) {
    for (const image of [...imagesOf(message)].reverse()) {
      if (slots === 0) return kept;
      if (kept.has(image.id)) continue;
      kept.add(image.id);
      slots -= 1;
    }
  }
  return kept;
}

export function pinsExceedCap(messages: readonly ChatMessage[], maxImages: number): boolean {
  return pinnedIds(messages).size > maxImages;
}
