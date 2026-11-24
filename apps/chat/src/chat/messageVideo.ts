import { imagesOf } from "../imageRefs";
import type { Chat, ChatMessage, RemovedVideo, UserMessage, VideoAttachment } from "../types";

// The video attached on the message, whether or not it is still in the chat.
export function namedVideo(message: ChatMessage): VideoAttachment | undefined {
  return message.role === "user" ? (message.video ?? message.removedVideo) : undefined;
}

function liveVideo(message: ChatMessage): VideoAttachment | undefined {
  return message.role === "user" ? message.video : undefined;
}

// The video a message is about: the latest one attached at or before it. The chat's latest
// attachment stands for its current video, since a reattach of a changed file adds no message.
// A removed one stands only for itself.
export function videoForMessage(
  messages: Iterable<ChatMessage>,
  messageId: string | undefined,
  current: VideoAttachment | undefined,
  removed: readonly RemovedVideo[] = [],
): VideoAttachment | undefined {
  let about: ChatMessage | undefined;
  let governing: VideoAttachment | undefined;
  let latest: ChatMessage | undefined;
  for (const message of messages) {
    const video = namedVideo(message);
    if (video) {
      latest = message;
      if (!about) governing = video;
    }
    if (message.id === messageId) about = message;
  }
  if (!about) return current;
  const since = removedSince(removed, about);
  if (governing === undefined || latest === undefined) return since ?? current;
  if (governing.fileKey !== liveVideo(latest)?.fileKey) return governing;
  return since && since.fileKey !== governing.fileKey ? since : (current ?? governing);
}

// The chat's own video when the message was written, if it has been removed since.
function removedSince(
  removed: readonly RemovedVideo[],
  { createdAt }: ChatMessage,
): VideoAttachment | undefined {
  return removed.find(({ throughCreatedAt }) => throughCreatedAt >= createdAt)?.video;
}

// The video named at or before the first message to hold the image, since a recall repeats it later.
// The current video stands in only where no message names one: it may be a newer file or attachment.
export function videoForImage(
  messages: readonly ChatMessage[],
  imageId: string,
  current: VideoAttachment | undefined,
  removed: readonly RemovedVideo[] = [],
): VideoAttachment | undefined {
  let holder: ChatMessage | undefined;
  let governing: VideoAttachment | undefined;
  for (const message of messages) {
    governing = namedVideo(message) ?? governing;
    if (!imagesOf(message).some((image) => image.id === imageId)) continue;
    holder = message;
    break;
  }
  const since = holder && removedSince(removed, holder);
  if (governing === undefined && since) return since;
  const named = messages.some((message) => namedVideo(message) !== undefined);
  return named ? governing : current;
}

// The chat's earlier videos, newest first and each once, leaving out the one the current stands for.
export function olderVideos(
  messages: Iterable<ChatMessage>,
  current: VideoAttachment | undefined,
): VideoAttachment[] {
  const snapshots = [...messages].reverse().flatMap((message) => liveVideo(message) ?? []);
  const standIn = current ? snapshots[0]?.fileKey : undefined;
  const older: VideoAttachment[] = [];
  for (const video of snapshots) {
    const seen = [standIn, current?.fileKey, ...older.map((entry) => entry.fileKey)];
    if (!seen.includes(video.fileKey)) older.push(video);
  }
  return older;
}

// The keys that go with one of the chat's videos. A changed file reattached under its name adds no
// message, so the latest attachment is the chat's own video under an older key.
export function removalKeys(
  messages: readonly ChatMessage[],
  current: VideoAttachment | undefined,
  fileKey: string,
): Set<string> {
  const latest = messages.flatMap((message) => liveVideo(message) ?? []).at(-1);
  const own = current ? [current.fileKey] : [];
  if (latest && latest.name === current?.name) own.push(latest.fileKey);
  return new Set(own.includes(fileKey) ? own : [fileKey]);
}

// Removed from the chat and not attached again since.
export function wasRemoved(
  chat: Pick<Chat, "video" | "removedVideos">,
  messages: readonly ChatMessage[],
  fileKey: string,
): boolean {
  const has = (video: VideoAttachment | undefined) => video?.fileKey === fileKey;
  if (has(chat.video) || messages.some((message) => has(liveVideo(message)))) return false;
  const removed = (chat.removedVideos ?? []).some(({ video }) => has(video));
  return removed || messages.some((message) => has(namedVideo(message)));
}

export function withVideoRemoved(message: UserMessage): UserMessage {
  const { video } = message;
  if (!video) return message;
  const changed = { ...message, removedVideo: video };
  delete changed.video;
  return changed;
}

export function withVideoBack(message: UserMessage): UserMessage {
  const { removedVideo } = message;
  if (!removedVideo) return message;
  const changed = { ...message, video: removedVideo };
  delete changed.removedVideo;
  return changed;
}
