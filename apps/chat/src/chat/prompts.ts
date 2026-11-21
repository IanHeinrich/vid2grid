import { formatTimestamp } from "../time";
import type { SceneNote } from "../types";

export function sceneLogLines(notes: readonly SceneNote[]): string[] {
  return [...notes]
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((note) => `[${formatTimestamp(note.timeSeconds)}] ${note.text}`);
}
