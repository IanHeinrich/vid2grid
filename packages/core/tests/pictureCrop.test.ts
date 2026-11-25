import { describe, expect, it } from "vitest";
import { plannedCrop } from "../src/plan/pictureCrop";

const HD = { width: 1920, height: 1080 };

describe("plannedCrop", () => {
  it("turns thousandths into pixels of the displayed picture", () => {
    expect(plannedCrop({ left: 100, top: 200, right: 400, bottom: 500 }, HD)).toEqual({
      x: 192,
      y: 216,
      width: 576,
      height: 324,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
  });

  it("covers the whole picture from 0 to 1000", () => {
    expect(plannedCrop({ left: 0, top: 0, right: 1000, bottom: 1000 }, HD)).toMatchObject({
      x: 0,
      y: 0,
      ...HD,
    });
  });

  it("rounds each side to its nearest pixel, so neighbouring areas meet", () => {
    const size = { width: 101, height: 10 };
    const first = plannedCrop({ left: 0, top: 0, right: 333, bottom: 1000 }, size);
    const second = plannedCrop({ left: 333, top: 0, right: 1000, bottom: 1000 }, size);
    expect(first).toMatchObject({ x: 0, width: 34 });
    expect(second).toMatchObject({ x: 34, width: 67 });
  });

  it.each([
    [{ left: 0, top: 0, right: 0.1, bottom: 0.1 }, 0, 0],
    [{ left: 500, top: 500, right: 500.1, bottom: 500.1 }, 50, 5],
    [{ left: 999.9, top: 999.9, right: 1000, bottom: 1000 }, 99, 9],
  ])("keeps %o to one pixel inside the picture", (area, x, y) => {
    expect(plannedCrop(area, { width: 100, height: 10 })).toMatchObject({
      x,
      y,
      width: 1,
      height: 1,
    });
  });
});
