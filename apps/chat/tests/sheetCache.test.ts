import { describe, expect, it } from "vitest";
import { sheetCacheKey } from "../src/video/sheetCache";

describe("sheetCacheKey", () => {
  it("does not depend on property order", () => {
    const a = sheetCacheKey("v|1|2", { startSeconds: 0, endSeconds: 10, frameCount: 4 });
    const b = sheetCacheKey("v|1|2", { frameCount: 4, endSeconds: 10, startSeconds: 0 });
    expect(a).toBe(b);
  });

  it("is not the key sheets were cached under before frames were timed correctly", () => {
    expect(sheetCacheKey("v|1|2", { frameCount: 4 })).not.toBe('v|1|2#[["frameCount",4]]');
  });

  it("ignores undefined values", () => {
    expect(sheetCacheKey("v|1|2", { frameCount: 4, jpegQuality: undefined })).toBe(
      sheetCacheKey("v|1|2", { frameCount: 4 }),
    );
  });

  it("differs by file and by value", () => {
    const base = sheetCacheKey("v|1|2", { frameCount: 4 });
    expect(sheetCacheKey("w|1|2", { frameCount: 4 })).not.toBe(base);
    expect(sheetCacheKey("v|1|2", { frameCount: 5 })).not.toBe(base);
  });

  it("adds keyframe times only when given, and differs by them", () => {
    const base = sheetCacheKey("v|1|2", { keyframeSampling: true });
    const first = sheetCacheKey("v|1|2", { keyframeSampling: true }, [1, 2.5]);
    expect(sheetCacheKey("v|1|2", { keyframeSampling: true }, undefined)).toBe(base);
    expect(first).not.toBe(base);
    expect(sheetCacheKey("v|1|2", { keyframeSampling: true }, [1, 3])).not.toBe(first);
  });
});
