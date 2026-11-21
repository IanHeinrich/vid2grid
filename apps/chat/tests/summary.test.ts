import { describe, expect, it } from "vitest";
import {
  STORY_SYSTEM_PROMPT,
  condenseSceneLog,
  parseSceneNotes,
  shouldSummarize,
  summarizeStory,
  type SummaryDeps,
} from "../src/chat/summary";
import type { Chat, ChatMessage, ChatRequest, ImageRef } from "../src/types";
import { scriptedReplies } from "./support/streams";

function setup(
  replies: (string | Error)[] = ["The story."],
  signal = new AbortController().signal,
) {
  const requests: ChatRequest[] = [];
  const deps: SummaryDeps = {
    api: { baseUrl: "https://api.example", apiKey: "key" },
    streamChat: scriptedReplies(replies, requests),
    modelId: "model",
    veniceParameters: true,
    signal,
    now: () => 99,
  };
  return { deps, requests };
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: "chat",
    title: "Chat",
    createdAt: 1,
    updatedAt: 1,
    settings: { systemPrompt: "", modelId: "model", sheetResolution: "auto" },
    sceneLog: [],
    ...overrides,
  };
}

const sheet: ImageRef = {
  id: "sheet-1",
  pinned: false,
  source: {
    kind: "sheet",
    call: "overview",
    name: "grid_0001",
    startSeconds: 0,
    endSeconds: 30,
    frameCount: 16,
  },
};

function user(id: string, text = `question ${id}`): ChatMessage {
  return { id, createdAt: 0, role: "user", text, images: [] };
}

function assistant(id: string, text = `answer ${id}`): ChatMessage {
  return {
    id,
    createdAt: 0,
    role: "assistant",
    text,
    toolCalls: [{ id: `${id}-call`, name: "look", arguments: '{"start":0,"end":30}' }],
  };
}

function tool(id: string, text: string): ChatMessage {
  return { id, createdAt: 0, role: "tool", toolCallId: "call", text, images: [sheet] };
}

function conversation(turns: number): ChatMessage[] {
  return Array.from({ length: turns }, (_, index) => [
    user(`u${index + 1}`),
    assistant(`a${index + 1}`),
  ]).flat();
}

function userContent(request: ChatRequest | undefined): string {
  const message = request?.messages[1];
  return message?.role === "user" && typeof message.content === "string" ? message.content : "";
}

describe("shouldSummarize", () => {
  it("is true above 60% of the context", () => {
    expect(shouldSummarize(6_001, 10_000)).toBe(true);
    expect(shouldSummarize(6_000, 10_000)).toBe(false);
  });

  it("falls back to a 32k context when the model's is unknown", () => {
    expect(shouldSummarize(20_000)).toBe(true);
    expect(shouldSummarize(19_000)).toBe(false);
  });
});

describe("summarizeStory", () => {
  it("folds everything before the last four user turns", async () => {
    const { deps, requests } = setup();
    const story = await summarizeStory(deps, { chat: chat(), messages: conversation(6) });
    expect(story).toEqual({
      text: "The story.",
      throughMessageId: "a2",
      throughCreatedAt: 0,
      updatedAt: 99,
    });
    const content = userContent(requests[0]);
    expect(content).toContain("User: question u1");
    expect(content).toContain("Assistant: answer a2");
    expect(content).not.toContain("u3");
  });

  it("sends a text-only request with no tools and the Venice parameter", async () => {
    const { deps, requests } = setup();
    const messages = [
      user("u0"),
      assistant("a0"),
      tool("t0", "Rendered 16 frames."),
      ...conversation(4),
    ];
    await summarizeStory(deps, { chat: chat(), messages });
    const request = requests[0];
    expect(request?.tools).toBeUndefined();
    expect(request?.stream).toBe(true);
    expect(request?.venice_parameters).toEqual({ include_venice_system_prompt: false });
    expect(request?.messages[0]).toEqual({ role: "system", content: STORY_SYSTEM_PROMPT });
    const content = userContent(request);
    expect(content).toContain("Tool result: Rendered 16 frames.");
    expect(content).not.toContain('"start"');
  });

  it("leaves out the Venice parameter for other servers", async () => {
    const { deps, requests } = setup();
    await summarizeStory(
      { ...deps, veniceParameters: false },
      { chat: chat(), messages: conversation(5) },
    );
    expect(requests[0]?.venice_parameters).toBeUndefined();
  });

  it("names speakers by the chat's character and user names", async () => {
    const { deps, requests } = setup();
    const named = chat({
      settings: {
        systemPrompt: "",
        modelId: "model",
        sheetResolution: "auto",
        characterName: "Mara",
        userName: "Sam",
      },
    });
    await summarizeStory(deps, { chat: named, messages: conversation(5) });
    expect(userContent(requests[0])).toContain("Sam: question u1\n\nMara: answer a1");
  });
});

describe("summarizeStory boundaries", () => {
  it("folds the old summary and only the messages after it", async () => {
    const { deps, requests } = setup();
    const previous = chat({
      storySoFar: { text: "Earlier story.", throughMessageId: "a1", updatedAt: 5 },
    });
    const story = await summarizeStory(deps, { chat: previous, messages: conversation(7) });
    expect(story?.throughMessageId).toBe("a3");
    const content = userContent(requests[0]);
    expect(content).toMatch(/^Summary so far:\nEarlier story\.\n\nNew messages:\n/);
    expect(content).not.toContain("u1");
    expect(content).toContain("question u2");
  });
});

describe("summarizeStory after a deletion", () => {
  it("folds only what follows a summary whose last message was deleted", async () => {
    const { deps, requests } = setup();
    const timed = conversation(7).map((message, index) => ({ ...message, createdAt: index + 1 }));
    const previous = chat({
      storySoFar: { text: "Earlier.", throughMessageId: "a1", throughCreatedAt: 2, updatedAt: 5 },
    });
    const messages = timed.filter((message) => message.id !== "a1");
    const story = await summarizeStory(deps, { chat: previous, messages });
    expect(story).toMatchObject({ throughMessageId: "a3", throughCreatedAt: 6 });
    const content = userContent(requests[0]);
    expect(content).not.toContain("u1");
    expect(content).toContain("question u2");
  });
});

describe("summarizeStory turns", () => {
  it("counts continuations as part of their turn", async () => {
    const { deps } = setup();
    const keepGoing: ChatMessage = {
      id: "c1",
      createdAt: 0,
      role: "user",
      text: "Keep going",
      images: [],
      continuation: true,
    };
    const messages = [...conversation(1), keepGoing, assistant("a1b"), ...conversation(4)];
    const story = await summarizeStory(deps, { chat: chat(), messages });
    expect(story?.throughMessageId).toBe("a1b");
  });

  it("honours a custom number of kept turns", async () => {
    const { deps } = setup();
    const story = await summarizeStory(deps, {
      chat: chat(),
      messages: conversation(3),
      keepTurns: 1,
    });
    expect(story?.throughMessageId).toBe("a2");
  });

  it("returns undefined without a request when there is nothing to fold", async () => {
    const { deps, requests } = setup();
    expect(await summarizeStory(deps, { chat: chat(), messages: conversation(4) })).toBeUndefined();
    const folded = chat({ storySoFar: { text: "Story.", throughMessageId: "a1", updatedAt: 1 } });
    expect(await summarizeStory(deps, { chat: folded, messages: conversation(5) })).toBeUndefined();
    expect(requests).toHaveLength(0);
  });

  it("rejects with an AbortError when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, requests } = setup(["The story."], controller.signal);
    await expect(
      summarizeStory(deps, { chat: chat(), messages: conversation(5) }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(requests).toHaveLength(0);
  });

  it("surfaces API errors", async () => {
    const { deps } = setup([new Error("401 Unauthorized")]);
    await expect(summarizeStory(deps, { chat: chat(), messages: conversation(5) })).rejects.toThrow(
      "401 Unauthorized",
    );
  });

  it("rejects an empty reply", async () => {
    const { deps } = setup(["  "]);
    await expect(summarizeStory(deps, { chat: chat(), messages: conversation(5) })).rejects.toThrow(
      "empty summary",
    );
  });
});

describe("condenseSceneLog", () => {
  const notes = [
    { timeSeconds: 70, text: "she leaves" },
    { timeSeconds: 12, text: "door opens" },
    { timeSeconds: 13, text: "the door opens" },
  ];

  it("parses the merged notes from the reply", async () => {
    const { deps, requests } = setup(["[0:12] The door opens.\n- [1:10]: She leaves.\nDone."]);
    const condensed = await condenseSceneLog(deps, notes, 120);
    expect(condensed).toEqual([
      { timeSeconds: 12, text: "The door opens." },
      { timeSeconds: 70, text: "She leaves." },
    ]);
    const content = userContent(requests[0]);
    expect(content).toContain("2:00 long");
    expect(content).toContain("[0:12] door opens\n[0:13] the door opens\n[1:10] she leaves");
    expect(requests[0]?.tools).toBeUndefined();
  });

  it("keeps the original notes when the reply has none", async () => {
    const { deps } = setup(["I cannot help with that."]);
    const condensed = await condenseSceneLog(deps, notes, 120);
    expect(condensed.map((note) => note.timeSeconds)).toEqual([12, 13, 70]);
  });

  it("makes no request for fewer than two notes", async () => {
    const { deps, requests } = setup();
    expect(await condenseSceneLog(deps, [{ timeSeconds: 1, text: "one" }], 10)).toEqual([
      { timeSeconds: 1, text: "one" },
    ]);
    expect(requests).toHaveLength(0);
  });
});

describe("parseSceneNotes", () => {
  it("reads hours, sorts, and clamps to the video", () => {
    expect(parseSceneNotes("[1:00:05] late\n[0:03] early\n[9:59] past the end", 3700)).toEqual([
      { timeSeconds: 3, text: "early" },
      { timeSeconds: 599, text: "past the end" },
      { timeSeconds: 3605, text: "late" },
    ]);
    expect(parseSceneNotes("[0:50] beyond", 30)).toEqual([{ timeSeconds: 30, text: "beyond" }]);
  });
});
