import type { FrameCapturePort, VideoInfo } from "@vid2grid/core";
import { describe, expect, it, vi } from "vitest";
import { captureFrame, framePlan, MAX_CAPTURE_PX } from "../src/video/captureFrame";
import { exactTimes, latestFrameTime } from "../src/video/exactTimes";

const file = new File(["x"], "clip.mp4");

function info(width: number, height: number): VideoInfo {
  return { durationSeconds: 60, width, height };
}

function bitmap() {
  return { width: 8, height: 8, close: vi.fn() };
}

function port(
  images: ReturnType<typeof bitmap>[],
  error?: Error,
): FrameCapturePort<File, ImageBitmap> {
  return {
    async *capture() {
      await Promise.resolve();
      yield* images;
      if (error) throw error;
    },
  };
}

describe("framePlan", () => {
  it.each([
    [1920, 1080],
    [1080, 1920],
    [640, 360],
    [720, 720],
    [854, 480],
  ])("plans one frame at the source size for %ix%i", (width, height) => {
    const plan = framePlan(info(width, height), 12.345);
    expect(plan.cell).toEqual({ width, height });
    expect(plan.frames).toEqual([{ frameIndex: 0, timestampSeconds: 12.345 }]);
  });

  it("caps the canvas at 4096", () => {
    const plan = framePlan(info(7680, 4320), 1);
    expect(plan.canvas.width).toBe(MAX_CAPTURE_PX);
    expect(plan.cell.width).toBeLessThanOrEqual(MAX_CAPTURE_PX);
  });

  it("takes the first and the last moment a frame can be asked for", () => {
    expect(framePlan(info(640, 360), 0).frames).toHaveLength(1);
    expect(framePlan(info(640, 360), latestFrameTime(60)).frames).toHaveLength(1);
  });
});

describe("exactTimes", () => {
  it("asks for the times on one full sheet", () => {
    expect(exactTimes([3, 9.5])).toEqual({ timestampsSeconds: [3, 9.5], framesPerGrid: 2 });
  });
});

describe("captureFrame", () => {
  it("returns the first image and closes the rest", async () => {
    const [first, second] = [bitmap(), bitmap()];
    expect(await captureFrame(file, info(640, 360), 5, port([first, second]))).toBe(first);
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("closes the image when the capture then fails", async () => {
    const first = bitmap();
    const failing = port([first], new Error("decoder died"));
    await expect(captureFrame(file, info(640, 360), 5, failing)).rejects.toThrow("decoder died");
    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when no frame is there", async () => {
    expect(await captureFrame(file, info(640, 360), 5, port([]))).toBeUndefined();
  });
});
