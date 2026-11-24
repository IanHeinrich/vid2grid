import { describe, expect, it } from "vitest";
import type { ZoomTarget } from "../src/types";
import { sheetCacheKey, sheetOwner, zoomCacheKey } from "../src/video/sheetCache";

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

describe("sheetOwner", () => {
  const area = { left: 0, top: 0, right: 500, bottom: 500 };

  it.each([
    "v.mp4|1|2",
    "zoom#clip.mp4|1|2",
    'zoom#["moment","x"].mp4|1|2',
    "a#[b.mp4|1|2",
    "a#v2[b.mp4|1|2",
    "a#[2,b]@3.mp4|1|2",
    "a|b|.mp4|1|2",
    "a]@1,2.5.mp4|1|2",
    'say "hi"#["x",1].mp4|1|2',
    "a\nb|1|2",
  ])("reads the video %j back from a sheet's and a zoom's key", (fileKey) => {
    const owner = { kind: "video", fileKey };
    const moment: ZoomTarget = { kind: "moment", seconds: 5, fileKey };
    expect(sheetOwner(sheetCacheKey(fileKey, {}))).toEqual(owner);
    expect(sheetOwner(sheetCacheKey(fileKey, { frameCount: 4 }))).toEqual(owner);
    expect(sheetOwner(sheetCacheKey(fileKey, { frameCount: 4 }, [1, 2.5]))).toEqual(owner);
    expect(sheetOwner(zoomCacheKey(moment, area, 1024))).toEqual(owner);
    const versioned = `${fileKey}#[2,["endSeconds",10],["frameCount",4]]`;
    expect(sheetOwner(versioned)).toEqual(owner);
    expect(sheetOwner(`${versioned}@1,2.5`)).toEqual(owner);
    expect(sheetOwner(`${fileKey}#[2]`)).toEqual(owner);
  });

  it("reads the image a zoom was cropped from", () => {
    const target: ZoomTarget = { kind: "image", id: "upload", name: 'a "b" #[c].jpg' };
    expect(sheetOwner(zoomCacheKey(target, area, 1024))).toEqual({ kind: "image", id: "upload" });
  });

  it.each([
    "key",
    "zoom#{}",
    "zoom#[]",
    'zoom#["moment"]',
    'zoom#["clip","x",1]',
    'zoom#[2,["endSeconds",10]]',
    'zoom#["moment",5,"x#[1]"]',
    'zoom#["clip","x#[1]"]',
  ])("knows no owner for %j", (key) => {
    expect(sheetOwner(key)).toBeUndefined();
  });
});
