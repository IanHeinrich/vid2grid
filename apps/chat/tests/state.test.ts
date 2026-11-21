import { describe, expect, it, vi } from "vitest";
import { blankChat } from "../src/chat/chats";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  addPending,
  clearPending,
  createAppState,
  currentPending,
  isRunningIn,
  overviewFor,
  pendingFor,
  pendingImages,
  removeChat,
  removeMessages,
  removePending,
  removePendingVideo,
  replaceChat,
  restoreMessages,
  setChats,
  setCurrentChat,
  setLoadedVideo,
  setModels,
  setModelsError,
  setOverviewStatus,
  setPendingPinned,
  setPendingVideo,
  setRunning,
  shownVideo,
  updateChat,
  upsertMessage,
} from "../src/state";
import type { Chat, UserMessage, VideoAttachment } from "../src/types";
import { upload } from "./support/factories";

function chat(id: string, updatedAt: number): Chat {
  return { ...blankChat("chat-model", id, updatedAt), title: `Chat ${id}` };
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
      runningChats: new Set(),
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
    addPending(state, "a", { kind: "image", ref: upload("i") });
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
    addPending(state, "a", { kind: "image", ref: upload("i") });
    setCurrentChat(state, chat("b", 1), []);
    expect(state.video).toBeNull();
    expect(currentPending(state)).toEqual([]);
    setCurrentChat(state, chat("a", 1), []);
    expect(currentPending(state)).toEqual([{ kind: "image", ref: upload("i") }]);
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
    addPending(state, "c", { kind: "image", ref: upload("a") });
    addPending(state, "c", { kind: "overview", refs: [upload("s1"), upload("s2")] });
    addPending(state, "other", { kind: "image", ref: upload("x") });
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

describe("the pending video", () => {
  const own: VideoAttachment = {
    name: "own.mp4",
    fileKey: "own",
    durationSeconds: 1,
    width: 1,
    height: 1,
  };
  const dropped: VideoAttachment = { ...own, name: "dropped.mp4", fileKey: "dropped" };

  it("shows in place of the chat's own video until removed, taking its overview with it", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setChats(state, [{ ...chat("c", 1), video: own }]);
    expect(shownVideo(state, "c")).toBe(own);
    setPendingVideo(state, "c", dropped);
    addPending(state, "c", { kind: "overview", refs: [upload("s1")] });
    addPending(state, "c", { kind: "image", ref: upload("a") });
    expect(shownVideo(state, "c")).toBe(dropped);
    removePendingVideo(state, "c");
    expect(pendingFor(state, "c")).toEqual([{ kind: "image", ref: upload("a") }]);
    expect(shownVideo(state, "c")).toBe(own);
  });

  it("matches the overview to the video shown", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setChats(state, [{ ...chat("c", 1), video: own }]);
    setPendingVideo(state, "c", dropped);
    setOverviewStatus(state, "c", { kind: "rendering", fileKey: "dropped", done: 0, total: 0 });
    expect(overviewFor(state, "c")?.kind).toBe("rendering");
    removePendingVideo(state, "c");
    expect(overviewFor(state, "c")).toBeUndefined();
  });
});

describe("models", () => {
  it("records a load error until models load", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setModelsError(state, "401");
    expect(state.modelsError).toBe("401");
    setModels(state, []);
    expect(state.modelsError).toBeNull();
  });
});

describe("running turns", () => {
  it("tracks a running turn per chat, with running meaning the current chat's", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setCurrentChat(state, chat("a", 1), []);
    setRunning(state, true);
    expect(state.running).toBe(true);
    setCurrentChat(state, chat("b", 2), []);
    expect(state.running).toBe(false);
    expect(isRunningIn(state, "a")).toBe(true);
    setRunning(state, true, "b");
    setRunning(state, false, "a");
    expect(state.running).toBe(true);
    expect(isRunningIn(state, "a")).toBe(false);
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
