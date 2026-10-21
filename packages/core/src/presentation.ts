import { SECONDS_PER_MINUTE, twoDigits } from "./plan/timestampFormat";

const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|]+/g;
const FILE_EXTENSION = /\.[^./\\]+$/;
const FALLBACK_SOURCE_NAME = "video";
const ISO_DATE_TIME_TO_SECONDS = "YYYY-MM-DDTHH:MM:SS".length;

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / SECONDS_PER_MINUTE);
  return `${minutes}:${twoDigits(total % SECONDS_PER_MINUTE)}`;
}

export function sanitizeForFileName(name: string): string {
  const cleaned = name.replace(UNSAFE_FILE_NAME_CHARACTERS, "_").trim();
  return cleaned || FALLBACK_SOURCE_NAME;
}

export function buildGridsFolderName(sourceFileName: string, now = new Date()): string {
  const base = sanitizeForFileName(sourceFileName.replace(FILE_EXTENSION, ""));
  const timestamp = now
    .toISOString()
    .slice(0, ISO_DATE_TIME_TO_SECONDS)
    .replace("T", "_")
    .replace(/:/g, "");
  return `${base}_grids_${timestamp}`;
}
