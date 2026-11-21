import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  blankChat,
  createAppState,
  replaceChat,
  setCurrentChat,
  type AppState,
} from "../src/state";
import type { Chat, ChatMessage, ChatStore, StorySoFar, StreamChat } from "../src/types";
import { initMemoryPanel } from "../src/ui/memoryPanel";
import { mountPage, stillToast } from "./support/page";
import { replyWith } from "./support/streams";

let els: AppElements;
let state: AppState;
let store: ChatStore;

const STORY: StorySoFar = { text: "They met on the beach.", throughMessageId: "u1", updatedAt: 5 };

function conversation(turns: number): ChatMessage[] {
  return Array.from({ length: turns }, (_, index): ChatMessage[] => [
    { id: `u${index}`, createdAt: index, role: "user", text: `question ${index}`, images: [] },
    {
      id: `a${index}`,
      createdAt: index,
      role: "assistant",
      text: `answer ${index}`,
      toolCalls: [],
    },
  ]).flat();
}

async function openChat(extra: Partial<Chat> = {}, messages: ChatMessage[] = []): Promise<void> {
  const chat: Chat = { ...blankChat("model", "chat", 1), ...extra };
  await store.putChat(chat);
  replaceChat(state, chat);
  setCurrentChat(state, chat, messages);
}

function panel(streamChat: StreamChat = replyWith("")) {
  return initMemoryPanel(els, state, {
    store,
    toast: stillToast(els),
    streamChat,
    onChanged: vi.fn(),
    now: () => 77,
  });
}

async function savedStory(): Promise<StorySoFar | undefined> {
  return (await store.getChat("chat"))?.storySoFar;
}

beforeEach(() => {
  els = mountPage();
  state = createAppState(DEFAULT_SETTINGS);
  store = createMemoryStore();
});

describe("memory panel", () => {
  it("shows the chat summary and saves an edit", async () => {
    await openChat({ storySoFar: STORY });
    panel();
    const { storyInput } = els.memory;
    expect(storyInput.value).toBe(STORY.text);
    expect(storyInput.readOnly).toBe(false);
    storyInput.value = "They met on the beach at dawn.";
    storyInput.dispatchEvent(new Event("change"));
    await vi.waitFor(async () =>
      expect(await savedStory()).toEqual({
        ...STORY,
        text: "They met on the beach at dawn.",
        updatedAt: 77,
      }),
    );
  });

  it("is read-only with nothing to clear before a summary exists", async () => {
    await openChat();
    panel();
    expect(els.memory.storyInput.readOnly).toBe(true);
    expect(els.memory.clearButton.disabled).toBe(true);
  });

  it("clears the chat summary and restores it with Undo", async () => {
    await openChat({ storySoFar: STORY });
    panel();
    els.memory.clearButton.click();
    await vi.waitFor(async () => expect(await savedStory()).toBeUndefined());
    expect(els.memory.storyInput.value).toBe("");
    expect(els.toast.text.textContent).toBe("Chat summary cleared");
    els.toast.action.click();
    await vi.waitFor(async () => expect(await savedStory()).toEqual(STORY));
  });

  it("writes the new chat's summary over a focused field when the chat switches", async () => {
    await openChat({ storySoFar: STORY });
    const memory = panel();
    const { storyInput } = els.memory;
    storyInput.focus();
    storyInput.value = "Typed for the first chat";
    const other: Chat = {
      ...blankChat("model", "other", 2),
      storySoFar: { ...STORY, text: "A storm rolls in." },
    };
    await store.putChat(other);
    replaceChat(state, other);
    setCurrentChat(state, other, []);
    memory.render();
    expect(storyInput.value).toBe("A storm rolls in.");
    storyInput.dispatchEvent(new Event("change"));
    await vi.waitFor(async () =>
      expect((await store.getChat("other"))?.storySoFar?.text).toBe("A storm rolls in."),
    );
  });
});

describe("memory panel summary", () => {
  it("summarizes the older messages on request", async () => {
    await openChat({}, conversation(6));
    panel(replyWith("A long day at the beach."));
    els.memory.summarizeButton.click();
    expect(els.memory.status.textContent).toBe("Summarizing the older messages…");
    expect(els.memory.stopButton.hidden).toBe(false);
    expect(els.memory.summarizeButton.disabled).toBe(true);
    await vi.waitFor(async () =>
      expect(await savedStory()).toMatchObject({
        text: "A long day at the beach.",
        throughMessageId: "a1",
        updatedAt: 77,
      }),
    );
    expect(els.memory.storyInput.value).toBe("A long day at the beach.");
    expect(els.memory.stopButton.hidden).toBe(true);
    expect(els.memory.storyMeta.textContent).toContain("Covers the first 4 messages.");
  });

  it("says so when there is nothing old enough to fold in", async () => {
    await openChat({}, conversation(2));
    panel(replyWith("Unused."));
    els.memory.summarizeButton.click();
    await vi.waitFor(() => expect(els.memory.status.textContent).toContain("Nothing to fold in"));
    expect(await savedStory()).toBeUndefined();
  });

  it("stops a running summary", async () => {
    await openChat({}, conversation(6));
    const hanging: StreamChat = async function* (_settings, _request, signal) {
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      yield { type: "text", delta: "late" };
    };
    panel(hanging);
    els.memory.summarizeButton.click();
    els.memory.stopButton.click();
    await vi.waitFor(() => expect(els.memory.status.textContent).toBe("Stopped."));
    expect(await savedStory()).toBeUndefined();
    expect(els.memory.summarizeButton.disabled).toBe(false);
  });
});
