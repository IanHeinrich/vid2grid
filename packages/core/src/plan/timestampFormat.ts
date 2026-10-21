import type { TimestampFormat } from "./renderPlan";

export const FONT_HEIGHT_DIVISOR = 16;
export const MIN_FONT_SIZE = 8;

export const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const MS_PER_HOUR = SECONDS_PER_HOUR * MS_PER_SECOND;

export const twoDigits = (value: number): string => String(value).padStart(2, "0");

// Decided once per batch from its last timestamp, so components stay consistent
// across every sheet instead of flipping mid-batch. No frames means no text.
export function chooseTimestampFormat(
  lastTimestampSeconds: number | undefined,
  targetFps: number,
): TimestampFormat {
  if (lastTimestampSeconds === undefined) {
    return { showHours: false, showMinutes: false, showMilliseconds: false };
  }
  return {
    showHours: lastTimestampSeconds >= SECONDS_PER_HOUR,
    showMinutes: lastTimestampSeconds >= SECONDS_PER_MINUTE,
    showMilliseconds: targetFps > 1,
  };
}

export function formatTimestamp(seconds: number, format: TimestampFormat): string {
  const totalMs = Math.round(seconds * MS_PER_SECOND);
  const hours = Math.floor(totalMs / MS_PER_HOUR);
  const afterHoursMs = totalMs % MS_PER_HOUR;
  const minutes = Math.floor(afterHoursMs / MS_PER_MINUTE);
  const afterMinutesMs = afterHoursMs % MS_PER_MINUTE;
  const secs = Math.floor(afterMinutesMs / MS_PER_SECOND);
  const ms = afterMinutesMs % MS_PER_SECOND;

  const secondsText = format.showMilliseconds
    ? `${twoDigits(secs)}.${String(ms).padStart(3, "0")}`
    : twoDigits(secs);

  if (format.showHours) return `${twoDigits(hours)}:${twoDigits(minutes)}:${secondsText}`;
  if (format.showMinutes) return `${twoDigits(minutes)}:${secondsText}`;
  return secondsText;
}
