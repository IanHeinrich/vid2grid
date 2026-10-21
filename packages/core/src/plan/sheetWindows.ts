import { Vid2GridError } from "../errors";
import { gridTranscriptFileName } from "./gridFileName";
import { roundToMicroseconds } from "./framePlanning";
import type { TranscriptWindow } from "./renderPlan";

function requireTimestamp(timestamp: number | undefined): number {
  if (timestamp === undefined) {
    throw new Vid2GridError("internal", "a sheet has no frame timestamps");
  }
  return timestamp;
}

// Gaps between sheets are split at their midpoint so every cue in
// [startSeconds, endSeconds] lands in exactly one sheet's transcript.
export function computeSheetWindows(
  sheets: { timestamps: number[] }[],
  startSeconds: number,
  endSeconds: number,
): TranscriptWindow[] {
  const firstTimestamp = (index: number) => requireTimestamp(sheets[index]?.timestamps[0]);
  const lastTimestamp = (index: number) => requireTimestamp(sheets[index]?.timestamps.at(-1));
  return sheets.map((_, i) => ({
    startSeconds: roundToMicroseconds(
      i === 0 ? startSeconds : (lastTimestamp(i - 1) + firstTimestamp(i)) / 2,
    ),
    endSeconds: roundToMicroseconds(
      i === sheets.length - 1 ? endSeconds : (lastTimestamp(i) + firstTimestamp(i + 1)) / 2,
    ),
    fileName: gridTranscriptFileName(i),
  }));
}
