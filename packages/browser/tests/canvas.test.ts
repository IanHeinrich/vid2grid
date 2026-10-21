import { afterEach, describe, expect, it, vi } from "vitest";
import { create2dCanvas, create2dOffscreenCanvas, createCellCanvas } from "../src/shared/canvas";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("create2dCanvas", () => {
  it("returns a canvas of the requested size with its 2D context", () => {
    const { canvas, ctx } = create2dCanvas(30, 20);

    expect(canvas.width).toBe(30);
    expect(canvas.height).toBe(20);
    expect(ctx.canvas).toBe(canvas);
  });

  it("throws when the browser gives no 2D context", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    expect(() => create2dCanvas(1, 1)).toThrowError("Canvas 2D context unavailable");
  });
});

describe("createCellCanvas", () => {
  it("turns on high-quality smoothing", () => {
    const { ctx } = createCellCanvas(8, 8);

    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe("high");
  });
});

describe("create2dOffscreenCanvas", () => {
  it("returns an offscreen canvas of the requested size with its 2D context", () => {
    const ctx = {};
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext = () => ctx;
        constructor(
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );

    const result = create2dOffscreenCanvas(30, 20);

    expect(result.ctx).toBe(ctx);
    expect(result.canvas.width).toBe(30);
    expect(result.canvas.height).toBe(20);
  });

  it("throws when the offscreen canvas gives no 2D context", () => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext = () => null;
      },
    );

    expect(() => create2dOffscreenCanvas(1, 1)).toThrowError(
      "OffscreenCanvas 2D context unavailable",
    );
  });
});
