import type { VideoInfo } from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import { chatModel, toolContext } from "../src/app/toolContext";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setCurrentChat, setLoadedVideo, setModels } from "../src/state";
import type { Chat, VideoAttachment } from "../src/types";
import { model } from "./support/factories";

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

describe("chatModel", () => {
  it("is null for a chat with no model of its own, even with a default set", () => {
    const state = createAppState({ ...DEFAULT_SETTINGS, defaultModelId: "vision" });
    setModels(state, [model("vision")]);
    expect(chatModel(state, blankChat("", "chat", 1))).toBeNull();
    expect(chatModel(state, blankChat("vision", "chat", 1))?.id).toBe("vision");
  });
});
