import { plural } from "../text";
import { findTimestamps, formatSpan } from "../time";
import type { ImageRef, ImageSource } from "../types";

export type SheetSource = Extract<ImageSource, { kind: "sheet" }>;

const LISTED_CALL = /^(frames?)\((.*)\)$/;

function toolName(call: string): string {
  if (call === "overview") return "Overview";
  return /^(\w+)\(/.exec(call)?.[1] ?? call;
}

export function imageCaption(ref: ImageRef): string {
  const { source } = ref;
  if (source.kind === "upload") return source.name;
  const listed = LISTED_CALL.exec(source.call);
  if (listed) return `${listed[1] ?? "frames"} · ${listed[2] ?? ""}`;
  const span = formatSpan(source.startSeconds, source.endSeconds);
  return `${toolName(source.call)} · ${span} · ${plural(source.frameCount, "frame")}`;
}

// Only frames calls name their exact times; other sheets sample evenly from first to last frame.
export function sheetCellTimes(source: SheetSource): number[] {
  const listed = LISTED_CALL.exec(source.call);
  if (listed) {
    const times = (listed[2] ?? "")
      .split(",")
      .flatMap((part) => findTimestamps(`[${part.trim()}]`).map((match) => match.seconds));
    if (times.length === source.frameCount) return times;
  }
  const { startSeconds, endSeconds, frameCount } = source;
  if (frameCount <= 1) return [startSeconds];
  const step = (endSeconds - startSeconds) / (frameCount - 1);
  return Array.from({ length: frameCount }, (_, index) => startSeconds + index * step);
}
