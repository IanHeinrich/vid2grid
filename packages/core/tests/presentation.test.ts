import { describe, expect, it } from "vitest";
import { buildGridsFolderName, formatClock, sanitizeForFileName } from "../src/presentation";

const NOW = new Date("2026-07-17T14:30:00.000Z");

describe("formatClock", () => {
  it("shows whole minutes and zero-padded seconds, rounding to the nearest second", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5.4)).toBe("0:05");
    expect(formatClock(59.5)).toBe("1:00");
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(3725)).toBe("62:05");
  });

  it("never shows a negative time", () => {
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("sanitizeForFileName", () => {
  it("replaces each run of unsafe characters with one underscore", () => {
    expect(sanitizeForFileName('a\\b/c:d*?e"f<g>h|i')).toBe("a_b_c_d_e_f_g_h_i");
  });

  it("trims surrounding whitespace and falls back when nothing is left", () => {
    expect(sanitizeForFileName("  clip  ")).toBe("clip");
    expect(sanitizeForFileName("   ")).toBe("video");
    expect(sanitizeForFileName("")).toBe("video");
  });
});

describe("buildGridsFolderName", () => {
  it("strips the extension and appends a grids/timestamp suffix", () => {
    expect(buildGridsFolderName("myClip.mp4", NOW)).toBe("myClip_grids_2026-07-17_143000");
  });

  it("sanitizes characters that aren't safe in a folder name", () => {
    expect(buildGridsFolderName("weird:name*?.mov", NOW)).toBe(
      "weird_name__grids_2026-07-17_143000",
    );
  });

  it("falls back to a generic name for an empty/dot-only source name", () => {
    expect(buildGridsFolderName(".mp4", NOW)).toBe("video_grids_2026-07-17_143000");
  });

  it("strips only the last extension", () => {
    expect(buildGridsFolderName("take.2.final.mov", NOW)).toBe(
      "take.2.final_grids_2026-07-17_143000",
    );
  });

  it("defaults to the current time", () => {
    expect(buildGridsFolderName("clip.mp4")).toMatch(/^clip_grids_\d{4}-\d{2}-\d{2}_\d{6}$/);
  });
});
