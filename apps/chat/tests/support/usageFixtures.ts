import type { AssistantMessage, ChatMessage } from "../../src/types";

export function reply(
  id: string,
  promptTokens: number,
  completionTokens: number,
): AssistantMessage {
  return {
    id,
    createdAt: 1,
    role: "assistant",
    text: "ok",
    toolCalls: [],
    usage: { promptTokens, completionTokens, cachedTokens: 1000 },
  };
}

export const MESSAGES: ChatMessage[] = [
  { id: "u", createdAt: 0, role: "user", text: "hi", images: [] },
  reply("a1", 300_000, 10_000),
  reply("a2", 112_000, 8_000),
];
