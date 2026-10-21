import { ChildProcess, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { buildRenderPlan, type CollagePlanRequest, type PortProgress } from "@vid2grid/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { captureFrames } from "../src/capture";
import { probeVideo, readKeyframeTimes } from "../src/probe";
import { fixtureVideo } from "../../core/tests/fixturePaths";

const TINY_MP4 = fixtureVideo("tiny.mp4");

let scratch: string;
// tiny.mp4 re-encoded with a keyframe every 10 frames (1 s), and the same again with a
// 1.4 s container start time.
let gopMp4: string;
let offsetMp4: string;

function encodeCopy(target: string, extraArgs: string[]): void {
  execFileSync(ffmpegPath ?? "ffmpeg", [
    ...["-v", "error", "-y", "-i", TINY_MP4],
    ...["-c:v", "libx264", "-g", "10", "-sc_threshold", "0", ...extraArgs, target],
  ]);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "vid2grid-node-capture-"));
  gopMp4 = join(scratch, "gop.mp4");
  offsetMp4 = join(scratch, "offset.mp4");
  encodeCopy(gopMp4, []);
  encodeCopy(offsetMp4, ["-output_ts_offset", "1.4"]);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function request(overrides: Partial<CollagePlanRequest>): CollagePlanRequest {
  return {
    startSeconds: 0,
    endSeconds: 3,
    targetFps: 4,
    framesPerGrid: 4,
    outputResolution: 512,
    jpegQuality: 85,
    ...overrides,
  };
}

async function capturedTimes(
  path: string,
  overrides: Partial<CollagePlanRequest>,
  claimedKeyframes?: number[],
): Promise<number[]> {
  const keyframes =
    claimedKeyframes ??
    (overrides.keyframeSampling === true ? await readKeyframeTimes(path) : undefined);
  const info = {
    ...(await probeVideo(path)),
    ...(keyframes ? { keyframeTimestampsSeconds: keyframes } : {}),
  };
  const images = await captureFrames(path, buildRenderPlan(request(overrides), info), info);
  return images.map((image) => image.decodedTimestampSeconds);
}

// conformance.test.ts checks the shared fixtures/frames cases. These expected times are
// what Python's capture_frames picked on the same generated file, recorded once by hand.
describe("captureFrames on a container that starts at 1.4 s", () => {
  // Seeking by container time instead would land on the 3.4 s keyframe and fill every
  // planned time with it.
  it("seeks in raw stream time", async () => {
    const times = await capturedTimes(offsetMp4, { startSeconds: 2, targetFps: 4 });
    expect(times).toEqual([2, 2.3, 2.5, 2.8]);
  });

  it("fills the planned times before its first frame with that frame", async () => {
    const times = await capturedTimes(offsetMp4, { targetFps: 4 });
    expect(times).toEqual([1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.5, 1.8, 2, 2.3, 2.5, 2.8]);
  });
});

describe("captureFrames", () => {
  it("returns cell-sized RGBA frames and reports progress", async () => {
    const info = await probeVideo(TINY_MP4);
    const plan = buildRenderPlan(request({ targetFps: 2 }), info);
    const progress: PortProgress[] = [];
    const images = await captureFrames(TINY_MP4, plan, info, (report) => progress.push(report));

    expect(images).toHaveLength(plan.frames.length);
    for (const image of images) {
      expect(image.width).toBe(plan.cell.width);
      expect(image.height).toBe(plan.cell.height);
      expect(image.data).toHaveLength(plan.cell.width * plan.cell.height * 4);
    }
    expect(progress.at(-1)).toEqual({ done: plan.frames.length, total: plan.frames.length });
  });

  // The info claims every planned time is a keyframe, so core's rule picks a keyframe-only
  // decode: 0.5 s then gets the 1 s keyframe, where a full decode would give the 0.5 s frame.
  it("decodes nothing but keyframes when the info makes it a keyframe plan", async () => {
    const times = await capturedTimes(gopMp4, { targetFps: 2 }, [0, 0.5, 1, 1.5, 2, 2.5]);
    expect(times).toEqual([0, 1, 1, 2, 2]);
  });

  it("returns fewer frames when the stream ends before the plan does", async () => {
    const info = { ...(await probeVideo(TINY_MP4)), durationSeconds: 6 };
    const plan = buildRenderPlan(request({ endSeconds: 6 }), info);
    const images = await captureFrames(TINY_MP4, plan, info);
    // tiny.mp4 ends at 2.9 s, so the planned frames from 3.0 s on go unfilled.
    expect(plan.frames).toHaveLength(24);
    expect(images.map((image) => image.decodedTimestampSeconds)).toEqual([
      0, 0.3, 0.5, 0.8, 1, 1.3, 1.5, 1.8, 2, 2.3, 2.5, 2.8,
    ]);
  });

  // keyframes-20s.mp4 takes far longer to decode than the first frame, so a child that
  // was killed exits on a signal rather than with ffmpeg's own exit code.
  it("kills ffmpeg and rejects with the progress callback's error", async () => {
    const video = fixtureVideo("keyframes-20s.mp4");
    const info = await probeVideo(video);
    const plan = buildRenderPlan(request({ endSeconds: 20 }), info);
    const kill = vi.spyOn(ChildProcess.prototype, "kill");
    const failure = new Error("progress sink closed");
    try {
      await expect(
        captureFrames(video, plan, info, () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      const [child] = kill.mock.contexts;
      if (!(child instanceof ChildProcess)) throw new Error("ffmpeg was never killed");
      if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).not.toBeNull();
    } finally {
      kill.mockRestore();
    }
  });

  it("rejects with ffmpeg's error for an unreadable file", async () => {
    const info = await probeVideo(TINY_MP4);
    const plan = buildRenderPlan(request({}), info);
    await expect(captureFrames(join(scratch, "missing.mp4"), plan, info)).rejects.toMatchObject({
      code: "internal",
      message: expect.stringContaining("ffmpeg exited") as unknown,
    });
  });
});
