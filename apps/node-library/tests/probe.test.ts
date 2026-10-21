import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Vid2GridError } from "@vid2grid/core";
import { probeVideo, readKeyframeTimes } from "../src/probe";
import { fixtureVideo } from "../../../packages/core/tests/fixturePaths";

const TINY_MP4 = fixtureVideo("tiny.mp4");

let scratch: string;

function ffmpeg(args: string[]): void {
  execFileSync(ffmpegPath ?? "ffmpeg", ["-v", "error", "-y", ...args]);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "vid2grid-node-probe-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("probeVideo", () => {
  it("reads tiny.mp4's duration and size", async () => {
    expect(await probeVideo(TINY_MP4)).toEqual({ durationSeconds: 3, width: 160, height: 120 });
  });

  // Expected sizes are what Python's probe reports for the same two files.
  it("applies a display matrix rotation", async () => {
    const rotated = join(scratch, "rotated.mp4");
    ffmpeg(["-display_rotation", "90", "-i", TINY_MP4, "-c", "copy", rotated]);
    expect(await probeVideo(rotated)).toMatchObject({ width: 120, height: 160 });
  });

  it("stretches the width by the sample aspect ratio", async () => {
    const anamorphic = join(scratch, "anamorphic.mp4");
    ffmpeg([
      "-i",
      TINY_MP4,
      "-c",
      "copy",
      "-bsf:v",
      "h264_metadata=sample_aspect_ratio=2/1",
      anamorphic,
    ]);
    expect(await probeVideo(anamorphic)).toMatchObject({ width: 320, height: 120 });
  });

  it("rejects a file with no video stream", async () => {
    const audioOnly = join(scratch, "audio.m4a");
    ffmpeg(["-f", "lavfi", "-i", "anullsrc", "-t", "0.5", audioOnly]);
    await expect(probeVideo(audioOnly)).rejects.toMatchObject({ code: "no_frames" });
  });
});

describe("readKeyframeTimes", () => {
  it("reads tiny.mp4's single keyframe", async () => {
    expect(await readKeyframeTimes(TINY_MP4)).toEqual([0]);
  });

  it("returns ascending times for a stream with several keyframes", async () => {
    const gop = join(scratch, "gop.mp4");
    ffmpeg(["-i", TINY_MP4, "-c:v", "libx264", "-g", "10", "-sc_threshold", "0", gop]);
    expect(await readKeyframeTimes(gop)).toEqual([0, 1, 2]);
  });

  it("resolves undefined when there is no video stream to read", async () => {
    const audioOnly = join(scratch, "audio-keyframes.m4a");
    ffmpeg(["-f", "lavfi", "-i", "anullsrc", "-t", "0.5", audioOnly]);
    expect(await readKeyframeTimes(audioOnly)).toBeUndefined();
  });

  it("rejects with ffprobe's error as the cause when the file cannot be read", async () => {
    const missing = join(scratch, "missing.mp4");
    const error: unknown = await readKeyframeTimes(missing).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Vid2GridError);
    expect(error).toMatchObject({ code: "internal" });
    expect(error instanceof Error && error.cause instanceof Error).toBe(true);
  });
});
