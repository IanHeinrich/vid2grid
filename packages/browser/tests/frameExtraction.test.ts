import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPlan } from "@vid2grid/core";
import { extractFramesAuto } from "../src/capture/frameExtraction";

type Frames = AsyncGenerator<ImageBitmap, void, undefined>;

// Both extractors are the modules under the router, not the router: what is under test
// is which one it settles on, and where.
const { extractFrames, extractFramesWebCodecs } = vi.hoisted(() => ({
  extractFrames: vi.fn<(file: File, plan: RenderPlan, fromFrame?: number) => Frames>(),
  extractFramesWebCodecs: vi.fn<() => Promise<Frames | null>>(),
}));
vi.mock("../src/capture/extractor", () => ({ extractFrames }));
vi.mock("../src/capture/webcodecsExtractor", () => ({ extractFramesWebCodecs }));

const PLAN = { frames: [], cell: { width: 8, height: 8 } } as unknown as RenderPlan;

const image = (label: string) => label as unknown as ImageBitmap;

// eslint-disable-next-line @typescript-eslint/require-await
async function* framesOf(labels: string[], failure?: Error): Frames {
  for (const label of labels) yield image(label);
  if (failure) throw failure;
}

async function collect(frames: AsyncIterable<ImageBitmap>): Promise<ImageBitmap[]> {
  const images: ImageBitmap[] = [];
  for await (const frame of frames) images.push(frame);
  return images;
}

const videoFile = (name: string, type: string) => new File([new Uint8Array([0])], name, { type });
const mp4 = videoFile("clip.mp4", "video/mp4");

beforeEach(() => {
  // jsdom has no VideoDecoder, and without one the router never offers WebCodecs the file.
  vi.stubGlobal("VideoDecoder", class {});
  extractFrames.mockReset();
  extractFrames.mockImplementation(() => framesOf(["seek"]));
  extractFramesWebCodecs.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractFramesAuto", () => {
  it("keeps the WebCodecs frames when that path produces them", async () => {
    extractFramesWebCodecs.mockResolvedValue(framesOf(["webcodecs"]));

    expect(await collect(extractFramesAuto(mp4, PLAN))).toEqual([image("webcodecs")]);
    expect(extractFrames).not.toHaveBeenCalled();
  });

  it("falls back to the seek extractor when WebCodecs declines the file", async () => {
    extractFramesWebCodecs.mockResolvedValue(null);

    expect(await collect(extractFramesAuto(mp4, PLAN))).toEqual([image("seek")]);
    expect(extractFrames).toHaveBeenCalledWith(mp4, PLAN, 0);
  });

  it("falls back to the seek extractor when WebCodecs throws", async () => {
    extractFramesWebCodecs.mockRejectedValue(new Error("undecodable"));

    expect(await collect(extractFramesAuto(mp4, PLAN))).toEqual([image("seek")]);
    expect(extractFrames).toHaveBeenCalledWith(mp4, PLAN, 0);
  });

  it("resumes the seek extractor at the first frame WebCodecs failed to yield", async () => {
    extractFramesWebCodecs.mockResolvedValue(framesOf(["wc0", "wc1"], new Error("decode failed")));
    extractFrames.mockImplementation(() => framesOf(["seek2", "seek3"]));

    expect(await collect(extractFramesAuto(mp4, PLAN))).toEqual(
      ["wc0", "wc1", "seek2", "seek3"].map(image),
    );
    expect(extractFrames).toHaveBeenCalledWith(mp4, PLAN, 2);
  });

  it("skips WebCodecs entirely for a container it cannot demux", async () => {
    expect(await collect(extractFramesAuto(videoFile("clip.webm", "video/webm"), PLAN))).toEqual([
      image("seek"),
    ]);
    expect(extractFramesWebCodecs).not.toHaveBeenCalled();
  });

  it("reports both failures when the fallback fails after WebCodecs did", async () => {
    const webCodecsFailure = new Error("undecodable");
    const seekFailure = new Error("Video seek failed");
    extractFramesWebCodecs.mockRejectedValue(webCodecsFailure);
    extractFrames.mockImplementation(() => framesOf([], seekFailure));

    const failure = await collect(extractFramesAuto(mp4, PLAN)).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([webCodecsFailure, seekFailure]);
    expect((failure as AggregateError).cause).toBe(seekFailure);
    expect((failure as AggregateError).message).toMatch(/Video seek failed.*undecodable/);
  });

  it("rethrows the seek failure untouched when WebCodecs was never involved", async () => {
    const seekFailure = new Error("Video seek failed");
    extractFrames.mockImplementation(() => framesOf([], seekFailure));

    await expect(
      collect(extractFramesAuto(videoFile("clip.webm", "video/webm"), PLAN)),
    ).rejects.toBe(seekFailure);
  });
});
