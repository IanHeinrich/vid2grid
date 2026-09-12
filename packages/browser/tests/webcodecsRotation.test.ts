import { describe, expect, it, vi } from "vitest";
import { drawRotated, rotationFromMatrix } from "../src/extraction/webcodecsExtractor";

// 16.16 fixed-point unit, as stored in the tkhd display matrix.
const FP = 65536;

describe("rotationFromMatrix", () => {
  it("reads the four canonical tkhd display rotations", () => {
    expect(rotationFromMatrix([FP, 0, 0, 0, FP, 0, 0, 0, 1 << 30])).toBe(0);
    expect(rotationFromMatrix([0, FP, 0, -FP, 0, 0, 0, 0, 1 << 30])).toBe(90);
    expect(rotationFromMatrix([-FP, 0, 0, 0, -FP, 0, 0, 0, 1 << 30])).toBe(180);
    expect(rotationFromMatrix([0, -FP, 0, FP, 0, 0, 0, 0, 1 << 30])).toBe(270);
  });

  // The 90-degree matrix above is the one a real phone clip carried: coded 640x352, displayed 352x640.
});

function canvasContext(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = 10;
  canvas.height = 10;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return ctx;
}

// jest-canvas-mock's drawImage rejects anything but a canvas-like source, so a real
// (mocked) canvas element stands in for the frame.
function fakeFrame(width: number, height: number): CanvasImageSource {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as CanvasImageSource;
}

describe("drawRotated", () => {
  it("draws straight into the cell when there is no rotation", () => {
    const ctx = canvasContext();
    const drawImage = vi.spyOn(ctx, "drawImage");
    const rotate = vi.spyOn(ctx, "rotate");

    drawRotated(ctx, fakeFrame(640, 480), 100, 200, 0);

    expect(rotate).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 100, 200);
  });

  it("rotates 90 clockwise and swaps the draw extents to fill a portrait cell", () => {
    const ctx = canvasContext();
    const translate = vi.spyOn(ctx, "translate");
    const rotate = vi.spyOn(ctx, "rotate");
    const drawImage = vi.spyOn(ctx, "drawImage");

    drawRotated(ctx, fakeFrame(640, 352), 100, 200, 90);

    expect(translate).toHaveBeenCalledWith(50, 100);
    expect(rotate).toHaveBeenCalledWith(Math.PI / 2);
    // Extents swapped: (-cellH/2, -cellW/2, cellH, cellW).
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), -100, -50, 200, 100);
  });
});
