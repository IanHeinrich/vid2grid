import type { BuildRequestInput } from "../../src/chat/request";
import type {
  AssistantMessage,
  Chat,
  ImageRef,
  ModelInfo,
  ToolMessage,
  ToolSchema,
  UserMessage,
} from "../../src/types";

export function sheet(id: string, pinned = false): ImageRef {
  return {
    id,
    pinned,
    source: {
      kind: "sheet",
      call: "look(60, 90)",
      name: `grid_${id}`,
      startSeconds: 60,
      endSeconds: 90,
      frameCount: 16,
    },
  };
}

export function overviewSheet(id: string): ImageRef {
  return {
    id,
    pinned: false,
    source: {
      kind: "sheet",
      call: "overview",
      name: id,
      startSeconds: 0,
      endSeconds: 125,
      frameCount: 20,
    },
  };
}

export function upload(id: string, pinned = false): ImageRef {
  return { id, pinned, source: { kind: "upload", name: `${id}.jpg` } };
}

export function user(id: string, text: string, images: ImageRef[] = []): UserMessage {
  return { id, createdAt: 0, role: "user", text, images };
}

export function assistant(id: string, text: string, callIds: string[] = []): AssistantMessage {
  const toolCalls = callIds.map((callId) => ({ id: callId, name: "look", arguments: "{}" }));
  return { id, createdAt: 0, role: "assistant", text, toolCalls };
}

export function tool(id: string, toolCallId: string, images: ImageRef[] = []): ToolMessage {
  return { id, createdAt: 0, role: "tool", toolCallId, text: `result ${toolCallId}`, images };
}

export const baseChat: Chat = {
  id: "chat",
  title: "Chat",
  createdAt: 0,
  updatedAt: 0,
  settings: { systemPrompt: "Be brief.", modelId: "venice-model", sheetResolution: 1024 },
  sceneLog: [],
};

export const videoChat: Chat = {
  ...baseChat,
  video: { name: "beach.mp4", fileKey: "k", durationSeconds: 125, width: 1920, height: 1080 },
  sceneLog: [
    { timeSeconds: 90, text: "wave hits" },
    { timeSeconds: 12, text: "dog runs" },
  ],
};

export const model: ModelInfo = {
  id: "venice-model",
  name: "Venice",
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
};

export const lookTool: ToolSchema = {
  type: "function",
  function: { name: "look", description: "Look at a span", parameters: {} },
};

export function input(overrides: Partial<BuildRequestInput>): BuildRequestInput {
  return {
    chat: baseChat,
    messages: [],
    model,
    kept: new Set(),
    dataUrls: new Map(),
    tools: [lookTool],
    toolGuidance: "Use look to see the video.",
    veniceParameters: false,
    allowTools: true,
    finalRound: false,
    ...overrides,
  };
}

export const NOT_YET = { text: "not analysed yet", canListen: true };

export const storyHistory = [
  user("u1", "first", [upload("a")]),
  assistant("a1", "", ["c1"]),
  tool("t1", "c1", [sheet("s1")]),
  assistant("a2", "Seen."),
  user("u2", "next", [upload("b")]),
];
