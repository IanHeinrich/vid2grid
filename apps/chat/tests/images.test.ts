import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyFile, downscaleImage } from "../src/attachments/images";

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

describe("downscaleImage", () => {
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
    stubBitmap(4000, 3000);
    stubOffscreenCanvas();
    const result = await downscaleImage(new Blob(["png"]), 1000);
    expect(result).toEqual({ blob: encoded, width: 1000, height: 750 });
    expect(sizes).toEqual([{ width: 1000, height: 750 }]);
    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.85 });
  });

  it("never upscales", async () => {
    stubBitmap(400, 300);
    stubOffscreenCanvas();
    const result = await downscaleImage(new Blob(["png"]), 1000, 0.5);
    expect(result).toMatchObject({ width: 400, height: 300 });
    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.5 });
  });

  it("falls back to a canvas element without OffscreenCanvas", async () => {
    stubBitmap(300, 1200);
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage").mockImplementation(() => undefined);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => callback(encoded));
    const result = await downscaleImage(new Blob(["gif"]), 600);
    expect(result).toEqual({ blob: encoded, width: 150, height: 600 });
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.85);
  });
});
