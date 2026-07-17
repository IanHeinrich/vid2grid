import { describe, expect, it } from "vitest";
import { buildGridsFolderName } from "../src/download";

describe("buildGridsFolderName", () => {
  it("strips the extension and appends a grids/timestamp suffix", () => {
    const name = buildGridsFolderName("myClip.mp4", new Date("2026-07-17T14:30:00.000Z"));
    expect(name).toBe("myClip_grids_2026-07-17_143000");
  });

  it("sanitizes characters that aren't safe in a folder name", () => {
    const name = buildGridsFolderName('weird:name*?.mov', new Date("2026-07-17T14:30:00.000Z"));
    expect(name).toBe("weird_name__grids_2026-07-17_143000");
  });

  it("falls back to a generic name for an empty/dot-only source name", () => {
    const name = buildGridsFolderName(".mp4", new Date("2026-07-17T14:30:00.000Z"));
    expect(name).toBe("video_grids_2026-07-17_143000");
  });
});
