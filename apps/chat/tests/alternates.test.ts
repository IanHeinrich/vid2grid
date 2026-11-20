import { describe, expect, it } from "vitest";
import type { TurnDeps, TurnOutcome } from "../src/chat/agentLoop";
import {
  archiveCurrentReply,
  canSwipe,
  compareWithModel,
  currentReplyIndex,
  replyCount,
  switchReply,
  type CompareDeps,
} from "../src/chat/alternates";
import type {
  AssistantMessage,
  Chat,
  ChatMessage,
  ModelInfo,
  ToolMessage,
  UserMessage,
} from "../src/types";

function user(id: string, createdAt: number, extra: Partial<UserMessage> = {}): UserMessage {
  return { id, createdAt, role: "user", text: `question ${id}`, images: [], ...extra };
}

function assistant(id: string, createdAt: number, callIds: string[] = []): AssistantMessage {
  const toolCalls = callIds.map((callId) => ({ id: callId, name: "look", arguments: "{}" }));
  return { id, createdAt, role: "assistant", text: `answer ${id}`, toolCalls };
}

function tool(id: string, createdAt: number, toolCallId: string): ToolMessage {
  return { id, createdAt, role: "tool", toolCallId, text: `result ${id}`, images: [] };
}

const earlier: ChatMessage[] = [user("u1", 10), assistant("a1", 11)];
const firstReply = [assistant("a2", 21, ["c1"]), tool("t2", 22, "c1"), assistant("a3", 23)];
const history: ChatMessage[] = [...earlier, user("u2", 20), ...firstReply];

// Applies an archive or switch the way a caller would: delete, then save the user and restores.
function apply(
  messages: readonly ChatMessage[],
  change: { user: UserMessage; removeIds: string[]; restore?: ChatMessage[] },
): ChatMessage[] {
  const removed = new Set(change.removeIds);
  const kept = messages
    .filter((message) => !removed.has(message.id))
    .map((message) => (message.id === change.user.id ? change.user : message));
  return [...kept, ...(change.restore ?? [])].sort((a, b) => a.createdAt - b.createdAt);
}

describe("replyCount and currentReplyIndex", () => {
  it("count one reply at index 0 for a plain message", () => {
    expect(replyCount(user("u", 0))).toBe(1);
    expect(currentReplyIndex(user("u", 0))).toBe(0);
  });

  it("place the shown reply at replyIndex, defaulting to last", () => {
    const alternates = [
      { messages: [], createdAt: 0 },
      { messages: [], createdAt: 0 },
    ];
    expect(replyCount(user("u", 0, { alternates }))).toBe(3);
    expect(currentReplyIndex(user("u", 0, { alternates }))).toBe(2);
    expect(currentReplyIndex(user("u", 0, { alternates, replyIndex: 1 }))).toBe(1);
    expect(currentReplyIndex(user("u", 0, { alternates, replyIndex: 9 }))).toBe(2);
  });
});

describe("archiveCurrentReply", () => {
  it("moves the shown reply into the alternates and names its messages for deletion", () => {
    const archived = archiveCurrentReply(history, "u2", "model-a");
    expect(archived?.removeIds).toEqual(["a2", "t2", "a3"]);
    expect(archived?.user.alternates).toEqual([
      { messages: firstReply, modelId: "model-a", createdAt: 21 },
    ]);
    expect(archived?.user.replyIndex).toBe(1);
    expect(archived && replyCount(archived.user)).toBe(2);
  });

  it("stops at the next user message", () => {
    expect(archiveCurrentReply(history, "u1", "model-a")?.removeIds).toEqual(["a1"]);
  });

  it("prefers the model recorded on the message, and clears it for the next reply", () => {
    const messages = [...earlier, user("u2", 20, { replyModelId: "model-b" }), ...firstReply];
    const archived = archiveCurrentReply(messages, "u2", "model-a");
    expect(archived?.user.alternates?.[0]?.modelId).toBe("model-b");
    expect(archived?.user).not.toHaveProperty("replyModelId");
  });

  it("keeps no empty alternate when there is no reply", () => {
    const archived = archiveCurrentReply([user("u", 0)], "u", "model-a");
    expect(archived).toEqual({
      user: { ...user("u", 0), alternates: [], replyIndex: 0 },
      removeIds: [],
    });
  });

  it("returns undefined for an unknown or non-user id", () => {
    expect(archiveCurrentReply(history, "missing", "m")).toBeUndefined();
    expect(archiveCurrentReply(history, "a2", "m")).toBeUndefined();
  });
});

function twoReplies(): ChatMessage[] {
  const archived = archiveCurrentReply(history, "u2", "model-a");
  if (!archived) throw new Error("archive failed");
  return [...apply(history, archived), assistant("b1", 30)];
}

describe("switchReply", () => {
  it("swaps the shown reply for an alternate, keeping display indices stable", () => {
    const messages = twoReplies();
    const switched = switchReply(messages, "u2", 0, "model-a");
    expect(switched?.removeIds).toEqual(["b1"]);
    expect(switched?.restore.map((message) => message.id)).toEqual(["a2", "t2", "a3"]);
    expect(switched?.restore.map((message) => message.createdAt)).toEqual([21, 22, 23]);
    expect(switched?.user.replyIndex).toBe(0);
    expect(switched?.user.replyModelId).toBe("model-a");
    expect(switched?.user.alternates).toEqual([
      { messages: [assistant("b1", 30)], modelId: "model-a", createdAt: 30 },
    ]);

    const restored = switched && apply(messages, switched);
    expect(restored?.map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2", "t2", "a3"]);
    const back = restored && switchReply(restored, "u2", 1);
    expect(back?.restore.map((message) => message.id)).toEqual(["b1"]);
    expect(back?.user.replyIndex).toBe(1);
  });

  it("places restored messages right after the user message", () => {
    const alternates = [{ messages: [assistant("old", 5)], createdAt: 5 }];
    const messages = [user("u", 100, { alternates, replyIndex: 1 }), assistant("new", 200)];
    const switched = switchReply(messages, "u", 0);
    expect(switched?.restore).toEqual([{ ...assistant("old", 5), createdAt: 101 }]);
    expect(switched?.user).not.toHaveProperty("replyModelId");
  });

  it("keeps the middle reply's place among three", () => {
    const alternates = [
      { messages: [assistant("r0", 1)], createdAt: 1 },
      { messages: [assistant("r2", 3)], createdAt: 3 },
    ];
    const messages = [user("u", 0, { alternates, replyIndex: 1 }), assistant("r1", 2)];
    const switched = switchReply(messages, "u", 2);
    expect(switched?.user.alternates?.map((reply) => reply.messages[0]?.id)).toEqual(["r0", "r1"]);
    expect(switched?.user.replyIndex).toBe(2);
  });

  it("drops an empty shown reply left by a failed replay", () => {
    const alternates = [
      { messages: [assistant("r0", 1)], createdAt: 1 },
      { messages: [assistant("r1", 2)], createdAt: 2 },
    ];
    const messages = [user("u", 0, { alternates, replyIndex: 2 })];
    const switched = switchReply(messages, "u", 0);
    expect(switched?.user.alternates?.map((reply) => reply.messages[0]?.id)).toEqual(["r1"]);
    expect(switched?.user.replyIndex).toBe(0);
    expect(switched?.removeIds).toEqual([]);
  });

  it("refuses the shown index, an out-of-range index and an earlier turn", () => {
    const messages = twoReplies();
    expect(switchReply(messages, "u2", 1)).toBeUndefined();
    expect(switchReply(messages, "u2", 2)).toBeUndefined();
    expect(switchReply(messages, "u2", -1)).toBeUndefined();
    const later = [...messages, user("u3", 40), assistant("c1", 41)];
    expect(switchReply(later, "u2", 0)).toBeUndefined();
  });
});

describe("canSwipe", () => {
  it("is true only on the latest turn with more than one reply", () => {
    const messages = twoReplies();
    expect(canSwipe(messages, "u2")).toBe(true);
    expect(canSwipe(history, "u2")).toBe(false);
    expect(canSwipe([...messages, user("u3", 40)], "u2")).toBe(false);
    expect(canSwipe(messages, "missing")).toBe(false);
  });
});

const chat: Chat = {
  id: "chat",
  title: "Chat",
  createdAt: 0,
  updatedAt: 0,
  settings: { systemPrompt: "", modelId: "model-a", sheetResolution: 1024 },
  sceneLog: [],
};

const otherModel: ModelInfo = {
  id: "model-b",
  name: "B",
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

function compareSetup() {
  const calls: TurnDeps[] = [];
  const saved: UserMessage[] = [];
  const removed: string[][] = [];
  const persisted: ChatMessage[] = [];
  const deps: CompareDeps = {
    runTurn: async (turnDeps) => {
      calls.push(turnDeps);
      await turnDeps.persist(assistant("b1", 30));
      return { status: "done" } satisfies TurnOutcome;
    },
    turn: {
      chat,
      api: { baseUrl: "https://api.example", apiKey: "key" },
      streamChat: () => {
        throw new Error("runTurn is faked");
      },
      runTool: undefined,
      store: { putImage: () => Promise.resolve("id"), getImage: () => Promise.resolve(undefined) },
      tools: [],
      toolGuidance: "",
      veniceParameters: false,
      signal: new AbortController().signal,
      persist: (message) => {
        persisted.push(message);
        return Promise.resolve();
      },
      onEvent: () => undefined,
      resolution: 1024,
    },
    saveUser: (message) => {
      saved.push(message);
      return Promise.resolve();
    },
    removeMessages: (ids) => {
      removed.push([...ids]);
      return Promise.resolve();
    },
  };
  return { deps, calls, saved, removed, persisted };
}

describe("compareWithModel", () => {
  it("archives the shown reply and runs the turn again with the other model", async () => {
    const { deps, calls, saved, removed, persisted } = compareSetup();
    const result = await compareWithModel(deps, {
      messages: history,
      userMessageId: "u2",
      currentModelId: "model-a",
      model: otherModel,
    });

    expect(result?.outcome).toEqual({ status: "done" });
    expect(removed).toEqual([["a2", "t2", "a3"]]);
    expect(saved).toEqual([result?.user]);
    expect(result?.user.replyModelId).toBe("model-b");
    expect(result?.user.alternates).toEqual([
      { messages: firstReply, modelId: "model-a", createdAt: 21 },
    ]);
    expect(calls[0]?.model).toBe(otherModel);
    expect(calls[0]?.chat.settings.modelId).toBe("model-b");
    expect(calls[0]?.messages.map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
    expect(calls[0]?.messages.at(-1)).toEqual(result?.user);
    expect(persisted.map((message) => message.id)).toEqual(["b1"]);

    const after = result && [
      ...apply(history, { user: result.user, removeIds: ["a2", "t2", "a3"] }),
      assistant("b1", 30),
    ];
    const back = after && switchReply(after, "u2", 0);
    expect(back?.restore.map((message) => message.id)).toEqual(["a2", "t2", "a3"]);
    expect(back?.user.alternates?.[0]).toMatchObject({ modelId: "model-b" });
  });

  it("keeps the shown reply when saving the archived user message fails", async () => {
    const { deps, calls, removed } = compareSetup();
    deps.saveUser = () => Promise.reject(new Error("disk full"));
    await expect(
      compareWithModel(deps, {
        messages: history,
        userMessageId: "u2",
        currentModelId: "model-a",
        model: otherModel,
      }),
    ).rejects.toThrow("disk full");
    expect(removed).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("does nothing on an earlier turn", async () => {
    const { deps, calls } = compareSetup();
    const result = await compareWithModel(deps, {
      messages: history,
      userMessageId: "u1",
      currentModelId: "model-a",
      model: otherModel,
    });
    expect(result).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
