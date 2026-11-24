import { findTimestamps } from "../time";
import type { ChatMessage, ImageRef } from "../types";
import { imagesOf, type SheetSource } from "../imageRefs";

// Sheet times are rounded and frames sheets and zooms show instants, so a citation this close is seen.
const SEEN_TOLERANCE_SECONDS = 0.5;

export interface SeenSpan {
  startSeconds: number;
  endSeconds: number;
  framesPerSecond: number;
}

interface Coverage {
  startSeconds: number;
  endSeconds: number;
  frames: number;
}

function distinctImages(messages: readonly ChatMessage[]): ImageRef[] {
  return [...new Map(messages.flatMap(imagesOf).map((image) => [image.id, image])).values()];
}

function frameInstants(call: string): number[] {
  const match = /^frames?\((.*)\)$/.exec(call);
  if (!match) return [];
  const bracketed = (match[1] ?? "")
    .split(",")
    .map((label) => `[${label.trim()}]`)
    .join("");
  return findTimestamps(bracketed).map((found) => found.seconds);
}

function padded(startSeconds: number, endSeconds: number, frames: number): Coverage {
  return {
    startSeconds: Math.max(0, startSeconds - SEEN_TOLERANCE_SECONDS),
    endSeconds: endSeconds + SEEN_TOLERANCE_SECONDS,
    frames,
  };
}

function sheetCoverage(source: SheetSource): Coverage[] {
  const instants = frameInstants(source.call);
  if (instants.length > 0) return instants.map((t) => padded(t, t, 1));
  return [padded(source.startSeconds, source.endSeconds, source.frameCount)];
}

function imageCoverage({ source }: ImageRef): Coverage[] {
  if (source.kind === "sheet") return sheetCoverage(source);
  if (source.kind === "zoom" && source.target.kind === "moment") {
    return [padded(source.target.seconds, source.target.seconds, 1)];
  }
  return [];
}

export function seenSpans(messages: readonly ChatMessage[]): SeenSpan[] {
  const covered = distinctImages(messages)
    .flatMap(imageCoverage)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const merged: Coverage[] = [];
  for (const next of covered) {
    const last = merged[merged.length - 1];
    if (last && next.startSeconds <= last.endSeconds) {
      last.endSeconds = Math.max(last.endSeconds, next.endSeconds);
      last.frames += next.frames;
    } else {
      merged.push({ ...next });
    }
  }
  return merged.map(({ startSeconds, endSeconds, frames }) => ({
    startSeconds,
    endSeconds,
    framesPerSecond: frames / (endSeconds - startSeconds),
  }));
}

export function unseenCitations(text: string, spans: readonly SeenSpan[]): number[] {
  const cited = new Set(findTimestamps(text, { bare: false }).map((found) => found.seconds));
  return [...cited].filter(
    (seconds) => !spans.some((span) => seconds >= span.startSeconds && seconds <= span.endSeconds),
  );
}
