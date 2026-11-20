import { describe, expect, it } from "vitest";
import { modelVisionProfile } from "../src/grid/modelVision";

function tokensAt(modelId: string, squarePx: number): number | undefined {
  return modelVisionProfile(modelId).imageTokens?.(squarePx);
}

describe("modelVisionProfile", () => {
  it.each([
    ["google-gemma-3-27b-it", "Gemma 3", 896, "high"],
    ["gemma-4-31b", "Gemma 4", 768, "high"],
    ["qwen3-6-27b", "Qwen", 3072, "high"],
    ["mimo-v2-omni", "MiMo", 3072, "medium"],
    ["claude-opus-4-7", "Claude (4.7 and later)", 1932, "high"],
    ["claude-opus-4-8", "Claude (4.7 and later)", 1932, "high"],
    ["claude-sonnet-5", "Claude (4.7 and later)", 1932, "high"],
    ["claude-fable-5", "Claude (4.7 and later)", 1932, "high"],
    ["claude-opus-4-6", "Claude", 1092, "high"],
    ["openai-gpt-4o-2024-11-20", "GPT-4o", 768, "high"],
    ["openai-gpt-54", "GPT-5.4", 1600, "high"],
    ["openai-gpt-52", "GPT-5.2 and 5.3", 2048, "medium"],
    ["openai-gpt-53-codex", "GPT-5.2 and 5.3", 2048, "medium"],
    ["openai-gpt-55", "GPT-5.5 and later", 3072, "high"],
    ["openai-gpt-56", "GPT-5.5 and later", 3072, "high"],
    ["openai-gpt-6-astra", "GPT-5.5 and later", 3072, "medium"],
    ["mistral-small-3-2-24b-instruct", "Mistral Small", 1540, "high"],
    ["deepseek-v4-vl", "DeepSeek", 1300, "medium"],
    ["minimax-m3", "MiniMax", 1008, "medium"],
    ["nvidia-nemotron-nano-12b-v2-vl", "Nemotron VL", 1536, "low"],
    ["kimi-k2-6", "Kimi", 2048, "low"],
    ["gemini-3-pro-preview", "Gemini", 1536, "low"],
    ["grok-4-5", "Grok", 1536, "low"],
    ["zai-org-glm-5v", "GLM", 1536, "low"],
  ])("matches %s to %s", (modelId, family, autoResolution, confidence) => {
    expect(modelVisionProfile(modelId)).toMatchObject({ family, autoResolution, confidence });
  });

  it("ignores case and an e2ee- prefix", () => {
    expect(modelVisionProfile("e2ee-qwen3-6-27b").family).toBe("Qwen");
    expect(modelVisionProfile("CLAUDE-OPUS-4-7").family).toBe("Claude (4.7 and later)");
  });

  it("falls back to a conservative profile with no estimate for an unknown model", () => {
    const profile = modelVisionProfile("venice-uncensored");
    expect(profile).toEqual({ family: "Unknown model", autoResolution: 1536, confidence: "low" });
    expect(profile.imageTokens).toBeUndefined();
    expect(modelVisionProfile("nvidia-nemotron-ultra").family).toBe("Unknown model");
  });

  it("has no estimate for Grok or GLM", () => {
    expect(tokensAt("grok-4-5", 1024)).toBeUndefined();
    expect(tokensAt("glm-5v", 1024)).toBeUndefined();
  });
});

describe("modelVisionProfile imageTokens", () => {
  it.each([
    ["gemma-3-27b", [256, 256, 256]],
    ["gemma-4-31b", [256, 256, 256]],
    ["qwen3-6-27b", [1026, 4098, 9218]],
    ["mimo-v2-omni", [1024, 4096, 9216]],
    ["claude-opus-4-7", [1369, 4761, 4761]],
    ["claude-opus-4-6", [1369, 1521, 1521]],
    ["openai-gpt-4o", [765, 765, 765]],
    ["openai-gpt-54", [1229, 3000, 3000]],
    ["openai-gpt-52", [1229, 4916, 11060]],
    ["openai-gpt-56", [1229, 4916, 11060]],
    ["mistral-small-3-2", [1406, 3080, 3080]],
    ["deepseek-v4", [1024, 1024, 1024]],
    ["minimax-m3", [1296, 1296, 1296]],
    ["nemotron-nano-vl", [1280, 3328, 3328]],
    ["kimi-k2-6", [1369, 5476, 12100]],
    ["gemini-3-pro", [1120, 1120, 1120]],
  ])("estimates %s at 1024, 2048 and 3072 px", (modelId, expected) => {
    expect([1024, 2048, 3072].map((px) => tokensAt(modelId, px))).toEqual(expected);
  });
});
