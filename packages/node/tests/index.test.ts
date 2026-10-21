import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { generateCollages, type CollagePlanRequest, type VideoInfo } from "@vid2grid/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodePorts, renderVideo } from "../src/index";
import { fixtureVideo } from "../../core/tests/fixturePaths";

const TINY_MP4 = fixtureVideo("tiny.mp4");

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "vid2grid-node-render-"));
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("renderVideo", () => {
  it("writes one JPEG per planned sheet at the planned size", async () => {
    const result = await renderVideo(
      TINY_MP4,
      {
        startSeconds: 0,
        endSeconds: 3,
        targetFps: 4,
        framesPerGrid: 4,
        outputResolution: 512,
        jpegQuality: 85,
      },
      outDir,
    );

    expect(result.sheetPaths.map((path) => basename(path))).toEqual(
      result.plan.sheets.map((sheet) => sheet.fileName),
    );
    expect(result.sheetPaths.map((path) => basename(path))).toEqual([
      "grid_0001.jpg",
      "grid_0002.jpg",
      "grid_0003.jpg",
    ]);
    for (const path of result.sheetPaths) {
      const image = await loadImage(path);
      expect([image.width, image.height]).toEqual([512, 512]);
    }
    expect(result.timings).toMatchObject({ frameCount: 12, sheetCount: 3 });
    expect(result.warnings).toEqual([]);
  });

  it("warns rather than fails when a transcript is asked for", async () => {
    const result = await renderVideo(
      TINY_MP4,
      {
        startSeconds: 0,
        endSeconds: 1,
        targetFps: 2,
        framesPerGrid: 4,
        outputResolution: 256,
        jpegQuality: 85,
        transcript: { scope: "combined" },
      },
      join(outDir, "transcript"),
    );

    expect(result.sheetPaths).toHaveLength(1);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["no_transcription_port"]);
  });
});

// tiny.mp4's only real keyframe is at 0 s, so claiming one at 0.5 s shows which decode
// ran: a keyframe-only decode never reaches a frame for 0.5 s, a full decode would.
const KEYFRAME_REQUEST: CollagePlanRequest = {
  startSeconds: 0,
  endSeconds: 3,
  targetFps: 1,
  keyframeSampling: true,
  framesPerGrid: 4,
  outputResolution: 256,
  jpegQuality: 85,
};
const CLAIMED_KEYFRAMES: VideoInfo = {
  durationSeconds: 3,
  width: 160,
  height: 120,
  keyframeTimestampsSeconds: [0, 0.5],
};

describe("keyframes a caller supplies", () => {
  it("make renderVideo decode only keyframes", async () => {
    const result = await renderVideo(TINY_MP4, KEYFRAME_REQUEST, join(outDir, "supplied"), {
      videoInfo: CLAIMED_KEYFRAMES,
    });

    expect(result.plan.frames.map((frame) => frame.timestampSeconds)).toEqual([0, 0.5]);
    expect(result.timings.frameCount).toBe(1);
  });

  it("do the same through generateCollages with the bare ports", async () => {
    let frameCount: number | undefined;
    const { sheets } = await generateCollages(TINY_MP4, KEYFRAME_REQUEST, createNodePorts(), {
      videoInfo: CLAIMED_KEYFRAMES,
      onTiming: (timings) => (frameCount = timings.frameCount),
    });

    expect(frameCount).toBe(1);
    expect(sheets[0]?.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });
});
