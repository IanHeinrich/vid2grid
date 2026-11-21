import { imagesOf } from "../imageRefs";
import type { Chat, ChatMessage, EarlierImages, ImageRef, StorySoFar, UserMessage } from "../types";
import { latestOverview, selectImages } from "./imageSelection";

// How many leading messages the story stands in for, or undefined when it no longer applies.
export function storyCut(
  story: StorySoFar | undefined,
  messages: readonly ChatMessage[],
): number | undefined {
  if (!story) return undefined;
  const through = messages.findIndex((message) => message.id === story.throughMessageId);
  if (through >= 0) return through + 1;
  const { throughCreatedAt } = story;
  if (throughCreatedAt === undefined) return undefined;
  const after = messages.findIndex((message) => message.createdAt > throughCreatedAt);
  return after < 0 ? messages.length : after;
}

// A branch keeps the story only if everything it summarises was copied into the branch.
export function storyForBranch(
  story: StorySoFar | undefined,
  copied: readonly ChatMessage[],
): StorySoFar | undefined {
  if (!story) return undefined;
  if (copied.some((message) => message.id === story.throughMessageId)) return story;
  const { throughCreatedAt } = story;
  if (throughCreatedAt === undefined) return undefined;
  return copied.some((message) => message.createdAt >= throughCreatedAt) ? story : undefined;
}

interface StorySplit {
  earlier: readonly ChatMessage[];
  messages: readonly ChatMessage[];
  story?: string;
}

function splitStory(chat: Chat, messages: readonly ChatMessage[]): StorySplit {
  const { storySoFar } = chat;
  const cut = storyCut(storySoFar, messages);
  if (!storySoFar || cut === undefined) return { earlier: [], messages };
  return { earlier: messages.slice(0, cut), messages: messages.slice(cut), story: storySoFar.text };
}

// The messages a request still sends once the story so far stands in for the earlier ones.
export function visibleMessages(
  chat: Chat,
  messages: readonly ChatMessage[],
): readonly ChatMessage[] {
  return splitStory(chat, messages).messages;
}

const STORY_IMAGES_HEADING =
  "Images from earlier in the conversation, kept after the chat summary replaced it:";

// Pins outlive the story's cut, so they travel in a message of their own. So does the latest
// overview in send mode; describe mode would only stub it, so it is left behind.
function storyImagesMessage(
  earlier: readonly ChatMessage[],
  visible: readonly ChatMessage[],
  earlierImages: EarlierImages,
): UserMessage | undefined {
  const later = new Set(visible.flatMap((message) => imagesOf(message).map((image) => image.id)));
  const carryOverview = earlierImages === "send" && latestOverview(visible).length === 0;
  const overview = carryOverview ? latestOverview(earlier) : [];
  const overviewIds = new Set(overview.map((image) => image.id));
  const carried = new Map<string, ImageRef>();
  for (const image of earlier.flatMap(imagesOf)) {
    const wanted = image.pinned || overviewIds.has(image.id);
    if (wanted && !later.has(image.id) && !carried.has(image.id)) carried.set(image.id, image);
  }
  if (carried.size === 0) return undefined;
  const images = [...carried.values()];
  return { id: "story-images", createdAt: 0, role: "user", text: STORY_IMAGES_HEADING, images };
}

export interface SentView {
  carried: UserMessage | undefined;
  visible: readonly ChatMessage[];
  // The images carried past the story's cut, if any, then the visible messages.
  sent: readonly ChatMessage[];
  story: string | undefined;
}

export function sentView(chat: Chat, messages: readonly ChatMessage[]): SentView {
  const { earlier, messages: visible, story } = splitStory(chat, messages);
  const carried = storyImagesMessage(earlier, visible, chat.settings.earlierImages ?? "describe");
  return { carried, visible, sent: carried ? [carried, ...visible] : visible, story };
}

export function keptImages(
  chat: Chat,
  messages: readonly ChatMessage[],
  maxImages: number,
): Set<string> {
  return selectImages(sentView(chat, messages).sent, maxImages, chat.settings.earlierImages);
}
