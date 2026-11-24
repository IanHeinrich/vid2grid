import { describe, expect, it } from "vitest";
import { VENICE_BASE_URL } from "../src/api/venice";
import { CANNOT_SEE, cannotSee, sendBlocker } from "../src/app/sendBlocker";
import { blankChat } from "../src/chat/chats";
import { currentModel } from "../src/chat/models";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  addPending,
  createAppState,
  setCurrentChat,
  setModels,
  setPendingVideo,
} from "../src/state";
import type { Chat } from "../src/types";
import { model, upload, user } from "./support/factories";

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

describe("sendBlocker with a looking model", () => {
  const local = { ...DEFAULT_SETTINGS, baseUrl: "http://localhost:1234/v1" };
  const looking = blankChat("chat-model", "a", 1, "eyes", VENICE_BASE_URL);

  it("asks for its server's key where that server needs one", () => {
    const state = createAppState({ ...local, lookingBaseUrl: VENICE_BASE_URL });
    setCurrentChat(state, looking, []);
    expect(sendBlocker(state)).toBe(
      "Add the looking model's API key in Settings to start chatting.",
    );
    const keyed = createAppState({ ...state.settings, apiKeys: { [VENICE_BASE_URL]: "k" } });
    setCurrentChat(keyed, looking, []);
    expect(sendBlocker(keyed)).toBeNull();
  });

  it("stops a chat whose looking server is no longer set up", () => {
    const state = createAppState(local);
    setCurrentChat(state, looking, []);
    expect(sendBlocker(state)).toContain("picked on api.venice.ai");
  });
});

describe("sendBlocker for a model that cannot see images", () => {
  const image = upload("i");

  function blind(lookingId = "") {
    const state = createAppState({ ...DEFAULT_SETTINGS, baseUrl: "http://localhost:1234/v1" });
    setModels(state, [model("chat-model", { vision: false })]);
    const own = lookingId === "" ? "" : "http://localhost:1234/v1";
    setCurrentChat(state, blankChat("chat-model", "a", 1, lookingId, own), []);
    return state;
  }

  it("lets a chat with no pictures send", () => {
    expect(sendBlocker(blind())).toBeNull();
    expect(cannotSee(blind())).toBe(true);
  });

  it("stops one with pictures, attached or sent, or with a video to come", () => {
    const attached = blind();
    addPending(attached, "a", { kind: "image", ref: image });
    expect(sendBlocker(attached)).toBe(CANNOT_SEE);
    const sent = blind();
    setCurrentChat(sent, sent.currentChat, [user("u", "hi", { images: [image] })]);
    expect(sendBlocker(sent)).toBe(CANNOT_SEE);
    const dropped = blind();
    const video = { name: "v", fileKey: "v", durationSeconds: 1, width: 1, height: 1 };
    setPendingVideo(dropped, "a", video);
    expect(sendBlocker(dropped)).toBe(CANNOT_SEE);
  });

  it("leaves one with a looking model, or a model nothing is known of, alone", () => {
    const looking = blind("eyes");
    addPending(looking, "a", { kind: "image", ref: image });
    expect(sendBlocker(looking)).toBeNull();
    const unknown = createAppState({ ...DEFAULT_SETTINGS, baseUrl: "http://localhost:1234/v1" });
    setCurrentChat(unknown, chat("a", 1), []);
    addPending(unknown, "a", { kind: "image", ref: image });
    expect(sendBlocker(unknown)).toBeNull();
  });
});
