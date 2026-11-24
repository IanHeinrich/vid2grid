import { describe, expect, it } from "vitest";
import { GUTTER_PX, countGridPackingBlanks } from "@vid2grid/core";
import { overviewOptions } from "../src/video/overview";

const RESOLUTION = 1568;

function geometry(width: number, height: number, outputResolution = RESOLUTION) {
  return { sourceAspect: width / height, outputResolution };
}

function blanksFor(framesPerGrid: number, width: number, height: number): number | null {
  return countGridPackingBlanks(framesPerGrid, { ...geometry(width, height), gutterPx: GUTTER_PX });
}

describe("overviewOptions", () => {
  it.each([
    ["16:9", 1920, 1080],
    ["9:16", 1080, 1920],
    ["4:3", 1440, 1080],
  ])("fills every sheet with no blank cells for %s", (_label, width, height) => {
    const options = overviewOptions(600, 10, geometry(width, height));
    expect(options.framesPerGrid).toBeGreaterThanOrEqual(9);
    expect(options.framesPerGrid).toBeLessThanOrEqual(20);
    expect(blanksFor(options.framesPerGrid, width, height)).toBe(0);
    expect(options.frameCount).toBe(4 * options.framesPerGrid);
  });

  it("picks the largest zero-blank count in the range", () => {
    const { framesPerGrid } = overviewOptions(600, 10, geometry(1920, 1080));
    for (let larger = framesPerGrid + 1; larger <= 20; larger++) {
      expect(blanksFor(larger, 1920, 1080)).not.toBe(0);
    }
  });

  it("keeps half the image cap free for zooms", () => {
    const options = overviewOptions(600, 6, geometry(1920, 1080));
    expect(options.frameCount).toBe(3 * options.framesPerGrid);
  });

  it("uses one full sheet when the model keeps a single image", () => {
    const options = overviewOptions(600, 1, geometry(1920, 1080));
    expect(options.frameCount).toBe(options.framesPerGrid);
  });

  it("gives fewer sheets to a shorter video, about two frames per second", () => {
    const options = overviewOptions(25, 10, geometry(1920, 1080));
    expect(options.frameCount).toBe(2 * options.framesPerGrid);
    expect(options.frameCount).toBeLessThanOrEqual(50);
  });

  it("gives a short clip one sheet that is still full", () => {
    const options = overviewOptions(5, 10, geometry(1920, 1080));
    expect(options.frameCount).toBe(options.framesPerGrid);
    expect(options.framesPerGrid).toBeLessThanOrEqual(10);
    expect(blanksFor(options.framesPerGrid, 1920, 1080)).toBe(0);
  });

  describe.each([1024, 1536, 1568, 2048, 2560])("for a long video at %d px", (resolution) => {
    it.each([
      ["16:9", 1920, 1080],
      ["4:3", 1440, 1080],
      ["9:16", 1080, 1920],
      ["21:9", 2560, 1080],
    ])("gives four sheets of 20 frames for %s", (_label, width, height) => {
      for (const minutes of [30, 120]) {
        expect(overviewOptions(minutes * 60, 10, geometry(width, height, resolution))).toEqual({
          frameCount: 80,
          framesPerGrid: 20,
        });
      }
    });
  });

  it("still keeps half a small image cap free for a long video", () => {
    expect(overviewOptions(1800, 4, geometry(1920, 1080, 2048))).toEqual({
      frameCount: 40,
      framesPerGrid: 20,
    });
  });

  it("fills every sheet of a shorter video even where 20 would leave a blank", () => {
    expect(overviewOptions(600, 10, geometry(1920, 1080, 2048)).framesPerGrid).toBe(18);
  });

  it("never returns fewer than one frame", () => {
    expect(overviewOptions(0.1, 4, geometry(1920, 1080))).toEqual({
      frameCount: 1,
      framesPerGrid: 1,
    });
  });
});
