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
  readonly seeks: number[] = [];
  released = false;
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

  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }

  load(): void {
    this.released = this.src === "";
  }

  set currentTime(time: number) {
    this.seeks.push(time);
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
let revokeObjectURL: ReturnType<typeof vi.fn>;

function stubDocument(video: FakeVideo): void {
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
    tag === "video" ? (video as unknown as HTMLElement) : createElement(tag),
  );
}

async function collect(frames: AsyncIterable<ImageBitmap>): Promise<ImageBitmap[]> {
  const images: ImageBitmap[] = [];
  for await (const image of frames) images.push(image);
  return images;
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  bitmaps = [];
  revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL: () => "blob:stub", revokeObjectURL });
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
  it("yields one bitmap per planned frame and leaves them open for the consumer", async () => {
    const video = new FakeVideo(null);
    stubDocument(video);

    const images = await collect(extractFrames(file, planWithFramesAt(1, 2, 3)));

    expect(images).toHaveLength(3);
    for (const bitmap of bitmaps) expect(bitmap.close).not.toHaveBeenCalled();
    expect(video.released).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stub");
  });

  it("stops at frames past the end of the video", async () => {
    stubDocument(new FakeVideo(null));

    const images = await collect(extractFrames(file, planWithFramesAt(1, 20, 30)));

    expect(images).toHaveLength(1);
  });

  it("resumes at the planned frame it is asked to start from", async () => {
    const video = new FakeVideo(null);
    stubDocument(video);

    const images = await collect(extractFrames(file, planWithFramesAt(1, 2, 3, 4), 2));

    expect(images).toHaveLength(2);
    expect(video.seeks).toEqual([3, 4]);
  });

  it("seeks no further ahead than the consumer has pulled", async () => {
    const video = new FakeVideo(null);
    stubDocument(video);
    const frames = extractFrames(file, planWithFramesAt(1, 2, 3, 4));

    await frames.next();
    await settle();

    expect(video.seeks).toEqual([1]);
    expect(bitmaps).toHaveLength(1);
    await frames.return();
  });

  it("releases the video and its URL when the consumer stops early", async () => {
    const video = new FakeVideo(null);
    stubDocument(video);
    const frames = extractFrames(file, planWithFramesAt(1, 2, 3, 4));

    await frames.next();
    await frames.return();

    expect(video.seeks).toEqual([1]);
    expect(video.released).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stub");
  });

  it("rethrows a failed seek after releasing the video, leaving yielded frames open", async () => {
    const video = new FakeVideo(3);
    stubDocument(video);
    const images: ImageBitmap[] = [];

    const consumed = (async () => {
      for await (const image of extractFrames(file, planWithFramesAt(1, 2, 3, 4))) {
        images.push(image);
      }
    })();

    await expect(consumed).rejects.toThrowError("Video seek failed");

    expect(images).toHaveLength(2);
    for (const bitmap of bitmaps) expect(bitmap.close).not.toHaveBeenCalled();
    expect(video.released).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stub");
  });
});
