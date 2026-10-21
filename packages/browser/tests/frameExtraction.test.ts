import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPlan } from "@vid2grid/core";
import { extractFramesAuto } from "../src/capture/frameExtraction";

// Both extractors are the modules under the router, not the router: what is under test
// is which one it settles on.
const { extractFrames, extractFramesWebCodecs } = vi.hoisted(() => ({
  extractFrames: vi.fn<() => Promise<ImageBitmap[]>>(),
  extractFramesWebCodecs: vi.fn<() => Promise<ImageBitmap[] | null>>(),
}));
vi.mock("../src/capture/extractor", () => ({ extractFrames }));
vi.mock("../src/capture/webcodecsExtractor", () => ({ extractFramesWebCodecs }));

const PLAN = { frames: [], cell: { width: 8, height: 8 } } as unknown as RenderPlan;
const seekImages = ["seek"] as unknown as ImageBitmap[];
const webCodecsImages = ["webcodecs"] as unknown as ImageBitmap[];

const videoFile = (name: string, type: string) => new File([new Uint8Array([0])], name, { type });

beforeEach(() => {
  // jsdom has no VideoDecoder, and without one the router never offers WebCodecs the file.
  vi.stubGlobal("VideoDecoder", class {});
  extractFrames.mockReset();
  extractFrames.mockResolvedValue(seekImages);
  extractFramesWebCodecs.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractFramesAuto", () => {
  it("keeps the WebCodecs frames when that path produces them", async () => {
    extractFramesWebCodecs.mockResolvedValue(webCodecsImages);

    expect(await extractFramesAuto(videoFile("clip.mp4", "video/mp4"), PLAN)).toBe(webCodecsImages);
    expect(extractFrames).not.toHaveBeenCalled();
  });

  it("falls back to the seek extractor when WebCodecs declines the file", async () => {
    extractFramesWebCodecs.mockResolvedValue(null);

    expect(await extractFramesAuto(videoFile("clip.mp4", "video/mp4"), PLAN)).toBe(seekImages);
  });

  it("falls back to the seek extractor when WebCodecs throws", async () => {
    extractFramesWebCodecs.mockRejectedValue(new Error("undecodable"));

    expect(await extractFramesAuto(videoFile("clip.mp4", "video/mp4"), PLAN)).toBe(seekImages);
  });

  it("skips WebCodecs entirely for a container it cannot demux", async () => {
    expect(await extractFramesAuto(videoFile("clip.webm", "video/webm"), PLAN)).toBe(seekImages);
    expect(extractFramesWebCodecs).not.toHaveBeenCalled();
  });

  it("reports both failures when the fallback fails after WebCodecs did", async () => {
    const webCodecsFailure = new Error("undecodable");
    const seekFailure = new Error("Video seek failed");
    extractFramesWebCodecs.mockRejectedValue(webCodecsFailure);
    extractFrames.mockRejectedValue(seekFailure);

    const failure = await extractFramesAuto(videoFile("clip.mp4", "video/mp4"), PLAN).catch(
      (err: unknown) => err,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([webCodecsFailure, seekFailure]);
    expect((failure as AggregateError).cause).toBe(seekFailure);
    expect((failure as AggregateError).message).toMatch(/Video seek failed.*undecodable/);
  });

  it("rethrows the seek failure untouched when WebCodecs was never involved", async () => {
    const seekFailure = new Error("Video seek failed");
    extractFrames.mockRejectedValue(seekFailure);

    await expect(extractFramesAuto(videoFile("clip.webm", "video/webm"), PLAN)).rejects.toBe(
      seekFailure,
    );
  });
});
