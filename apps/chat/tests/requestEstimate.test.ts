import { modelVisionProfile } from "@vid2grid/core";
import { beforeEach, describe, expect, it } from "vitest";
import { estimateNextRequest, estimateTokens } from "../src/app/requestEstimate";
import { blankChat } from "../src/chat/chats";
import { audioNote } from "../src/chat/prompts";
import { loadAudio } from "../src/audio/videoAudio";
import { createMemoryStore } from "../src/chat/store";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  addPending,
  createAppState,
  replaceChat,
  setCurrentChat,
  setModels,
  type AppState,
} from "../src/state";
import type { ChatMessage, EarlierImages, ImageRef, ModelInfo, StorySoFar } from "../src/types";
import { LISTEN_SCHEMA } from "../src/video/tools";
import { model as baseModel } from "./support/factories";
import { MESSAGES, reply } from "./support/usageFixtures";

let state: AppState;

function model(extra: Partial<ModelInfo> = {}): ModelInfo {
  return baseModel("m", { name: "M", contextTokens: 256_000, ...extra });
}

beforeEach(() => {
  state = createAppState({ ...DEFAULT_SETTINGS, apiKey: "key" });
});

describe("estimateNextRequest", () => {
  function upload(id: string, pinned: boolean): ImageRef {
    return { id, pinned, source: { kind: "upload", name: `${id}.jpg` } };
  }

  function estimateWith(
    messages: ChatMessage[],
    earlierImages: EarlierImages = "send",
  ): number | undefined {
    setModels(state, [model({ maxImages: 1 })]);
    const blank = blankChat("m", "chat", 1);
    const chat = {
      ...blank,
      settings: { ...blank.settings, earlierImages },
      storySoFar: { text: "Earlier they met.", throughMessageId: "a1", updatedAt: 1 },
    };
    setCurrentChat(state, chat, messages);
    return estimateNextRequest(state, undefined, false);
  }

  it("leaves images the story so far covers out of the image budget", () => {
    const covered: ChatMessage[] = [
      { id: "u1", createdAt: 0, role: "user", text: "hi", images: [upload("old", false)] },
      reply("a1", 10, 10),
    ];
    const newer: ChatMessage = {
      id: "u2",
      createdAt: 2,
      role: "user",
      text: "and now",
      images: [upload("new", false)],
    };
    const withImage = estimateWith([...covered, newer]) ?? 0;
    const withoutImage = estimateWith([...covered, { ...newer, images: [] }]) ?? 0;
    expect(withImage - withoutImage).toBeGreaterThan(100);
  });

  it("counts a pinned image the story so far covers, since it is still sent", () => {
    const pinned = upload("old", true);
    const covered = (images: ImageRef[]): ChatMessage[] => [
      { id: "u1", createdAt: 0, role: "user", text: "hi", images },
      reply("a1", 10, 10),
      { id: "u2", createdAt: 2, role: "user", text: "and now", images: [] },
    ];
    const withPin = estimateWith(covered([pinned])) ?? 0;
    const withoutPin = estimateWith(covered([])) ?? 0;
    expect(withPin - withoutPin).toBeGreaterThan(100);
  });

  it("counts an earlier image as the stub describe mode sends in its place", () => {
    const earlier: ChatMessage[] = [
      reply("a1", 10, 10),
      { id: "u2", createdAt: 2, role: "user", text: "and now", images: [upload("new", false)] },
    ];
    const described = estimateWith(earlier, "describe") ?? 0;
    const sent = estimateWith(earlier, "send") ?? 0;
    expect(sent - described).toBeGreaterThan(100);
  });
});

describe("audio in the estimate", () => {
  const COVERAGE = { text: "analysed 0:00 to 12:30 (speech and sounds)", canListen: true };
  const listenChars = JSON.stringify(LISTEN_SCHEMA).length + audioNote(COVERAGE).length;

  it("counts the listen tool and the audio note when audio is on", () => {
    const chat = blankChat("m", "chat", 1);
    const base = { chat, messages: MESSAGES, model: model(), videoLoaded: true };
    const without = estimateTokens(base);
    const withAudio = estimateTokens({ ...base, audioCoverage: COVERAGE });
    expect(withAudio - without).toBeGreaterThanOrEqual(Math.floor(listenChars / 4));
    const silent = { text: "the video has no audio track", canListen: false };
    const noTrack = estimateTokens({ ...base, audioCoverage: silent });
    expect(noTrack - without).toBeLessThan(JSON.stringify(LISTEN_SCHEMA).length / 4);
  });

  it("adds audio to the next request only when tools are available", () => {
    setModels(state, [model()]);
    setCurrentChat(state, blankChat("m", "chat", 1), MESSAGES);
    const plain = estimateNextRequest(state, undefined, true) ?? 0;
    expect(estimateNextRequest(state, undefined, true, COVERAGE)).toBeGreaterThan(plain);
    expect(estimateNextRequest(state, undefined, false, COVERAGE)).toBe(
      estimateNextRequest(state, undefined, false),
    );
  });
});

describe("the transcript in the estimate", () => {
  const VIDEO = {
    name: "talk.mp4",
    fileKey: "estimate-talk",
    durationSeconds: 3600,
    width: 640,
    height: 360,
  };
  const WORDS = "words said ".repeat(15).trim();

  async function hear(): Promise<void> {
    const store = createMemoryStore();
    await store.putAudio({
      fileKey: VIDEO.fileKey,
      labels: [],
      backgroundLabels: [],
      speechSpans: [{ startSeconds: 0, endSeconds: 3600 }],
      soundSpans: [],
      speech: Array.from({ length: 120 }, (_, index) => ({
        start: index * 30,
        end: index * 30 + 5,
        text: WORDS,
      })),
      events: [],
      updatedAt: 1,
    });
    await loadAudio(store, VIDEO.fileKey);
  }

  function estimateFor(
    messages: ChatMessage[],
    coverage = true,
    extra: Partial<ModelInfo> = {},
    story?: StorySoFar,
  ) {
    setModels(state, [model(extra)]);
    const blank = { ...blankChat("m", "chat", 1), video: VIDEO };
    const chat = story ? { ...blank, storySoFar: story } : blank;
    replaceChat(state, chat);
    setCurrentChat(state, chat, messages);
    const heard = { text: "analysed", canListen: true };
    return estimateNextRequest(state, undefined, coverage, coverage ? heard : undefined) ?? 0;
  }

  it("counts it on the message that would carry it, when audio is on", async () => {
    const before = estimateFor([]);
    const off = estimateFor([], false);
    await hear();
    const tokens = (120 * (WORDS.length + 8)) / 4;
    expect(estimateFor([]) - before).toBeGreaterThanOrEqual(tokens);
    expect(estimateFor([], false)).toBe(off);
    const small = estimateFor([], true, { contextTokens: 8000 }) - before;
    expect(small).toBeLessThan(2400);
    expect(small).toBeGreaterThan(1500);
  });

  const sent: ChatMessage = {
    id: "u1",
    createdAt: 0,
    role: "user",
    text: "hi",
    images: [],
    audio: true,
    transcript: { fileKey: VIDEO.fileKey, spans: [{ startSeconds: 0, endSeconds: 3600 }] },
  };
  const answered = reply("a1", 10, 10);

  it("counts only the stub once it has been sent, or all of it without listen", async () => {
    await hear();
    const first = estimateFor([]);
    expect(first - estimateFor([sent, answered])).toBeGreaterThan(5000);
    const noTools = { tools: false };
    const still = estimateFor([sent, answered], true, noTools) - estimateFor([], true, noTools);
    expect(Math.abs(still)).toBeLessThan(50);
  });

  it("counts it again once the message that carried it is in the chat summary", async () => {
    await hear();
    const story = { text: "They spoke.", throughMessageId: answered.id, updatedAt: 1 };
    const folded = estimateFor([sent, answered], true, {}, story);
    expect(folded - estimateFor([sent, answered])).toBeGreaterThan(5000);
  });
});

describe("tools in the estimate", () => {
  const withImage: ChatMessage[] = [
    {
      id: "u",
      createdAt: 0,
      role: "user",
      text: "hi",
      images: [{ id: "i", pinned: false, source: { kind: "upload", name: "i.jpg" } }],
    },
  ];

  function toolTokens(vision: boolean, messages: ChatMessage[]): number {
    const chat = blankChat("m", "chat", 1);
    const base = { chat, messages, videoLoaded: false };
    const offered = estimateTokens({ ...base, model: model({ vision }) });
    return offered - estimateTokens({ ...base, model: model({ vision, tools: false }) });
  }

  it("counts recall and zoom for an image chat with a vision model, and nothing otherwise", () => {
    expect(toolTokens(true, withImage)).toBeGreaterThan(200);
    expect(toolTokens(false, withImage)).toBe(0);
    expect(toolTokens(true, MESSAGES)).toBe(0);
  });

  it("counts an image waiting in the composer", () => {
    setModels(state, [model()]);
    setCurrentChat(state, blankChat("m", "chat", 1), []);
    const before = estimateNextRequest(state, undefined, false) ?? 0;
    addPending(state, "chat", {
      kind: "image",
      ref: { id: "p", pinned: false, source: { kind: "upload", name: "p.jpg" } },
    });
    const withTools = (estimateNextRequest(state, undefined, false) ?? 0) - before;
    setModels(state, [model({ tools: false })]);
    const withoutTools = (estimateNextRequest(state, undefined, false) ?? 0) - before;
    expect(withTools - withoutTools).toBeGreaterThan(200);
  });
});

describe("estimateTokens", () => {
  const QWEN = "qwen3-6-27b";

  function overview(resolution?: number): ImageRef {
    return {
      id: "overview-1",
      pinned: false,
      source: {
        kind: "sheet",
        call: "overview",
        name: "overview_1",
        startSeconds: 0,
        endSeconds: 60,
        frameCount: 16,
        ...(resolution === undefined ? {} : { resolution }),
      },
    };
  }

  function estimateWith(image: ImageRef): number {
    const blank = blankChat(QWEN, "chat", 1);
    const chat = { ...blank, settings: { ...blank.settings, sheetResolution: 2048 } };
    const messages: ChatMessage[] = [
      { id: "u", createdAt: 0, role: "user", text: "hi", images: [image] },
    ];
    return estimateTokens({ chat, messages, model: model({ id: QWEN }), videoLoaded: false });
  }

  it("prices a sheet at its recorded side, falling back to the chat resolution", () => {
    const { imageTokens } = modelVisionProfile(QWEN);
    if (!imageTokens) throw new Error("Expected an image token formula");
    expect(estimateWith(overview()) - estimateWith(overview(512))).toBe(
      imageTokens(2048) - imageTokens(512),
    );
  });
});
