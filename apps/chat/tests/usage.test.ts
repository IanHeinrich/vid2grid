import { describe, expect, it } from "vitest";
import { addUsage, usageCostUsd } from "../src/api/usage";

describe("addUsage", () => {
  it("returns whichever side is present when the other is missing", () => {
    const usage = { promptTokens: 5, completionTokens: 1 };
    expect(addUsage(undefined, undefined)).toBeUndefined();
    expect(addUsage(usage, undefined)).toBe(usage);
    expect(addUsage(undefined, usage)).toBe(usage);
  });

  it("sums every field, keeping optional ones absent until seen", () => {
    const plain = { promptTokens: 100, completionTokens: 10 };
    expect(addUsage(plain, plain)).toEqual({ promptTokens: 200, completionTokens: 20 });
    expect(addUsage(plain, { ...plain, reasoningTokens: 4 })).toEqual({
      promptTokens: 200,
      completionTokens: 20,
      reasoningTokens: 4,
    });
    expect(
      addUsage(
        { ...plain, reasoningTokens: 4, cachedTokens: 50 },
        { ...plain, reasoningTokens: 6, cachedTokens: 25 },
      ),
    ).toEqual({ promptTokens: 200, completionTokens: 20, reasoningTokens: 10, cachedTokens: 75 });
  });
});

describe("usageCostUsd", () => {
  const usage = { promptTokens: 2_000_000, completionTokens: 500_000, cachedTokens: 1_000_000 };

  it("is undefined without pricing", () => {
    expect(usageCostUsd(usage)).toBeUndefined();
  });

  it("prices prompt and completion per million, cached tokens at the input rate", () => {
    expect(usageCostUsd(usage, { inputPerMTok: 0.7, outputPerMTok: 2.8 })).toBeCloseTo(
      2 * 0.7 + 0.5 * 2.8,
    );
  });

  it("prices cached tokens at the cache-read rate when the model has one", () => {
    const pricing = { inputPerMTok: 0.7, outputPerMTok: 2.8, cachedInputPerMTok: 0.35 };
    expect(usageCostUsd(usage, pricing)).toBeCloseTo(0.7 + 0.35 + 0.5 * 2.8);
  });

  it("never counts more cached tokens than prompt tokens", () => {
    const pricing = { inputPerMTok: 1, outputPerMTok: 0, cachedInputPerMTok: 0 };
    const overcounted = { promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 3_000_000 };
    expect(usageCostUsd(overcounted, pricing)).toBe(0);
  });
});
