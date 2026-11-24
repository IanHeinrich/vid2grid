import { describe, expect, it } from "vitest";
import type { ImageArea } from "../src/types";
import {
  areaArg,
  areaRect,
  areaWithin,
  outputSize,
  shownArea,
  wholeArea,
} from "../src/video/zoomArea";

function area(left: number, top: number, right: number, bottom: number): ImageArea {
  return { left, top, right, bottom };
}

function problem(args: Record<string, unknown>): string {
  const parsed = areaArg(args);
  return "problem" in parsed ? parsed.problem : "";
}

const HD = { width: 1920, height: 1080 };

describe("areaArg", () => {
  it("takes four numbers from 0 to 1000", () => {
    expect(areaArg({ ...area(0, 10.5, 1000, 999) })).toEqual({ value: area(0, 10.5, 1000, 999) });
  });

  it.each([
    ["left", { ...area(-1, 0, 10, 10) }],
    ["bottom", { ...area(0, 0, 10, 1001) }],
    ["top", { left: 0, right: 10, bottom: 10 }],
    ["right", { ...area(0, 0, 10, 10), right: "10" }],
  ])("names %s and the scale when it is missing or outside", (name, args) => {
    expect(problem(args)).toContain(`${name} must be a number in thousandths`);
    expect(problem(args)).toContain("0 to 1000");
  });

  it("refuses an empty or inside out area, saying the scale", () => {
    expect(problem({ ...area(500, 0, 500, 10) })).toContain("left must be less than right");
    expect(problem({ ...area(0, 20, 10, 10) })).toContain("top must be less than bottom");
    expect(problem({ ...area(0, 20, 10, 10) })).toContain("0 to 1000");
  });
});

describe("shownArea", () => {
  it("pads each side by 5% of the area's size", () => {
    expect(shownArea(area(200, 300, 400, 700), HD)).toEqual(area(190, 280, 410, 720));
  });

  it("cuts the padding off at the picture's edges", () => {
    expect(shownArea(area(0, 500, 400, 1000), HD)).toEqual(area(0, 475, 420, 1000));
    expect(shownArea(area(0, 0, 1000, 1000), HD)).toEqual(area(0, 0, 1000, 1000));
  });

  it("grows each side to at least 64 source px around its middle", () => {
    const shown = shownArea(area(500, 500, 501, 501), { width: 1000, height: 640 });
    expect(shown).toEqual(area(468, 450, 533, 551));
    const rect = areaRect(shown, { width: 1000, height: 640 });
    expect(Math.min(rect.width, rect.height)).toBeGreaterThanOrEqual(64);
  });

  it("slides a small area in a corner inside rather than cutting it", () => {
    const size = { width: 1000, height: 1000 };
    expect(shownArea(area(0, 995, 5, 1000), size)).toEqual(area(0, 936, 64, 1000));
  });

  it("shows the whole side of a picture under 64 px", () => {
    expect(shownArea(area(10, 10, 20, 20), { width: 40, height: 640 })).toMatchObject({
      left: 0,
      right: 1000,
    });
  });
});

describe("areas of areas", () => {
  it("widens to whole thousandths without being moved by float noise", () => {
    expect(wholeArea(area(99.6, 100.0000000001, 200.2, 299.9999999999))).toEqual(
      area(99, 100, 201, 300),
    );
  });

  it("maps an area of a zoom onto what the zoom was cropped from", () => {
    expect(areaWithin(area(0, 500, 1000, 1000), area(200, 400, 600, 800))).toEqual(
      area(200, 600, 600, 800),
    );
    expect(areaWithin(area(250, 250, 750, 750), area(0, 0, 1000, 1000))).toEqual(
      area(250, 250, 750, 750),
    );
  });

  it("turns an area into whole pixels of the picture", () => {
    expect(areaRect(area(250, 500, 500, 1000), HD)).toEqual({
      x: 480,
      y: 540,
      width: 480,
      height: 540,
    });
  });
});

describe("outputSize", () => {
  it("shrinks a crop to the resolution", () => {
    expect(outputSize({ width: 3840, height: 2160 }, 1536)).toEqual({ width: 1536, height: 864 });
  });

  it("leaves a crop between 1024 and the resolution alone", () => {
    expect(outputSize({ width: 1200, height: 300 }, 1536)).toEqual({ width: 1200, height: 300 });
  });

  it("enlarges a small crop to 1024, or to a smaller resolution", () => {
    expect(outputSize({ width: 256, height: 512 }, 1536)).toEqual({ width: 512, height: 1024 });
    expect(outputSize({ width: 256, height: 512 }, 768)).toEqual({ width: 384, height: 768 });
  });

  it("enlarges at most four times", () => {
    expect(outputSize({ width: 100, height: 64 }, 1536)).toEqual({ width: 400, height: 256 });
  });
});
