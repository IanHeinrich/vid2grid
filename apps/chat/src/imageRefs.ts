import { plural } from "./text";
import { formatSpan, formatTimestamp } from "./time";
import type { ChatMessage, ImageRef, ImageSource } from "./types";

export type SheetSource = Extract<ImageSource, { kind: "sheet" }>;
export type ZoomSource = Extract<ImageSource, { kind: "zoom" }>;

export function imagesOf(message: ChatMessage): readonly ImageRef[] {
  return message.role === "assistant" ? [] : message.images;
}

function sheetContents(source: SheetSource): string {
  return `${formatSpan(source.startSeconds, source.endSeconds)}, ${plural(source.frameCount, "frame")}`;
}

export function zoomContents({ target, area }: ZoomSource): string {
  const across = `${area.left} to ${area.right} across`;
  const down = `${area.top} to ${area.bottom} down`;
  const of = target.kind === "moment" ? formatTimestamp(target.seconds, true) : target.name;
  return `part of ${of}, ${across} and ${down}, in thousandths`;
}

export function sheetLine({ source }: ImageRef): string | undefined {
  return source.kind === "sheet" ? `${source.name}: ${sheetContents(source)}` : undefined;
}

// Sheet names repeat across renders, so a sheet is recalled by its name and the call that made it.
export function recallName({ source }: ImageRef): string {
  return source.kind === "sheet" ? `${source.name} from ${source.call}` : source.name;
}

export function imageLabel(ref: ImageRef): string {
  const { source } = ref;
  switch (source.kind) {
    case "sheet":
      return `${recallName(ref)}: ${sheetContents(source)}`;
    case "upload":
      return `image ${source.name}`;
    case "zoom":
      return `${source.name}: ${zoomContents(source)}`;
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
