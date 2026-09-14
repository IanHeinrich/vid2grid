import { gridTranscriptFileName } from "../grid/gridFileName";
import { roundToMicroseconds } from "./framePlanning";
import type { TranscriptWindow } from "./renderPlan";

// Gaps between sheets are split at their midpoint so every cue in
// [startSeconds, endSeconds] lands in exactly one sheet's transcript.
export function computeSheetWindows(
  sheets: { timestamps: number[] }[],
  startSeconds: number,
  endSeconds: number,
): TranscriptWindow[] {
  const firsts = sheets.map((sheet) => sheet.timestamps[0]);
  const lasts = sheets.map((sheet) => sheet.timestamps[sheet.timestamps.length - 1]);
  return sheets.map((_, i) => ({
    startSeconds: roundToMicroseconds(i === 0 ? startSeconds : (lasts[i - 1] + firsts[i]) / 2),
    endSeconds: roundToMicroseconds(
      i === sheets.length - 1 ? endSeconds : (lasts[i] + firsts[i + 1]) / 2,
    ),
    fileName: gridTranscriptFileName(i),
  }));
}
