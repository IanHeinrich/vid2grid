import { describe, expect, it, vi } from "vitest";
import { persistMessage } from "../src/app/persistMessage";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setCurrentChat } from "../src/state";
import { user } from "./support/factories";

describe("persistMessage", () => {
  it("updates the shown message and saves it to the current chat", async () => {
    const state = createAppState(DEFAULT_SETTINGS);
    const store = createMemoryStore();
    const chat = blankChat("m", "chat", 1);
    await store.putChat(chat);
    setCurrentChat(state, chat, [user("u", "before")]);
    const onChanged = vi.fn();
    await persistMessage({ state, store, onChanged }, user("u", "after"));
    expect(state.messages.map((message) => message.text)).toEqual(["after"]);
    expect(onChanged).toHaveBeenCalled();
    expect((await store.listMessages("chat")).map((message) => message.text)).toEqual(["after"]);
  });

  it("reports a chat deleted in another tab, for the caller to show", async () => {
    const state = createAppState(DEFAULT_SETTINGS);
    const store = createMemoryStore();
    setCurrentChat(state, blankChat("m", "chat", 1), [user("u", "before")]);
    await expect(
      persistMessage({ state, store, onChanged: vi.fn() }, user("u", "after")),
    ).rejects.toThrow("This chat has been deleted.");
    expect(await store.listMessages("chat")).toEqual([]);
  });

  it("does nothing without a chat open", async () => {
    const state = createAppState(DEFAULT_SETTINGS);
    const onChanged = vi.fn();
    await persistMessage({ state, store: createMemoryStore(), onChanged }, user("u", "x"));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
