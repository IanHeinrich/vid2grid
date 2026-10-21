import { describe, expect, it, vi } from "vitest";
import {
  canvasToJpegBlob,
  DEFAULT_JPEG_QUALITY,
  jpegQualityFraction,
} from "../src/render/canvasJpeg";

function fakeCanvas(blob: Blob | null) {
  const toBlob = vi.fn<HTMLCanvasElement["toBlob"]>((callback) => callback(blob));
  return { canvas: { toBlob } as unknown as HTMLCanvasElement, toBlob };
}

describe("jpegQualityFraction", () => {
  it("scales a percentage to the fraction canvas encoders take", () => {
    expect(jpegQualityFraction(100)).toBe(1);
    expect(jpegQualityFraction(80)).toBe(0.8);
    expect(jpegQualityFraction(1)).toBe(0.01);
  });
});

describe("canvasToJpegBlob", () => {
  it("encodes as JPEG at the requested percentage", async () => {
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const { canvas, toBlob } = fakeCanvas(blob);

    expect(await canvasToJpegBlob(canvas, 55)).toBe(blob);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.55);
  });

  it("uses the default quality when none is given", async () => {
    const { canvas, toBlob } = fakeCanvas(new Blob(["jpeg"]));

    await canvasToJpegBlob(canvas);

    expect(toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      jpegQualityFraction(DEFAULT_JPEG_QUALITY),
    );
  });

  it("rejects when the canvas produces no blob", async () => {
    const { canvas } = fakeCanvas(null);

    await expect(canvasToJpegBlob(canvas)).rejects.toThrowError("Failed to encode JPEG");
  });
});
