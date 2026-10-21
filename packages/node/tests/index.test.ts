import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { generateCollages, type CollagePlanRequest, type VideoInfo } from "@vid2grid/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as Capture from "../src/capture";
import { createNodePorts, renderVideo } from "../src/index";
import type * as Render from "../src/render";
import { SHEET_ENCODE_CONCURRENCY } from "../src/render";
import { fixtureVideo } from "../../core/tests/fixturePaths";

const TINY_MP4 = fixtureVideo("tiny.mp4");

// Frames capture has yielded that no finished encode has taken yet.
const alive = vi.hoisted(() => ({ now: 0, peak: 0, onYield: (): void => undefined }));
const failing = vi.hoisted(() => ({ sheet: undefined as string | undefined }));

vi.mock("../src/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof Capture>();
  async function* captureFrames(...args: Parameters<typeof actual.captureFrames>) {
    for await (const frame of actual.captureFrames(...args)) {
      alive.now++;
      alive.peak = Math.max(alive.peak, alive.now);
      alive.onYield();
      yield frame;
    }
  }
  return { ...actual, captureFrames };
});

vi.mock("../src/render", async (importOriginal) => {
  const actual = await importOriginal<typeof Render>();
  async function encodeSheet(...args: Parameters<typeof actual.encodeSheet>) {
    const [, job] = args;
    if (job.sheet.fileName === failing.sheet) throw new Error(`encode failed on ${failing.sheet}`);
    const jpeg = await actual.encodeSheet(...args);
    alive.now -= job.images.filter((image) => image !== undefined).length;
    return jpeg;
  }
  return { ...actual, encodeSheet };
});

let outDir: string;

function filesIn(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

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

describe("renderVideo with nothing captured", () => {
  // The info claims 10 s, so the plan asks for times past tiny.mp4's last frame at 2.9 s.
  it("leaves no folder when capture yields no frames", async () => {
    const dir = join(outDir, "empty");
    const result = await renderVideo(
      TINY_MP4,
      {
        startSeconds: 5,
        endSeconds: 6,
        targetFps: 2,
        framesPerGrid: 4,
        outputResolution: 256,
        jpegQuality: 85,
      },
      dir,
      { videoInfo: { durationSeconds: 10, width: 160, height: 120 } },
    );

    expect(result.plan.frames).not.toHaveLength(0);
    expect(result.sheetPaths).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});

const FAILING_SHEET = 6;

// keyframes-20s.mp4 at 2 fps plans 40 frames, 10 sheets of 4.
describe("renderVideo failing at a sheet", () => {
  it("keeps the sheets written before the failure and rejects", async () => {
    const dir = join(outDir, "failed");
    const sheetName = (n: number) => `grid_${String(n).padStart(4, "0")}.jpg`;
    failing.sheet = sheetName(FAILING_SHEET);
    try {
      await expect(
        renderVideo(
          fixtureVideo("keyframes-20s.mp4"),
          {
            startSeconds: 0,
            endSeconds: 20,
            targetFps: 2,
            framesPerGrid: 4,
            outputResolution: 256,
            jpegQuality: 85,
          },
          dir,
        ),
      ).rejects.toThrow(`encode failed on ${sheetName(FAILING_SHEET)}`);
    } finally {
      failing.sheet = undefined;
    }

    // The sheet just before can still be encoding when the failure lands, so it may be
    // dropped; every one before that was already written.
    const written = filesIn(dir);
    const earlier = Array.from({ length: FAILING_SHEET - 1 }, (_, i) => sheetName(i + 1));
    expect(written).toEqual(earlier.slice(0, written.length));
    expect(written.length).toBeGreaterThanOrEqual(FAILING_SHEET - SHEET_ENCODE_CONCURRENCY);
  });
});

// keyframes-20s.mp4 at 10 fps plans 200 frames, 23 sheets of 9.
describe("renderVideo memory", () => {
  it("holds only the sheets in flight and writes each sheet as it arrives", async () => {
    const dir = join(outDir, "streamed");
    const framesPerGrid = 9;
    const onDiskAtYield: number[] = [];
    alive.now = 0;
    alive.peak = 0;
    alive.onYield = () => {
      onDiskAtYield.push(filesIn(dir).length);
    };
    try {
      const result = await renderVideo(
        fixtureVideo("keyframes-20s.mp4"),
        {
          startSeconds: 0,
          endSeconds: 20,
          targetFps: 10,
          framesPerGrid,
          outputResolution: 512,
          jpegQuality: 85,
        },
        dir,
      );

      expect(result.sheetPaths).toHaveLength(23);
      expect(onDiskAtYield).toHaveLength(200);
      expect(alive.now).toBe(0);
      expect(alive.peak).toBeLessThanOrEqual((SHEET_ENCODE_CONCURRENCY + 1) * framesPerGrid);
      expect(onDiskAtYield[0]).toBe(0);
      expect(onDiskAtYield.at(-1)).toBeGreaterThanOrEqual(23 - (SHEET_ENCODE_CONCURRENCY + 1));
    } finally {
      alive.onYield = () => undefined;
    }
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
