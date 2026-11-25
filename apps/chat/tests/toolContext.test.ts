import type { VideoInfo } from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import { chatModel, conversationTools, toolContext } from "../src/app/toolContext";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setCurrentChat, setLoadedVideo, setModels } from "../src/state";
import type { Chat, VideoAttachment } from "../src/types";
import { assistant, model, tool, upload, user } from "./support/factories";

const VIDEO: VideoAttachment = {
  name: "beach.mp4",
  fileKey: "beach.mp4:1:1",
  durationSeconds: 60,
  width: 1280,
  height: 720,
};
const INFO = { durationSeconds: 60 } as VideoInfo;

function videoChat(modelId: string, sheetResolution: Chat["settings"]["sheetResolution"]): Chat {
  const chat = blankChat(modelId, "chat", 1);
  return { ...chat, video: VIDEO, settings: { ...chat.settings, sheetResolution } };
}

function loaded(chat: Chat) {
  const state = createAppState(DEFAULT_SETTINGS);
  setModels(state, [model("vision", { maxImages: 6 })]);
  setCurrentChat(state, chat, []);
  return state;
}

describe("toolContext", () => {
  it("describes the loaded video at the chat's resolution and the model's image cap", () => {
    const state = loaded(videoChat("vision", 768));
    const file = new File(["video"], "beach.mp4");
    setLoadedVideo(state, { chatId: "chat", file, info: INFO });
    const store = createMemoryStore();
    const ctx = toolContext(state, store);
    expect(ctx).toMatchObject({ file, info: INFO, video: VIDEO, resolution: 768, maxImages: 6 });
    expect(ctx?.store).toBe(store);
    expect(ctx?.overviewResolution?.(4)).toBe(768);
  });

  it("is undefined until the chat's own video file is loaded", () => {
    const state = loaded(videoChat("vision", 768));
    expect(toolContext(state, createMemoryStore())).toBeUndefined();
    setLoadedVideo(state, { chatId: "other", file: new File([], "x.mp4"), info: INFO });
    expect(toolContext(state, createMemoryStore())).toBeUndefined();
  });

  it("is undefined without a model to size the sheets for", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setCurrentChat(state, videoChat("", 768), []);
    setLoadedVideo(state, { chatId: "chat", file: new File([], "beach.mp4"), info: INFO });
    expect(toolContext(state, createMemoryStore())).toBeUndefined();
  });
});

describe("conversationTools", () => {
  const unloaded = { videoLoaded: false, listen: false };
  const names = (...args: Parameters<typeof conversationTools>) =>
    conversationTools(...args).tools.map((entry) => entry.function.name);

  it("finds an image on any message, whoever sent it", () => {
    const sees = model("vision");
    expect(names(sees, [user("u", "hi"), assistant("a", "yo")], unloaded)).toEqual([]);
    const sent = [user("u", "hi", { images: [upload("i")] })];
    expect(names(sees, sent, unloaded)).toEqual(["recall", "zoom"]);
    expect(names(sees, [tool("t", "c", [upload("i")])], unloaded)).toEqual(["recall", "zoom"]);
    expect(names(model("blind", { vision: false }), sent, unloaded)).toEqual([]);
  });

  it("offers the video tools with a loaded video, whatever the messages hold", () => {
    expect(names(model("vision"), [], { videoLoaded: true, listen: true })).toEqual([
      "look",
      "frames",
      "note",
      "recall",
      "zoom",
      "listen",
    ]);
  });
});

describe("chatModel", () => {
  it("is null for a chat with no model of its own, even with a default set", () => {
    const state = createAppState({ ...DEFAULT_SETTINGS, defaultModelId: "vision" });
    setModels(state, [model("vision")]);
    expect(chatModel(state, blankChat("", "chat", 1))).toBeNull();
    expect(chatModel(state, blankChat("vision", "chat", 1))?.id).toBe("vision");
  });
});

describe("the looking model", () => {
  it("sizes the sheets and caps the images in place of the chat's model", () => {
    const chat = videoChat("vision", "auto");
    const state = loaded({ ...chat, settings: { ...chat.settings, lookingModelId: "eyes" } });
    setModels(state, [model("vision", { maxImages: 6 }), model("eyes", { maxImages: 2 })]);
    setLoadedVideo(state, { chatId: "chat", file: new File([], "beach.mp4"), info: INFO });
    expect(toolContext(state, createMemoryStore())).toMatchObject({ maxImages: 2 });
  });

  it("offers ask whatever the chat's model sees", () => {
    const sent = [user("u", "hi", { images: [upload("i")] })];
    const parts = { videoLoaded: false, listen: false, looking: true };
    const { tools } = conversationTools(model("blind", { vision: false }), sent, parts);
    expect(tools.map((entry) => entry.function.name)).toEqual(["ask", "zoom"]);
  });
});
