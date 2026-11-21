import { describe, expect, it } from "vitest";
import {
  OVERVIEW_TOKEN_BUDGET,
  resolveOverviewResolution,
  resolveSheetResolution,
} from "../src/video/resolution";
import { model } from "./support/factories";

describe("resolveSheetResolution", () => {
  it("uses a fixed resolution as is", () => {
    expect(resolveSheetResolution(1024, model("qwen3-6-27b"))).toEqual({
      px: 1024,
      reason: "Fixed at 1024 px",
    });
  });

  it.each([
    ["qwen3-6-27b", 3072, "Auto for Qwen"],
    ["claude-opus-4-7", 1932, "Auto for Claude (4.7 and later)"],
    ["claude-sonnet-4-6", 1092, "Auto for Claude"],
    ["gemma-3-27b", 896, "Auto for Gemma 3"],
    ["openai-gpt-54", 1600, "Auto for GPT-5.4"],
  ])("picks the family's resolution for %s", (id, px, reason) => {
    expect(resolveSheetResolution("auto", model(id, { contextTokens: 1_000_000 }))).toEqual({
      px,
      reason,
    });
  });

  it("keeps the family's resolution when the context size is unknown", () => {
    expect(resolveSheetResolution("auto", model("qwen3-6-27b")).px).toBe(3072);
  });

  it("steps down until a full set of images fits half the context", () => {
    expect(
      resolveSheetResolution("auto", model("qwen3-6-27b", { contextTokens: 131_072 })),
    ).toEqual({ px: 2560, reason: "Auto for Qwen, reduced to fit the context" });
    expect(
      resolveSheetResolution("auto", model("qwen3-6-27b", { contextTokens: 40_000, maxImages: 4 })),
    ).toEqual({ px: 2048, reason: "Auto for Qwen, reduced to fit the context" });
  });

  it("only steps down to sizes below the family's resolution", () => {
    const resolved = resolveSheetResolution(
      "auto",
      model("openai-gpt-54", { contextTokens: 56_000 }),
    );
    expect(resolved.px).toBe(1536);
  });

  it("stops at the smallest step when nothing fits", () => {
    expect(resolveSheetResolution("auto", model("qwen3-6-27b", { contextTokens: 8_000 })).px).toBe(
      768,
    );
  });

  it("does not step down a family with no token estimate", () => {
    expect(resolveSheetResolution("auto", model("grok-4-5", { contextTokens: 1_000 }))).toEqual({
      px: 1536,
      reason: "Auto for Grok",
    });
  });

  it("falls back to a conservative size for an unknown model", () => {
    expect(resolveSheetResolution("auto", model("venice-uncensored"))).toEqual({
      px: 1536,
      reason: "Auto for Unknown model",
    });
  });
});

describe("resolveOverviewResolution", () => {
  const qwen = model("qwen3-6-27b", { contextTokens: 1_000_000 });

  it("steps four Qwen sheets down to 2048 px to stay under the budget", () => {
    expect(OVERVIEW_TOKEN_BUDGET).toBe(20000);
    expect(resolveOverviewResolution("auto", qwen, 4)).toEqual({
      px: 2048,
      reason: "Overview at 2048 px to keep it under 20k tokens",
    });
  });

  it("keeps the Auto size when the sheets already fit", () => {
    expect(resolveOverviewResolution("auto", qwen, 2)).toEqual({
      px: 3072,
      reason: "Auto for Qwen",
    });
  });

  it("respects a fixed size", () => {
    expect(resolveOverviewResolution(3072, qwen, 4)).toEqual({
      px: 3072,
      reason: "Fixed at 3072 px",
    });
  });

  it("keeps Auto for a model with no token estimate", () => {
    expect(resolveOverviewResolution("auto", model("grok-4-5"), 4)).toEqual({
      px: 1536,
      reason: "Auto for Grok",
    });
  });

  it("starts from the context-reduced Auto size", () => {
    const small = model("qwen3-6-27b", { contextTokens: 60_000 });
    const full = resolveSheetResolution("auto", small).px;
    expect(full).toBeLessThan(3072);
    expect(resolveOverviewResolution("auto", small, 1).px).toBe(full);
  });

  it("stops at the smallest step when nothing fits", () => {
    expect(resolveOverviewResolution("auto", qwen, 100)).toEqual({
      px: 768,
      reason: "Overview at 768 px, the smallest size, still over 20k tokens",
    });
  });
});
