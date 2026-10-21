import { clamp, roundToTenth } from "@vid2grid/core";

export type RangeHandle = "start" | "end";

export interface TimeRange {
  start: number;
  end: number;
}

const TENTHS_PER_SECOND = 10;
// The time inputs and slider step in tenths, so the range keeps at least one step open.
export const MIN_RANGE_GAP = 1 / TENTHS_PER_SECOND;

export function floorToTenth(seconds: number): number {
  return Math.floor(seconds * TENTHS_PER_SECOND) / TENTHS_PER_SECOND;
}

export function initialRange(durationSeconds: number): TimeRange {
  return { start: 0, end: Math.max(floorToTenth(durationSeconds), MIN_RANGE_GAP) };
}

export function scrubbedRange(
  handle: RangeHandle,
  seconds: number,
  current: TimeRange,
  durationSeconds: number,
): TimeRange {
  if (handle === "start") {
    const start = clamp(seconds, 0, Math.max(0, current.end - MIN_RANGE_GAP));
    return { start: roundToTenth(start), end: current.end };
  }
  const end = clamp(seconds, current.start + MIN_RANGE_GAP, durationSeconds);
  return { start: current.start, end: roundToTenth(end) };
}
