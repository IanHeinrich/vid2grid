import { describe, expect, it } from "vitest";
import { seenSpans, unseenCitations } from "../src/chat/coverage";
import type {
  AssistantMessage,
  ChatMessage,
  ImageRef,
  ToolMessage,
  UserMessage,
  ZoomTarget,
} from "../src/types";

function sheet(
  id: string,
  call: string,
  startSeconds: number,
  endSeconds: number,
  frameCount: number,
): ImageRef {
  return {
    id,
    pinned: false,
    source: { kind: "sheet", call, name: id, startSeconds, endSeconds, frameCount },
  };
}

function user(images: ImageRef[]): UserMessage {
  return { id: "u", createdAt: 0, role: "user", text: "", images };
}

function tool(images: ImageRef[]): ToolMessage {
  return { id: "t", createdAt: 0, role: "tool", toolCallId: "c", text: "", images };
}

const reply: AssistantMessage = {
  id: "a",
  createdAt: 0,
  role: "assistant",
  text: "[0:30]",
  toolCalls: [],
};

function zoom(id: string, target: ZoomTarget): ImageRef {
  return {
    id,
    pinned: false,
    source: {
      kind: "zoom",
      name: id,
      target,
      area: { left: 0, top: 0, right: 500, bottom: 500 },
      width: 400,
      height: 400,
    },
  };
}

describe("seenSpans", () => {
  it("is empty without sheets", () => {
    const upload: ImageRef = { id: "x", pinned: false, source: { kind: "upload", name: "x.jpg" } };
    expect(seenSpans([user([upload]), reply])).toEqual([]);
  });

  it("counts a zoom of a moment as that instant seen, and a zoom of an image as nothing", () => {
    const moment = zoom("zm", { kind: "moment", seconds: 42.5, fileKey: "k" });
    const image = zoom("zi", { kind: "image", id: "u", name: "beach.jpg" });
    expect(seenSpans([tool([moment, image])])).toEqual([
      { startSeconds: 42, endSeconds: 43, framesPerSecond: 1 },
    ]);
    expect(seenSpans([tool([image])])).toEqual([]);
  });

  it("pads a look's span and gives its frame density", () => {
    expect(seenSpans([tool([sheet("l", "look(60, 90)", 60, 89, 16)])])).toEqual([
      { startSeconds: 59.5, endSeconds: 89.5, framesPerSecond: 16 / 30 },
    ]);
  });

  it("covers only the instants of a frames sheet", () => {
    const frames = sheet("f", "frames(1:42, 1:45.5)", 102, 105.51, 2);
    expect(seenSpans([tool([frames])])).toEqual([
      { startSeconds: 101.5, endSeconds: 102.5, framesPerSecond: 1 },
      { startSeconds: 105, endSeconds: 106, framesPerSecond: 1 },
    ]);
  });

  it("merges overlapping sheets in time order and counts a repeated sheet once", () => {
    const messages: ChatMessage[] = [
      user([sheet("o", "overview", 0, 20, 10)]),
      tool([sheet("l", "look(15, 30)", 15, 30, 9), sheet("o", "overview", 0, 20, 10)]),
      tool([sheet("far", "look(100, 110)", 100, 110, 4)]),
    ];
    const spans = seenSpans(messages);
    expect(spans.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds])).toEqual([
      [0, 30.5],
      [99.5, 110.5],
    ]);
    expect(spans[0]?.framesPerSecond).toBeCloseTo(19 / 30.5);
  });

  it("falls back to the sheet's span for a call it cannot read", () => {
    expect(seenSpans([tool([sheet("old", "frame(12)", 12, 12, 1)])])).toEqual([
      { startSeconds: 11.5, endSeconds: 12.5, framesPerSecond: 1 },
    ]);
  });
});

describe("unseenCitations", () => {
  const spans = seenSpans([tool([sheet("l", "look(60, 90)", 60, 90, 16)])]);

  it("lists each cited time outside every span once, in order", () => {
    const text = "At [2:05] and [0:10], then [1:15], and [2:05] again; [1:30.4] counts as seen.";
    expect(unseenCitations(text, spans)).toEqual([125, 10]);
  });

  it("counts bracketed and parenthesised times, not clock times in prose", () => {
    const text = "At 5:30 the next morning she left (0:20), and at [0:30].";
    expect(unseenCitations(text, spans)).toEqual([20, 30]);
  });

  it("finds nothing unseen without citations", () => {
    expect(unseenCitations("No times here.", spans)).toEqual([]);
    expect(unseenCitations("[0:05]", [])).toEqual([5]);
  });
});
