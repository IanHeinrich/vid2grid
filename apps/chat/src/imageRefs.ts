import { plural } from "./text";
import { formatSpan, formatTimestamp } from "./time";
import type { ChatMessage, ImageRef } from "./types";

export function imagesOf(message: ChatMessage): readonly ImageRef[] {
  return message.role === "assistant" ? [] : message.images;
}

function sheetTime(startSeconds: number, endSeconds: number): string {
  return endSeconds > startSeconds
    ? formatSpan(startSeconds, endSeconds)
    : formatTimestamp(startSeconds);
}

// Sheet names repeat across renders, so a sheet is recalled by its name and the call that made it.
export function recallName({ source }: ImageRef): string {
  return source.kind === "sheet" ? `${source.name} from ${source.call}` : source.name;
}

export function imageLabel(ref: ImageRef): string {
  const { source } = ref;
  switch (source.kind) {
    case "sheet":
      return `${recallName(ref)}: ${sheetTime(source.startSeconds, source.endSeconds)}, ${plural(source.frameCount, "frame")}`;
    case "upload":
      return `image ${source.name}`;
  }
}

export type StubReason = "earlier" | "imageLimit" | "noVision";

export function imageStub(ref: ImageRef, reason: StubReason = "imageLimit"): string {
  if (reason === "noVision") {
    return `[${imageLabel(ref)}. Not attached: this model cannot see images.]`;
  }
  const recall = `call recall("${recallName(ref)}") to see it again`;
  if (ref.source.kind === "upload") return `[${imageLabel(ref)}, sent earlier; ${recall}]`;
  return reason === "earlier"
    ? `[${imageLabel(ref)}. Sent earlier; ${recall}.]`
    : `[${imageLabel(ref)}. Not attached, to stay within the image limit; ${recall}.]`;
}
