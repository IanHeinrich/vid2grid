import { describe, expect, it } from "vitest";
import { generateCollages } from "../src/core";
import type { ExtractedFrame } from "../src/extractor";
import type { CollageRequest } from "../src/types";

/**
 * Outside-in tests for core.generateCollages, mirroring tests/test_core.py's
 * approach: the video/frame-extraction boundary is stubbed (via
 * extractFramesImpl) rather than driving a real <video> element, exactly like
 * the Python suite stubs cv2.VideoCapture.
 */

// jest-canvas-mock's drawImage validates its source is a real canvas-like
// element, so stand in with an actual (mocked) HTMLCanvasElement rather than
// a plain object - jsdom doesn't implement ImageBitmap/createImageBitmap.
function fakeBitmap(width: number, height: number): ImageBitmap {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as ImageBitmap;
}

function stubExtractedFrames(count: number, width = 640, height = 480): ExtractedFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i,
    frameIndex: i,
    bitmap: fakeBitmap(width, height),
  }));
}

function baseConfig(overrides: Partial<CollageRequest> = {}): CollageRequest {
  return {
    videoFile: new File([], "dummy.mp4"),
    startTime: 0,
    endTime: 1,
    targetFps: 10,
    framesPerGrid: 4,
    outputResolution: 256,
    jpegQuality: 80,
    ...overrides,
  };
}

describe("generateCollages", () => {
  it("splits extracted frames into ceil(count / framesPerGrid) JPEG sheets", async () => {
    const frames = stubExtractedFrames(10);
    const blobs = await generateCollages(baseConfig(), {
      extractFramesImpl: async () => frames,
    });

    expect(blobs).toHaveLength(3); // ceil(10 / 4)
    for (const blob of blobs) {
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("image/jpeg");
      expect(blob.size).toBeGreaterThan(0);
    }
  });

  it("returns an empty array when no frames are extracted", async () => {
    const blobs = await generateCollages(baseConfig(), {
      extractFramesImpl: async () => [],
    });
    expect(blobs).toEqual([]);
  });

  it("reports extracting then rendering progress phases in order", async () => {
    const frames = stubExtractedFrames(8);
    const phases: string[] = [];

    await generateCollages(baseConfig(), {
      extractFramesImpl: async (_config, onProgress) => {
        onProgress?.(1, 1);
        return frames;
      },
      onProgress: (phase) => {
        if (phases[phases.length - 1] !== phase) phases.push(phase);
      },
    });

    expect(phases).toEqual(["extracting", "rendering"]);
  });
});
