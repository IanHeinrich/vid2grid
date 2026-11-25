import { describe, expect, it } from "vitest";
import {
  contextLevel,
  estimateRequestTokens,
  formatTokens,
  replyUsageText,
  sheetSidesByUrl,
  totalCostUsd,
  usageTotals,
} from "../src/chat/tokenEstimate";
import type { ChatMessage, ChatRequest, ImageRef } from "../src/types";
import { lookTool } from "./support/requestFixtures";
import { MESSAGES, reply } from "./support/usageFixtures";

describe("estimateRequestTokens", () => {
  const request: ChatRequest = {
    model: "m",
    stream: true,
    messages: [
      { role: "system", content: "a".repeat(40) },
      {
        role: "user",
        content: [
          { type: "text", text: "b".repeat(20) },
          { type: "image_url", image_url: { url: "data:x".repeat(1000) } },
          { type: "image_url", image_url: { url: "data:y" } },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "look", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "c".repeat(10) },
    ],
  };

  it("counts text at four characters a token and each image at the model's cost", () => {
    expect(estimateRequestTokens(request, 1024, (side) => side / 2)).toBe(19 + 2 * 512);
  });

  it("falls back to 1500 tokens an image when the cost is unknown", () => {
    expect(estimateRequestTokens(request, 1024)).toBe(19 + 2 * 1500);
  });

  it("counts the tool schemas", () => {
    const withTools = { ...request, tools: [lookTool] };
    const schemaChars = JSON.stringify([lookTool]).length;
    expect(estimateRequestTokens(withTools, 1024)).toBe(
      Math.ceil((76 + schemaChars) / 4) + 2 * 1500,
    );
  });
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

describe("sheetSidesByUrl", () => {
  const zoomRef = (width: number, height: number): ImageRef => ({
    id: "z",
    pinned: false,
    source: {
      kind: "zoom",
      name: "zoom(0:10, 0, 0, 500, 500)",
      target: { kind: "moment", seconds: 10, fileKey: "k" },
      area: { left: 0, top: 0, right: 500, bottom: 500 },
      width,
      height,
    },
  });
  const toolWith = (images: ImageRef[]): ChatMessage => ({
    id: "t",
    createdAt: 0,
    role: "tool",
    toolCallId: "c",
    text: "",
    images,
  });
  const upload: ImageRef = { id: "u", pinned: false, source: { kind: "upload", name: "a.png" } };
  const dataUrls = new Map([
    ["z", "data:z"],
    ["u", "data:u"],
  ]);

  it("prices a zoom at the side of the square with the same area, rounded up", () => {
    const sides = sheetSidesByUrl([toolWith([zoomRef(800, 450)])], dataUrls);
    expect(sides.get("data:z")).toBe(600);
    expect(sheetSidesByUrl([toolWith([zoomRef(1000, 333)])], dataUrls).get("data:z")).toBe(578);
  });

  it("leaves uploads to the chat's resolution", () => {
    expect(sheetSidesByUrl([toolWith([upload])], dataUrls).size).toBe(0);
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

describe("totals with a looking model", () => {
  const usage = { promptTokens: 1000, completionTokens: 100 };
  const note = { kind: "described" as const, imageIds: ["i"], modelId: "eyes", text: "A dog." };
  const looked: ChatMessage[] = [
    { id: "u", createdAt: 0, role: "user", text: "hi", images: [], seen: [{ ...note, usage }] },
    { id: "t", createdAt: 0, role: "tool", toolCallId: "c", text: "", images: [], seen: [note] },
    reply("a", 2000, 200),
  ];
  const cheap = { inputPerMTok: 1, outputPerMTok: 10 };
  const dear = { inputPerMTok: 100, outputPerMTok: 1000 };

  it("adds its tokens, and nothing for a note that was reused", () => {
    expect(usageTotals(looked)).toMatchObject({ promptTokens: 3000, completionTokens: 300 });
  });

  it("prices each model's tokens at its own price, where it is known", () => {
    const eyes = (id: string) => (id === "eyes" ? dear : undefined);
    expect(totalCostUsd(looked, cheap, eyes)).toBeCloseTo(0.004 + 0.2);
    expect(totalCostUsd(looked, undefined, eyes)).toBeCloseTo(0.2);
    expect(totalCostUsd(looked, cheap)).toBeCloseTo(0.004);
    expect(totalCostUsd(looked, undefined)).toBeUndefined();
  });
});
