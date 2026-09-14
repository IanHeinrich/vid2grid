import type { TimestampFormat } from "../plan/renderPlan";

export const FONT_HEIGHT_DIVISOR = 16;
export const MIN_FONT_SIZE = 8;

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
    showHours: lastTimestampSeconds >= 3600,
    showMinutes: lastTimestampSeconds >= 60,
    showMilliseconds: targetFps > 1,
  };
}

export function formatTimestamp(seconds: number, format: TimestampFormat): string {
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const afterHoursMs = totalMs % 3_600_000;
  const minutes = Math.floor(afterHoursMs / 60_000);
  const afterMinutesMs = afterHoursMs % 60_000;
  const secs = Math.floor(afterMinutesMs / 1000);
  const ms = afterMinutesMs % 1000;

  const secondsText = format.showMilliseconds
    ? `${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
    : String(secs).padStart(2, "0");

  if (format.showHours) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${secondsText}`;
  }
  if (format.showMinutes) {
    return `${String(minutes).padStart(2, "0")}:${secondsText}`;
  }
  return secondsText;
}
