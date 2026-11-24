import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ORIGINAL_LONGEST_EDGE_PX,
  ORIGINAL_QUALITY,
  classifyFile,
  downscaleUpload,
} from "../src/attachments/images";

function fileOf(name: string, type = ""): File {
  return new File(["x"], name, { type });
}

describe("classifyFile", () => {
  it("goes by MIME type first", () => {
    expect(classifyFile(fileOf("a.bin", "video/mp4"))).toBe("video");
    expect(classifyFile(fileOf("a.bin", "image/png"))).toBe("image");
    expect(classifyFile(fileOf("a.pdf", "application/pdf"))).toBe("unsupported");
  });

  it("falls back to the extension", () => {
    for (const name of ["a.mp4", "a.WEBM", "a.mov", "a.mkv", "a.m4v"]) {
      expect(classifyFile(fileOf(name))).toBe("video");
    }
    for (const name of ["a.jpg", "a.jpeg", "a.PNG", "a.webp", "a.gif", "a.bmp", "a.avif"]) {
      expect(classifyFile(fileOf(name))).toBe("image");
    }
  });

  it("rejects everything else", () => {
    expect(classifyFile(fileOf("notes.txt"))).toBe("unsupported");
    expect(classifyFile(fileOf("noextension"))).toBe("unsupported");
  });
});

describe("downscaleUpload", () => {
  const encoded = new Blob(["jpeg"], { type: "image/jpeg" });
  const sizes: { width: number; height: number }[] = [];
  const convertToBlob = vi.fn(() => Promise.resolve(encoded));

  function stubBitmap(width: number, height: number): void {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve({ width, height, close: vi.fn() })),
    );
  }

  function stubOffscreenCanvas(): void {
    class FakeOffscreenCanvas {
      constructor(width: number, height: number) {
        sizes.push({ width, height });
      }
      getContext() {
        return { fillRect: vi.fn(), drawImage: vi.fn() };
      }
      convertToBlob = convertToBlob;
    }
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sizes.length = 0;
    convertToBlob.mockClear();
  });

  it("scales the longest edge down and keeps the aspect ratio", async () => {
    stubBitmap(2000, 1500);
    stubOffscreenCanvas();
    const { sent } = await downscaleUpload(new Blob(["png"]), 1000);
    expect(sent).toEqual({ blob: encoded, width: 1000, height: 750 });
    expect(sizes[0]).toEqual({ width: 1000, height: 750 });
    expect(convertToBlob).toHaveBeenNthCalledWith(1, { type: "image/jpeg", quality: 0.85 });
  });

  it("also returns a larger copy when the picture is bigger than the sent size", async () => {
    stubBitmap(8000, 6000);
    stubOffscreenCanvas();
    const result = await downscaleUpload(new Blob(["png"]), 1000);
    expect(result.original).toEqual({
      blob: encoded,
      width: ORIGINAL_LONGEST_EDGE_PX,
      height: 3072,
    });
    expect(sizes).toEqual([
      { width: 1000, height: 750 },
      { width: ORIGINAL_LONGEST_EDGE_PX, height: 3072 },
    ]);
    expect(convertToBlob).toHaveBeenNthCalledWith(2, {
      type: "image/jpeg",
      quality: ORIGINAL_QUALITY,
    });
  });

  it("keeps a picture between the two sizes at its own size", async () => {
    stubBitmap(2000, 1000);
    stubOffscreenCanvas();
    const result = await downscaleUpload(new Blob(["png"]), 1000);
    expect(result.original).toMatchObject({ width: 2000, height: 1000 });
  });

  it("returns no larger copy when the picture already fits", async () => {
    stubBitmap(400, 300);
    stubOffscreenCanvas();
    const result = await downscaleUpload(new Blob(["png"]), 1000);
    expect(result).toEqual({ sent: { blob: encoded, width: 400, height: 300 } });
    expect(convertToBlob).toHaveBeenCalledTimes(1);
  });

  it("still returns the sent picture when the larger copy cannot be encoded", async () => {
    stubBitmap(4000, 3000);
    stubOffscreenCanvas();
    convertToBlob.mockResolvedValueOnce(encoded).mockRejectedValueOnce(new Error("too big"));
    const result = await downscaleUpload(new Blob(["png"]), 1000);
    expect(result).toEqual({ sent: { blob: encoded, width: 1000, height: 750 } });
  });

  it("falls back to a canvas element without OffscreenCanvas", async () => {
    stubBitmap(300, 1200);
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage").mockImplementation(() => undefined);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => callback(encoded));
    const { sent } = await downscaleUpload(new Blob(["gif"]), 1200);
    expect(sent).toEqual({ blob: encoded, width: 300, height: 1200 });
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.85);
  });
});
