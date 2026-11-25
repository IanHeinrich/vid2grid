import type { Chat, ChatMessage, ImageRef, ImageUse } from "./types";

// What can refer to stored images and to videos.
export interface ImageHolder {
  messages?: readonly ChatMessage[];
  refs?: readonly ImageRef[];
  videoKeys?: readonly string[];
}

type OnUnknown = (what: string) => void;

const skip: OnUnknown = () => undefined;

// Something unread may refer to an image, so a deletion stops rather than guess.
export const refuse = (what: string): never => {
  throw new Error(`${what} is of a kind this version does not know, so nothing is deleted.`);
};

const ROLES: readonly unknown[] = ["user", "assistant", "tool"] satisfies ChatMessage["role"][];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalId(value: unknown, what: string, onUnknown: OnUnknown): string[] {
  if (typeof value === "string") return [value];
  if (value !== undefined) onUnknown(what);
  return [];
}

function listIn(value: unknown, what: string, onUnknown: OnUnknown): unknown[] {
  if (Array.isArray(value)) return value as unknown[];
  if (value !== undefined) onUnknown(what);
  return [];
}

function idsInSource(source: unknown, onUnknown: OnUnknown): string[] {
  const kind = isRecord(source) ? source["kind"] : undefined;
  if (!isRecord(source)) {
    onUnknown("A stored image's source");
  } else if (kind === "upload") {
    return optionalId(source["originalId"], "A stored image's original", onUnknown);
  } else if (kind === "zoom") {
    return idsInTarget(source["target"], onUnknown);
  } else if (kind !== "sheet") {
    onUnknown("A stored image's source");
  }
  return [];
}

function idsInTarget(target: unknown, onUnknown: OnUnknown): string[] {
  const kind = isRecord(target) ? target["kind"] : undefined;
  if (isRecord(target) && kind === "image" && typeof target["id"] === "string") {
    return [target["id"]];
  }
  if (kind !== "moment") onUnknown("What a stored zoom shows");
  return [];
}

function idsInRef(ref: unknown, onUnknown: OnUnknown): string[] {
  if (!isRecord(ref) || typeof ref["id"] !== "string") {
    onUnknown("A stored image");
    return [];
  }
  return [ref["id"], ...idsInSource(ref["source"], onUnknown)];
}

// Images and swipes are read on every role, whatever the types say it can hold.
function idsInMessage(message: unknown, onUnknown: OnUnknown): string[] {
  if (!isRecord(message)) {
    onUnknown("A stored message");
    return [];
  }
  const { role, images, alternates } = message;
  if (!ROLES.includes(role)) onUnknown("A stored message");
  if (images === undefined && role !== "assistant") onUnknown("A stored message's images");
  const refs = listIn(images, "A stored message's images", onUnknown);
  const replies = listIn(alternates, "A stored message's other replies", onUnknown);
  return [
    ...refs.flatMap((ref) => idsInRef(ref, onUnknown)),
    ...replies.flatMap((reply) => idsInReply(reply, onUnknown)),
  ];
}

function idsInReply(reply: unknown, onUnknown: OnUnknown): string[] {
  const messages = isRecord(reply) ? reply["messages"] : undefined;
  if (messages === undefined) onUnknown("A stored reply");
  const list = listIn(messages, "A stored reply", onUnknown);
  return list.flatMap((message) => idsInMessage(message, onUnknown));
}

function readIds({ messages = [], refs = [] }: ImageHolder, onUnknown: OnUnknown): Set<string> {
  return new Set([
    ...refs.flatMap((ref) => idsInRef(ref, onUnknown)),
    ...messages.flatMap((message) => idsInMessage(message, onUnknown)),
  ]);
}

// Every stored image these refer to, replies kept as swipes and the originals behind zooms included.
export function imageIdsIn(holder: ImageHolder): Set<string> {
  return readIds(holder, skip);
}

// The same for what must be kept: anything it cannot read throws.
export function checkedImageIds(holder: ImageHolder): Set<string> {
  return readIds(holder, refuse);
}

function checkedFileKey(video: unknown): string {
  const fileKey = isRecord(video) ? video["fileKey"] : undefined;
  return typeof fileKey === "string" ? fileKey : refuse("A stored video");
}

// A video removed from its chat is read like any other, but is not in use.
export function checkedVideoKeys(
  chats: readonly Chat[],
  messages: readonly ChatMessage[],
): Set<string> {
  const keys = [...chats, ...messages].flatMap((holder: unknown) => {
    if (!isRecord(holder)) return refuse("A stored video");
    const { video, removedVideo, removedVideos } = holder;
    if (removedVideo !== undefined) checkedFileKey(removedVideo);
    for (const removed of listIn(removedVideos, "A stored video", refuse)) {
      checkedFileKey(isRecord(removed) ? removed["video"] : undefined);
    }
    return video === undefined ? [] : [checkedFileKey(video)];
  });
  return new Set(keys);
}

// What a dropped thing referred to; an unreadable part is left out, and so kept.
export function imageUse(holder: ImageHolder): ImageUse {
  return { images: imageIdsIn(holder), videos: new Set(holder.videoKeys) };
}

export function checkedImageUse(holder: ImageHolder): ImageUse {
  return { images: checkedImageIds(holder), videos: new Set(holder.videoKeys) };
}

export function joinUses(uses: readonly ImageUse[]): ImageUse {
  return {
    images: new Set(uses.flatMap(({ images }) => [...images])),
    videos: new Set(uses.flatMap(({ videos }) => [...videos])),
  };
}
