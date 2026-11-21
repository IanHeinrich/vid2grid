import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatOpener, type ChatOpenerDeps } from "../src/app/openChat";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setChats, setCurrentChat, setModels, type AppState } from "../src/state";
import type { Chat, ChatMessage, ChatStore } from "../src/types";
import { model, user } from "./support/factories";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function chat(id: string, updatedAt = 1, modelId = "vision"): Chat {
  return { ...blankChat(modelId, id, updatedAt), title: `Chat ${id}` };
}

let state: AppState;
let store: ChatStore;
let calls: string[];
let deps: ChatOpenerDeps;

function makeDeps(): ChatOpenerDeps {
  return {
    state,
    store,
    status: { show: vi.fn(), clear: () => calls.push("status.clear") },
    turns: { stop: () => calls.push("turns.stop") },
    actions: { invalidateUndo: () => calls.push("actions.invalidateUndo") },
    conversation: {
      reset: (messages: readonly ChatMessage[]) =>
        calls.push(`conversation.reset:${messages.map((entry) => entry.id).join(",")}`),
      setRunning: (running: boolean) => calls.push(`conversation.setRunning:${String(running)}`),
    },
    video: { restore: () => Promise.resolve(void calls.push("video.restore")) },
    composer: { render: () => calls.push("composer.render") },
    sidebar: { createChat: vi.fn() },
    refresh: () => calls.push("refresh"),
  };
}

// Holds each chat's listMessages until released, so two opens can settle in either order.
function holdMessages(): Map<string, Deferred> {
  const held = new Map<string, Deferred>();
  const list = store.listMessages.bind(store);
  store.listMessages = async (chatId) => {
    const gate = deferred();
    held.set(chatId, gate);
    await gate.promise;
    return list(chatId);
  };
  return held;
}

beforeEach(async () => {
  state = createAppState(DEFAULT_SETTINGS);
  store = createMemoryStore();
  calls = [];
  for (const entry of [chat("a", 1), chat("b", 2)]) await store.putChat(entry);
  await store.putMessage("a", user("a1", "hello"));
  await store.putMessage("b", user("b1", "hi"));
  setChats(state, await store.listChats());
  deps = makeDeps();
});

describe("createChatOpener", () => {
  it("stops the turn and drops the undo before switching, then restores the video", async () => {
    await createChatOpener(deps).open("a");
    expect(calls).toEqual([
      "turns.stop",
      "actions.invalidateUndo",
      "conversation.reset:a1",
      "conversation.setRunning:false",
      "status.clear",
      "refresh",
      "video.restore",
      "composer.render",
    ]);
    expect(state.currentChat?.id).toBe("a");
    expect(state.messages.map((message) => message.id)).toEqual(["a1"]);
  });

  it("reads a chat missing from the list from the store", async () => {
    await store.putChat(chat("c", 3));
    await createChatOpener(deps).open("c");
    expect(state.currentChat?.id).toBe("c");
  });

  it("does nothing for a chat that no longer exists", async () => {
    await createChatOpener(deps).open("gone");
    expect(state.currentChat).toBeNull();
    expect(calls).toEqual(["turns.stop", "actions.invalidateUndo"]);
  });

  it("leaves the chat as it is when it is already open", async () => {
    setCurrentChat(state, chat("a"), []);
    await createChatOpener(deps).open("a");
    expect(calls).toEqual([]);
  });

  it("lands on the last chat clicked when an earlier open settles later", async () => {
    const held = holdMessages();
    const opener = createChatOpener(deps);
    const first = opener.open("a");
    await vi.waitFor(() => expect(held.has("a")).toBe(true));
    const second = opener.open("b");
    await vi.waitFor(() => expect(held.has("b")).toBe(true));
    held.get("b")?.resolve();
    await second;
    held.get("a")?.resolve();
    await first;
    expect(state.currentChat?.id).toBe("b");
    expect(state.messages.map((message) => message.id)).toEqual(["b1"]);
    expect(calls.filter((call) => call.startsWith("conversation.reset"))).toEqual([
      "conversation.reset:b1",
    ]);
  });

  it("cancels an open still loading when the chat already shown is clicked again", async () => {
    setCurrentChat(state, chat("a"), []);
    const held = holdMessages();
    const opener = createChatOpener(deps);
    const opening = opener.open("b");
    await vi.waitFor(() => expect(held.has("b")).toBe(true));
    await opener.open("a");
    held.get("b")?.resolve();
    await opening;
    expect(state.currentChat?.id).toBe("a");
  });

  it("keeps the earlier open as latest when the chat still opening is clicked again", async () => {
    const restoring = deferred();
    deps.video = {
      restore: () => {
        calls.push("video.restore");
        return restoring.promise;
      },
    };
    const opener = createChatOpener(deps);
    const opening = opener.open("a");
    await vi.waitFor(() => expect(calls).toContain("video.restore"));
    await opener.open("a");
    restoring.resolve();
    await opening;
    expect(calls.at(-1)).toBe("composer.render");
  });

  it("gives a chat made before the models loaded the default model", async () => {
    await store.putChat(chat("c", 3, ""));
    setChats(state, await store.listChats());
    setModels(state, [model("vision")]);
    await createChatOpener(deps).open("c");
    await vi.waitFor(() => expect(state.currentChat?.settings.modelId).toBe("vision"));
    expect((await store.getChat("c"))?.settings.modelId).toBe("vision");
  });

  it("opens the newest chat, or a new one when there are none", async () => {
    await createChatOpener(deps).openFallback();
    expect(state.currentChat?.id).toBe("b");
    const created = chat("new", 5);
    state = createAppState(DEFAULT_SETTINGS);
    await store.putChat(created);
    deps = { ...makeDeps(), sidebar: { createChat: () => Promise.resolve(created) } };
    await createChatOpener(deps).openFallback();
    expect(state.currentChat?.id).toBe("new");
  });
});
