import type { RenderPlan } from "@vid2grid/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFrameTimestamps, readKeyframeTimestamps } from "../src/capture/videoDemuxer";
import { extractFramesWebCodecs } from "../src/capture/webcodecsExtractor";
import { FakeVideoDecoder, stubWebCodecs, type FakeWebCodecs } from "./fakeVideoDecoder";
import { fixtureBytes, sourceFile } from "./sourceFile";

// 10 fps with B-frames, so the edit list starts the media two frames (0.2 s) in.
const bytes = fixtureBytes("keyframes-20s.mp4");
const fixtureFile = () => sourceFile(bytes).file;

let webCodecs: FakeWebCodecs;

beforeEach(() => {
  webCodecs = stubWebCodecs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function capturedAt(times: number[]): Promise<number[]> {
  const plan = {
    frames: times.map((timestampSeconds, frameIndex) => ({ frameIndex, timestampSeconds })),
    cell: { width: 8, height: 8 },
  } as unknown as RenderPlan;
  const images = await extractFramesWebCodecs(fixtureFile(), plan);
  if (!images) throw new Error("The fast path declined the fixture");
  for await (const image of images) image.close();
  return webCodecs.drawn.map((frame) => frame.timestamp / 1e6);
}

describe("a video whose edit list skips the B-frame delay", () => {
  it("captures the first frame at or after each time", async () => {
    expect(await capturedAt([0, 0.1, 3.05, 12.4, 19.9])).toEqual([0, 0.1, 3.1, 12.4, 19.9]);
  });

  it("captures nothing past the last frame", async () => {
    expect(await capturedAt([19.8, 19.95])).toEqual([19.8]);
  });

  it("times frames and keyframes on the same clock", async () => {
    const frames = await readFrameTimestamps(fixtureFile());
    const keyframes = await readKeyframeTimestamps(fixtureFile());
    expect(frames).toHaveLength(200);
    expect([frames?.[0], frames?.at(-1)]).toEqual([0, 19.9]);
    expect(keyframes?.[0]).toBe(0);
    expect(frames).toEqual(expect.arrayContaining(keyframes ?? []));
  });

  it("decodes only the keyframes a keyframe plan asks for", async () => {
    const keyframes = await readKeyframeTimestamps(fixtureFile());
    expect(keyframes).toEqual(Array.from({ length: 20 }, (_, second) => second));
    expect(await capturedAt([3, 4, 17])).toEqual([3, 4, 17]);
    expect(FakeVideoDecoder.instances[0]?.decoded).toHaveLength(3);
  });
});
