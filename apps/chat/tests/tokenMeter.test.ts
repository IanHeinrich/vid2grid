import { modelVisionProfile } from "@vid2grid/core";
import { beforeEach, describe, expect, it } from "vitest";
import { audioNote } from "../src/chat/history";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import { blankChat, createAppState, setCurrentChat, setModels, type AppState } from "../src/state";
import type {
  AssistantMessage,
  ChatMessage,
  EarlierImages,
  ImageRef,
  ModelInfo,
} from "../src/types";
import {
  contextLevel,
  estimateNextRequest,
  estimateTokens,
  formatTokens,
  initUsageMeter,
  replyUsageText,
  usageTotals,
} from "../src/ui/tokenMeter";
import { LISTEN_SCHEMA } from "../src/video/tools";
import { model as baseModel } from "./support/factories";
import { mountPage } from "./support/page";

let els: AppElements;
let state: AppState;

function model(extra: Partial<ModelInfo> = {}): ModelInfo {
  return baseModel("m", { name: "M", contextTokens: 256_000, ...extra });
}

function reply(id: string, promptTokens: number, completionTokens: number): AssistantMessage {
  return {
    id,
    createdAt: 1,
    role: "assistant",
    text: "ok",
    toolCalls: [],
    usage: { promptTokens, completionTokens, cachedTokens: 1000 },
  };
}

const MESSAGES: ChatMessage[] = [
  { id: "u", createdAt: 0, role: "user", text: "hi", images: [] },
  reply("a1", 300_000, 10_000),
  reply("a2", 112_000, 8_000),
];

beforeEach(() => {
  els = mountPage();
  state = createAppState({ ...DEFAULT_SETTINGS, apiKey: "key" });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(640)).toBe("640");
    expect(formatTokens(9800)).toBe("9.8k");
    expect(formatTokens(10_000)).toBe("10k");
    expect(formatTokens(412_300)).toBe("412k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatTokens(23_000_000)).toBe("23M");
  });
});

describe("totals", () => {
  it("sums usage across the chat's replies", () => {
    expect(usageTotals(MESSAGES)).toEqual({
      promptTokens: 412_000,
      completionTokens: 18_000,
      cachedTokens: 2000,
    });
    expect(replyUsageText([reply("a", 9800, 640)])).toBe("9.8k in / 640 out");
    expect(replyUsageText([])).toBe("");
  });
});

describe("contextLevel", () => {
  it("turns amber above 70% and red above 90%", () => {
    expect(contextLevel(70_000, 100_000)).toBe("ok");
    expect(contextLevel(70_001, 100_000)).toBe("warn");
    expect(contextLevel(90_001, 100_000)).toBe("danger");
    expect(contextLevel(90_001, undefined)).toBe("ok");
  });
});

describe("initUsageMeter", () => {
  function meterFor(info: ModelInfo): void {
    setModels(state, [info]);
    setCurrentChat(state, blankChat("m", "chat", 1), MESSAGES);
    initUsageMeter(els, state, { timeline: () => undefined, toolsAvailable: () => false });
  }

  it("shows the context estimate against the window and the chat totals", () => {
    meterFor(model());
    expect(els.header.usageContext.textContent).toMatch(/^Context ≈ \S+ \/ 256k$/);
    expect(els.header.usageTotals.textContent).toBe(" · 412k in · 18k out");
    expect(els.header.usageLine.title).toContain("This chat: 412k input (2k cached), 18k output");
  });

  it("adds the cost only when the model has pricing", () => {
    meterFor(model({ pricing: { inputPerMTok: 0.5, outputPerMTok: 2 } }));
    expect(els.header.usageTotals.textContent).toBe(" · 412k in · 18k out · ≈ $0.24");
  });

  it("colours a nearly full context and suggests making room", () => {
    meterFor(model({ contextTokens: 2 }));
    expect(els.header.usageContext.classList.contains("is-danger")).toBe(true);
    expect(els.header.usageLine.title).toContain("Unpin images");
  });
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
    const base = { chat, messages: MESSAGES, model: model(), allowTools: true };
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
    return estimateTokens({ chat, messages, model: model({ id: QWEN }), allowTools: false });
  }

  it("prices a sheet at its recorded side, falling back to the chat resolution", () => {
    const { imageTokens } = modelVisionProfile(QWEN);
    if (!imageTokens) throw new Error("Expected an image token formula");
    expect(estimateWith(overview()) - estimateWith(overview(512))).toBe(
      imageTokens(2048) - imageTokens(512),
    );
  });
});
