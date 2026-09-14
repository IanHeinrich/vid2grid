import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPlan } from "@vid2grid/core";
import { extractFramesAuto } from "../src/extraction/frameExtraction";

// Both extractors are the modules under the router, not the router: what is under test
// is which one it settles on.
const { extractFrames, extractFramesWebCodecs } = vi.hoisted(() => ({
  extractFrames: vi.fn<() => Promise<ImageBitmap[]>>(),
  extractFramesWebCodecs: vi.fn<() => Promise<ImageBitmap[] | null>>(),
}));
vi.mock("../src/extraction/extractor", () => ({ extractFrames }));
vi.mock("../src/extraction/webcodecsExtractor", () => ({ extractFramesWebCodecs }));

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
});
