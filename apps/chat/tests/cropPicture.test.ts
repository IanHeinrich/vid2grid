import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPictures } from "../src/video/cropPicture";

const picture = { width: 100, height: 100 } as ImageBitmap;
const AREA = { x: 10, y: 20, width: 30, height: 40 };
const OUTPUT = { width: 120, height: 160 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("crop", () => {
  it("draws the area at the output size with high quality smoothing", async () => {
    const context = {
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    };
    const convertToBlob = vi.fn(() => Promise.resolve(new Blob(["jpeg"])));
    const sizes: number[][] = [];
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(width: number, height: number) {
          sizes.push([width, height]);
        }
        getContext = () => context;
        convertToBlob = convertToBlob;
      },
    );
    await browserPictures.crop(picture, AREA, OUTPUT);
    expect(sizes).toEqual([[120, 160]]);
    expect(context).toMatchObject({ imageSmoothingEnabled: true, imageSmoothingQuality: "high" });
    expect(context.drawImage).toHaveBeenCalledWith(picture, 10, 20, 30, 40, 0, 0, 120, 160);
    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.9 });
  });

  it("fails without a canvas context", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(browserPictures.crop(picture, AREA, OUTPUT)).rejects.toThrow("Canvas 2D");
  });
});
