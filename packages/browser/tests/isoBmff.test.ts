import { afterEach, describe, expect, it, vi } from "vitest";
import { looksLikeIsoBmff, supportsWebCodecs } from "../src/capture/isoBmff";

const file = (name: string, type = "") => new File([new Uint8Array([0])], name, { type });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("looksLikeIsoBmff", () => {
  it.each([
    ["clip.bin", "video/mp4"],
    ["clip.bin", "video/quicktime"],
    ["clip.mp4", ""],
    ["clip.m4v", ""],
    ["clip.mov", ""],
  ])("accepts %s typed %j", (name, type) => {
    expect(looksLikeIsoBmff(file(name, type))).toBe(true);
  });

  it("matches the extension case-insensitively", () => {
    expect(looksLikeIsoBmff(file("CLIP.MOV"))).toBe(true);
  });

  it.each([
    ["clip.webm", "video/webm"],
    ["clip.mkv", "video/x-matroska"],
    ["clip", ""],
    ["mp4", ""],
  ])("rejects %s typed %j", (name, type) => {
    expect(looksLikeIsoBmff(file(name, type))).toBe(false);
  });
});

describe("supportsWebCodecs", () => {
  it("needs a VideoDecoder as well as an ISO BMFF file", () => {
    expect(supportsWebCodecs(file("clip.mp4", "video/mp4"))).toBe(false);

    vi.stubGlobal("VideoDecoder", class {});
    expect(supportsWebCodecs(file("clip.mp4", "video/mp4"))).toBe(true);
    expect(supportsWebCodecs(file("clip.webm", "video/webm"))).toBe(false);
  });
});
