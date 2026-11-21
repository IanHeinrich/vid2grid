import { describe, expect, it } from "vitest";
import { VENICE_BASE_URL } from "../src/api/venice";
import { sendBlocker } from "../src/app/sendBlocker";
import { blankChat } from "../src/chat/chats";
import { currentModel } from "../src/chat/models";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setCurrentChat } from "../src/state";
import type { Chat } from "../src/types";

function chat(id: string, updatedAt: number): Chat {
  return { ...blankChat("chat-model", id, updatedAt), title: `Chat ${id}` };
}

describe("sendBlocker", () => {
  it("asks for an API before anything else is checked", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setCurrentChat(state, chat("a", 1), []);
    expect(sendBlocker(state)).toBe("Choose an API in Settings to start chatting.");
  });

  it("asks for a Venice key, then a model, then allows sending", () => {
    const venice = { ...DEFAULT_SETTINGS, baseUrl: VENICE_BASE_URL };
    const state = createAppState(venice);
    expect(sendBlocker(state)).toMatch(/new chat/);
    setCurrentChat(state, chat("a", 1), []);
    expect(sendBlocker(state)).toBe("Add your API key in Settings to start chatting.");
    const keyed = createAppState({ ...venice, apiKey: "key" });
    const unset = chat("a", 1);
    setCurrentChat(keyed, { ...unset, settings: { ...unset.settings, modelId: "" } }, []);
    expect(currentModel(keyed)).toBeNull();
    expect(sendBlocker(keyed)).toMatch(/Choose a model/);
    setCurrentChat(keyed, chat("a", 1), []);
    expect(sendBlocker(keyed)).toBeNull();
  });

  it("needs no key for a server other than Venice, only a model", () => {
    const state = createAppState({ ...DEFAULT_SETTINGS, baseUrl: "http://localhost:1234/v1" });
    setCurrentChat(state, blankChat("", "a", 1), []);
    expect(sendBlocker(state)).toMatch(/Choose a model/);
    setCurrentChat(state, chat("a", 1), []);
    expect(sendBlocker(state)).toBeNull();
  });
});
