import { describe, expect, it, vi } from "vitest";
import { VENICE_BASE_URL } from "../src/api/client";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  addPending,
  blankChat,
  clearPending,
  createAppState,
  currentModel,
  currentPending,
  defaultModelId,
  effectiveDefaultModelId,
  overviewText,
  pendingFor,
  pendingImages,
  removeChat,
  removeMessages,
  removePending,
  replaceChat,
  resolveModel,
  restoreMessages,
  sendBlocker,
  setChats,
  setCurrentChat,
  setLoadedVideo,
  setModels,
  setModelsError,
  setPendingPinned,
  setRunning,
  titleFromMessage,
  updateChat,
  upsertMessage,
  visionModels,
} from "../src/state";
import type { Chat, ImageRef, ModelInfo, UserMessage } from "../src/types";

function chat(id: string, updatedAt: number): Chat {
  return { ...blankChat(DEFAULT_SETTINGS.defaultModelId, id, updatedAt), title: `Chat ${id}` };
}

function model(id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name: id.toUpperCase(),
    vision: true,
    tools: true,
    reasoning: false,
    reasoningEffortOptions: [],
    maxImages: 10,
    traits: [],
    uncensored: false,
    recommended: false,
    beta: false,
    videoInput: false,
    audioInput: false,
    e2ee: false,
    privacy: "private",
    ...overrides,
  };
}

function image(id: string): ImageRef {
  return { id, source: { kind: "upload", name: `${id}.png` }, pinned: false };
}

function userMessage(id: string, text: string): UserMessage {
  return { id, createdAt: 1, role: "user", text, images: [] };
}

describe("createAppState", () => {
  it("starts empty with the given settings", () => {
    expect(createAppState(DEFAULT_SETTINGS)).toEqual({
      settings: DEFAULT_SETTINGS,
      models: [],
      modelsError: null,
      chats: [],
      currentChat: null,
      messages: [],
      pending: new Map(),
      overviews: new Map(),
      video: null,
      running: false,
    });
  });
});

describe("chat setters", () => {
  it("keeps the chat list newest first", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setChats(state, [chat("a", 1), chat("b", 3)]);
    replaceChat(state, chat("c", 2));
    expect(state.chats.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });

  it("replaces the current chat when it is updated", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setCurrentChat(state, chat("a", 1), []);
    replaceChat(state, { ...chat("a", 1), title: "Renamed" });
    expect(state.currentChat?.title).toBe("Renamed");
  });

  it("clears the open chat, its messages and pending images when it is removed", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setChats(state, [chat("a", 1)]);
    setCurrentChat(state, chat("a", 1), [userMessage("m", "hi")]);
    addPending(state, "a", { kind: "image", ref: image("i") });
    removeChat(state, "a");
    expect(state.chats).toEqual([]);
    expect(state.currentChat).toBeNull();
    expect(state.messages).toEqual([]);
    expect(pendingFor(state, "a")).toEqual([]);
  });

  it("drops the loaded video but keeps each chat's pending images when another chat opens", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setLoadedVideo(state, {
      chatId: "a",
      file: new File([], "a.mp4"),
      info: { durationSeconds: 1, width: 1, height: 1 },
    });
    setCurrentChat(state, chat("a", 1), []);
    addPending(state, "a", { kind: "image", ref: image("i") });
    setCurrentChat(state, chat("b", 1), []);
    expect(state.video).toBeNull();
    expect(currentPending(state)).toEqual([]);
    setCurrentChat(state, chat("a", 1), []);
    expect(currentPending(state)).toEqual([{ kind: "image", ref: image("i") }]);
  });
});

describe("upsertMessage", () => {
  it("appends new messages and replaces known ones in place", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    upsertMessage(state, userMessage("a", "one"));
    upsertMessage(state, userMessage("b", "two"));
    upsertMessage(state, userMessage("a", "edited"));
    expect(state.messages.map((message) => message.role === "user" && message.text)).toEqual([
      "edited",
      "two",
    ]);
  });
});

describe("removing and restoring messages", () => {
  it("removes by id and restores in createdAt order", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    const messages = [
      { ...userMessage("a", "one"), createdAt: 1 },
      { ...userMessage("b", "two"), createdAt: 2 },
      { ...userMessage("c", "three"), createdAt: 3 },
    ];
    messages.forEach((message) => upsertMessage(state, message));
    removeMessages(state, ["b"]);
    expect(state.messages.map((message) => message.id)).toEqual(["a", "c"]);
    restoreMessages(state, [messages[1] ?? userMessage("x", "")]);
    expect(state.messages.map((message) => message.id)).toEqual(["a", "b", "c"]);
  });
});

describe("pending attachments", () => {
  it("adds, pins, removes and clears", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    addPending(state, "c", { kind: "image", ref: image("a") });
    addPending(state, "c", { kind: "overview", refs: [image("s1"), image("s2")] });
    addPending(state, "other", { kind: "image", ref: image("x") });
    setPendingPinned(state, "c", 0, true);
    expect(pendingImages(pendingFor(state, "c")).map((ref) => [ref.id, ref.pinned])).toEqual([
      ["a", true],
      ["s1", false],
      ["s2", false],
    ]);
    removePending(state, "c", 0);
    expect(pendingFor(state, "c")).toHaveLength(1);
    clearPending(state, "c");
    expect(pendingFor(state, "c")).toEqual([]);
    expect(pendingFor(state, "other")).toHaveLength(1);
  });
});

describe("models", () => {
  it("lists only vision models, and only private ones when asked", () => {
    const models = [
      model("a"),
      model("b", { privacy: "anonymized" }),
      model("c", { vision: false }),
    ];
    expect(visionModels(models, true).map((entry) => entry.id)).toEqual(["a"]);
    expect(visionModels(models, false).map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("builds a fallback for a model that is not in the loaded list", () => {
    const state = createAppState({ ...DEFAULT_SETTINGS, fallbackMaxImages: 6 });
    setModels(state, [model("known")]);
    expect(resolveModel(state, "known").name).toBe("KNOWN");
    expect(resolveModel(state, "other")).toEqual({
      id: "other",
      name: "other",
      vision: true,
      tools: true,
      reasoning: false,
      reasoningEffortOptions: [],
      maxImages: 6,
      privacy: "unknown",
      traits: [],
      uncensored: false,
      recommended: false,
      beta: false,
      videoInput: false,
      audioInput: false,
      e2ee: false,
    });
  });

  it("records a load error until models load", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setModelsError(state, "401");
    expect(state.modelsError).toBe("401");
    setModels(state, []);
    expect(state.modelsError).toBeNull();
  });
});

describe("default model for new chats", () => {
  it("keeps the stored default while it is listed or nothing is loaded", () => {
    expect(effectiveDefaultModelId([], true, "stored")).toBe("stored");
    expect(effectiveDefaultModelId([model("a"), model("stored")], true, "stored")).toBe("stored");
  });

  it("uses the first visible vision model when the stored default is not listed", () => {
    const models = [model("anon", { privacy: "anonymized" }), model("priv")];
    expect(effectiveDefaultModelId(models, true, "gone")).toBe("priv");
    expect(effectiveDefaultModelId(models, false, "gone")).toBe("anon");
    const state = createAppState({ ...DEFAULT_SETTINGS, defaultModelId: "gone" });
    setModels(state, models);
    expect(defaultModelId(state)).toBe("priv");
  });
});

describe("sendBlocker", () => {
  it("asks for a Venice key, then a model, then allows sending", () => {
    const state = createAppState({ ...DEFAULT_SETTINGS, baseUrl: VENICE_BASE_URL });
    expect(sendBlocker(state)).toMatch(/new chat/);
    setCurrentChat(state, chat("a", 1), []);
    expect(sendBlocker(state)).toMatch(/API key in Settings/);
    const keyed = createAppState({ ...DEFAULT_SETTINGS, apiKey: "key" });
    const unset = chat("a", 1);
    setCurrentChat(keyed, { ...unset, settings: { ...unset.settings, modelId: "" } }, []);
    expect(currentModel(keyed)).toBeNull();
    expect(sendBlocker(keyed)).toMatch(/Choose a model/);
    setCurrentChat(keyed, chat("a", 1), []);
    expect(sendBlocker(keyed)).toBeNull();
  });

  it("needs no key for a server other than Venice", () => {
    const state = createAppState({ ...DEFAULT_SETTINGS, baseUrl: "http://localhost:1234/v1" });
    setCurrentChat(state, chat("a", 1), []);
    expect(sendBlocker(state)).toBeNull();
  });

  it("tracks whether a turn is running", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setRunning(state, true);
    expect(state.running).toBe(true);
  });
});

describe("blankChat", () => {
  it("uses the default model and the Auto sheet resolution", () => {
    expect(blankChat("m", "id", 5)).toEqual({
      id: "id",
      title: "New chat",
      createdAt: 5,
      updatedAt: 5,
      settings: { systemPrompt: "", modelId: "m", sheetResolution: "auto" },
      sceneLog: [],
    });
  });
});

describe("titleFromMessage", () => {
  it("keeps short messages and cuts long ones near 40 characters", () => {
    expect(titleFromMessage("  What happens\nnext?  ")).toBe("What happens next?");
    const title = titleFromMessage("a".repeat(30) + " " + "b".repeat(30));
    expect(title).toBe(`${"a".repeat(30)} ${"b".repeat(9)}…`);
  });
});

describe("overviewText", () => {
  it("is empty once the overview is ready and shows progress or failure otherwise", () => {
    expect(overviewText(undefined)).toBe("");
    expect(overviewText({ kind: "ready", fileKey: "k", sheets: 4 })).toBe("");
    expect(overviewText({ kind: "rendering", fileKey: "k", done: 1, total: 4 })).toBe(
      "Overview 25%",
    );
    expect(overviewText({ kind: "rendering", fileKey: "k", done: 0, total: 0 })).toBe(
      "Rendering overview",
    );
    expect(overviewText({ kind: "failed", fileKey: "k", error: "boom" })).toBe("Overview failed");
  });
});

describe("updateChat", () => {
  it("lets two overlapping writers both keep their change", async () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setChats(state, [chat("a", 1)]);
    const saved: Chat[] = [];
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const store = {
      putChat: async (entry: Chat) => {
        saved.push(entry);
        await gate;
      },
    };
    const first = updateChat(state, store, "a", (entry) => ({ ...entry, title: "Renamed" }));
    const second = updateChat(state, store, "a", (entry) => ({
      ...entry,
      sceneLog: [{ timeSeconds: 1, text: "note" }],
    }));
    release();
    await Promise.all([first, second]);
    const latest = state.chats.find((entry) => entry.id === "a");
    expect(latest?.title).toBe("Renamed");
    expect(latest?.sceneLog).toEqual([{ timeSeconds: 1, text: "note" }]);
    expect(saved.at(-1)).toEqual(latest);
  });

  it("does nothing for a chat that is gone", async () => {
    const state = createAppState(DEFAULT_SETTINGS);
    const putChat = vi.fn(() => Promise.resolve());
    expect(await updateChat(state, { putChat }, "gone", (entry) => entry)).toBeUndefined();
    expect(putChat).not.toHaveBeenCalled();
  });
});
