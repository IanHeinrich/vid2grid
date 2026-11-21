import type {
  AssistantMessage,
  ImageRef,
  ModelInfo,
  ToolMessage,
  UserMessage,
} from "../../src/types";

export function model(id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name: id,
    vision: true,
    tools: true,
    reasoning: false,
    reasoningEffortOptions: [],
    maxImages: 10,
    privacy: "private",
    traits: [],
    uncensored: false,
    recommended: false,
    beta: false,
    videoInput: false,
    audioInput: false,
    e2ee: false,
    ...overrides,
  };
}

export function user(id: string, text: string, extra: Partial<UserMessage> = {}): UserMessage {
  return { id, createdAt: 0, role: "user", text, images: [], ...extra };
}

export function assistant(
  id: string,
  text: string,
  extra: Partial<AssistantMessage> = {},
): AssistantMessage {
  return { id, createdAt: 1, role: "assistant", text, toolCalls: [], ...extra };
}

export function tool(id: string, callId: string, images: ImageRef[], text = "ok"): ToolMessage {
  return { id, createdAt: 2, role: "tool", toolCallId: callId, text, images };
}

export function sheet(id: string, start: number, end: number): ImageRef {
  return {
    id,
    pinned: false,
    source: {
      kind: "sheet",
      call: "look",
      name: "grid_0001",
      startSeconds: start,
      endSeconds: end,
      frameCount: 4,
    },
  };
}

export function upload(id: string): ImageRef {
  return { id, source: { kind: "upload", name: `${id}.png` }, pinned: false };
}
