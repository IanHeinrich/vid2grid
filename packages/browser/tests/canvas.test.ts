import { afterEach, describe, expect, it, vi } from "vitest";
import {
  create2dCanvas,
  create2dOffscreenCanvas,
  createCellCanvas,
  createFrameCanvas,
} from "../src/shared/canvas";

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

describe("createFrameCanvas", () => {
  const CELL = { width: 600, height: 200 };

  function stubImageBitmap() {
    const create = vi.fn<(canvas: HTMLCanvasElement) => Promise<unknown>>(() =>
      Promise.resolve({}),
    );
    vi.stubGlobal("createImageBitmap", create);
    return create;
  }

  it("captures the cell the frame was drawn over", async () => {
    const create = stubImageBitmap();
    const { canvas, capture } = createFrameCanvas(CELL);

    await capture();

    expect([canvas.width, canvas.height]).toEqual([600, 200]);
    expect(create).toHaveBeenCalledWith(canvas);
  });

  it("with a crop, scales just that part of the whole picture to the cell", async () => {
    const create = stubImageBitmap();
    const drawImage = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    const crop = { x: 30, y: 10, width: 60, height: 20, sourceWidth: 120, sourceHeight: 80 };
    const { canvas, capture } = createFrameCanvas(CELL, crop);

    await capture();

    expect([canvas.width, canvas.height]).toEqual([120, 80]);
    expect(drawImage).toHaveBeenCalledWith(canvas, 30, 10, 60, 20, 0, 0, 600, 200);
    const [captured] = create.mock.calls[0] ?? [];
    expect([captured?.width, captured?.height]).toEqual([600, 200]);
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
