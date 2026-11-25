import type { Chat, ChatSettings } from "../types";

export const NEW_CHAT_TITLE = "New chat";
export const DEFAULT_SHEET_RESOLUTION = "auto";
const TITLE_LENGTH = 40;

export function blankChat(
  modelId: string,
  id: string,
  now: number,
  lookingModelId: string = "",
  lookingBaseUrl: string = "",
): Chat {
  return {
    id,
    title: NEW_CHAT_TITLE,
    createdAt: now,
    updatedAt: now,
    settings: {
      systemPrompt: "",
      modelId,
      ...withLooking(lookingModelId, lookingBaseUrl),
      sheetResolution: DEFAULT_SHEET_RESOLUTION,
    },
    sceneLog: [],
  };
}

// The server goes with the model, so a later change of servers never moves the chat's pictures.
export function withLooking(
  lookingModelId: string,
  lookingBaseUrl: string,
): Pick<ChatSettings, "lookingModelId" | "lookingBaseUrl"> {
  if (lookingModelId === "") return {};
  return { lookingModelId, ...(lookingBaseUrl === "" ? {} : { lookingBaseUrl }) };
}

export function titleFromMessage(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= TITLE_LENGTH ? flat : `${flat.slice(0, TITLE_LENGTH).trimEnd()}…`;
}
