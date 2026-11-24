import { imagesOf } from "../imageRefs";
import type { ChatMessage, VideoAttachment } from "../types";

// The video a message is about: the latest one attached at or before it. The chat's latest
// attachment stands for its current video, since a reattach of a changed file adds no message.
export function videoForMessage(
  messages: Iterable<ChatMessage>,
  messageId: string | undefined,
  current: VideoAttachment | undefined,
): VideoAttachment | undefined {
  let governing: VideoAttachment | undefined;
  let latest: VideoAttachment | undefined;
  let found = false;
  for (const message of messages) {
    if (message.role === "user" && message.video) {
      latest = message.video;
      if (!found) governing = message.video;
    }
    if (message.id === messageId) found = true;
  }
  if (!found || governing === undefined || governing.fileKey === latest?.fileKey) return current;
  return governing;
}

// The video named at or before the first message to hold the image, since a recall repeats it later.
// The current video stands in only where no message names one: it may be a newer file or attachment.
export function videoForImage(
  messages: readonly ChatMessage[],
  imageId: string,
  current: VideoAttachment | undefined,
): VideoAttachment | undefined {
  let governing: VideoAttachment | undefined;
  for (const message of messages) {
    if (message.role === "user" && message.video) governing = message.video;
    if (imagesOf(message).some((image) => image.id === imageId)) break;
  }
  const named = messages.some((message) => message.role === "user" && message.video);
  return named ? governing : current;
}

// The chat's earlier videos, newest first and each once, leaving out the one the current stands for.
export function olderVideos(
  messages: Iterable<ChatMessage>,
  current: VideoAttachment | undefined,
): VideoAttachment[] {
  const snapshots = [...messages]
    .reverse()
    .flatMap((message) => (message.role === "user" && message.video ? [message.video] : []));
  const standIn = current ? snapshots[0]?.fileKey : undefined;
  const older: VideoAttachment[] = [];
  for (const video of snapshots) {
    const seen = [standIn, current?.fileKey, ...older.map((entry) => entry.fileKey)];
    if (!seen.includes(video.fileKey)) older.push(video);
  }
  return older;
}
