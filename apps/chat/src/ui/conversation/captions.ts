import { plural } from "../../text";
import { formatSpan, formatTimestamp } from "../../time";
import type { ImageRef } from "../../types";
import { LISTED_CALL } from "../../video/sheetCells";

function toolName(call: string): string {
  if (call === "overview") return "Overview";
  return /^(\w+)\(/.exec(call)?.[1] ?? call;
}

export function momentLabel(seconds: number): string {
  return formatTimestamp(seconds, seconds % 1 !== 0);
}

export function imageCaption(ref: ImageRef): string {
  const { source } = ref;
  if (source.kind === "zoom") {
    const { target } = source;
    return `Zoom · ${target.kind === "moment" ? momentLabel(target.seconds) : target.name}`;
  }
  if (source.kind === "upload") return source.name;
  const listed = LISTED_CALL.exec(source.call);
  if (listed) return `${listed[1] ?? "frames"} · ${listed[2] ?? ""}`;
  const span = formatSpan(source.startSeconds, source.endSeconds);
  return `${toolName(source.call)} · ${span} · ${plural(source.frameCount, "frame")}`;
}
