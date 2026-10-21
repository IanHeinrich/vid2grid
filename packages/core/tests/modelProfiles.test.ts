import { describe, expect, it } from "vitest";
import { CUSTOM_OPTION, MODEL_RESOLUTION_PRESETS } from "../src/grid/modelProfiles";

describe("MODEL_RESOLUTION_PRESETS", () => {
  const entries = Object.entries(MODEL_RESOLUTION_PRESETS);

  it("offers presets, each a positive whole pixel size", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [, resolution] of entries) {
      expect(Number.isInteger(resolution)).toBe(true);
      expect(resolution).toBeGreaterThan(0);
    }
  });

  it("keeps a conservative default for an unknown model", () => {
    expect(MODEL_RESOLUTION_PRESETS["Unknown model (conservative default)"]).toBe(1536);
  });

  it("never collides with the custom option's label", () => {
    expect(CUSTOM_OPTION).toBe("Custom");
    expect(Object.keys(MODEL_RESOLUTION_PRESETS)).not.toContain(CUSTOM_OPTION);
  });
});
