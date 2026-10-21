import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPlan } from "@vid2grid/core";
import { extractFrames } from "../src/capture/extractor";

type Listener = () => void;

class FakeVideo {
  preload = "";
  muted = false;
  playsInline = false;
  src = "";
  duration = 10;
  error: MediaError | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly failSeekAt: number | null) {}

  addEventListener(event: string, listener: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
    if (event === "loadedmetadata") queueMicrotask(() => this.emit("loadedmetadata"));
  }

  removeEventListener(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  set currentTime(time: number) {
    queueMicrotask(() => this.emit(time === this.failSeekAt ? "error" : "seeked"));
  }

  private emit(event: string): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }
}

const planWithFramesAt = (...timestamps: number[]) =>
  ({
    cell: { width: 8, height: 8 },
    frames: timestamps.map((timestampSeconds, frameIndex) => ({ frameIndex, timestampSeconds })),
  }) as unknown as RenderPlan;

const file = new File([new Uint8Array([0])], "clip.webm", { type: "video/webm" });

let bitmaps: { close: ReturnType<typeof vi.fn> }[];

function stubDocument(video: FakeVideo): void {
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
    tag === "video" ? (video as unknown as HTMLElement) : createElement(tag),
  );
}

beforeEach(() => {
  bitmaps = [];
  Object.assign(URL, { createObjectURL: () => "blob:stub", revokeObjectURL: () => {} });
  vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage").mockImplementation(() => {});
  vi.stubGlobal("createImageBitmap", () => {
    const bitmap = { close: vi.fn() };
    bitmaps.push(bitmap);
    return Promise.resolve(bitmap);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
});

describe("extractFrames", () => {
  it("captures one bitmap per planned frame and reports progress", async () => {
    stubDocument(new FakeVideo(null));
    const progress: [number, number][] = [];

    const images = await extractFrames(file, planWithFramesAt(1, 2, 3), ({ done, total }) =>
      progress.push([done, total]),
    );

    expect(images).toHaveLength(3);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    for (const bitmap of bitmaps) expect(bitmap.close).not.toHaveBeenCalled();
  });

  it("stops at frames past the end of the video", async () => {
    stubDocument(new FakeVideo(null));

    const images = await extractFrames(file, planWithFramesAt(1, 20, 30));

    expect(images).toHaveLength(1);
  });

  it("closes the bitmaps already captured when a later seek fails", async () => {
    stubDocument(new FakeVideo(3));

    await expect(extractFrames(file, planWithFramesAt(1, 2, 3, 4))).rejects.toThrowError(
      "Video seek failed",
    );

    expect(bitmaps).toHaveLength(2);
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});
