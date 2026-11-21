import type { Chat } from "../types";

export const NEW_CHAT_TITLE = "New chat";
export const DEFAULT_SHEET_RESOLUTION = "auto";
const TITLE_LENGTH = 40;

export function blankChat(modelId: string, id: string, now: number): Chat {
  return {
    id,
    title: NEW_CHAT_TITLE,
    createdAt: now,
    updatedAt: now,
    settings: {
      systemPrompt: "",
      modelId,
      sheetResolution: DEFAULT_SHEET_RESOLUTION,
    },
    sceneLog: [],
  };
}

export function titleFromMessage(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= TITLE_LENGTH ? flat : `${flat.slice(0, TITLE_LENGTH).trimEnd()}…`;
}
