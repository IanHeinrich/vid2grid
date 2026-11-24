import { ChildProcess, execFileSync } from "node:child_process";
import type * as ChildProcessModule from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTick, setTimeout as delay } from "node:timers/promises";
import ffmpegPath from "ffmpeg-static";
import {
  buildRenderPlan,
  type CollagePlanRequest,
  type RenderPlan,
  type VideoInfo,
} from "@vid2grid/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureFrames, type RgbaFrame } from "../src/capture";
import { probeVideo, readKeyframeTimes } from "../src/probe";
import { fixtureVideo } from "../../../packages/core/tests/fixturePaths";

const TINY_MP4 = fixtureVideo("tiny.mp4");
const KEYFRAMES_MP4 = fixtureVideo("keyframes-20s.mp4");

const spawned = vi.hoisted((): ChildProcess[] => []);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>();
  const spawn = (...args: Parameters<typeof actual.spawn>): ChildProcess => {
    const child = actual.spawn(...args);
    spawned.push(child);
    return child;
  };
  return { ...actual, spawn };
});

function ffmpegProcesses(): ChildProcess[] {
  return spawned.filter((child) => child.spawnfile === ffmpegPath);
}

beforeEach(() => {
  spawned.length = 0;
});

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

async function captureAll(path: string, plan: RenderPlan, info: VideoInfo): Promise<RgbaFrame[]> {
  const images: RgbaFrame[] = [];
  for await (const image of captureFrames(path, plan, info)) images.push(image);
  return images;
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
  const images = await captureAll(path, buildRenderPlan(request(overrides), info), info);
  return images.map((image) => image.decodedTimestampSeconds);
}

interface KilledChild {
  exited: Promise<unknown>;
  bytesAfterKill: number;
}

// Records each killed child and what it still writes to stdout before it exits.
function watchKills() {
  const realKill = Reflect.get(ChildProcess.prototype, "kill");
  const killed: KilledChild[] = [];
  const spy = vi.spyOn(ChildProcess.prototype, "kill");
  spy.mockImplementation(function (this: ChildProcess, signal) {
    const child: KilledChild = { exited: once(this, "close"), bytesAfterKill: 0 };
    this.stdout?.on("data", (chunk: Buffer) => (child.bytesAfterKill += chunk.length));
    killed.push(child);
    return realKill.call(this, signal);
  });
  return { killed, restore: () => spy.mockRestore() };
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
  it("yields one cell-sized RGBA frame per planned time", async () => {
    const info = await probeVideo(TINY_MP4);
    const plan = buildRenderPlan(request({ targetFps: 2 }), info);
    const images = await captureAll(TINY_MP4, plan, info);

    expect(images).toHaveLength(plan.frames.length);
    for (const image of images) {
      expect(image.width).toBe(plan.cell.width);
      expect(image.height).toBe(plan.cell.height);
      expect(image.data).toHaveLength(plan.cell.width * plan.cell.height * 4);
    }
  });

  // The info claims every planned time is a keyframe, so core's rule picks a keyframe-only
  // decode: 0.5 s then gets the 1 s keyframe, where a full decode would give the 0.5 s frame.
  it("decodes nothing but keyframes when the info makes it a keyframe plan", async () => {
    const times = await capturedTimes(gopMp4, { targetFps: 2 }, [0, 0.5, 1, 1.5, 2, 2.5]);
    expect(times).toEqual([0, 1, 1, 2, 2]);
  });

  it("yields fewer frames when the stream ends before the plan does", async () => {
    const info = { ...(await probeVideo(TINY_MP4)), durationSeconds: 6 };
    const plan = buildRenderPlan(request({ endSeconds: 6 }), info);
    const images = await captureAll(TINY_MP4, plan, info);
    // tiny.mp4 ends at 2.9 s, so the planned frames from 3.0 s on go unfilled.
    expect(plan.frames).toHaveLength(24);
    expect(images.map((image) => image.decodedTimestampSeconds)).toEqual([
      0, 0.3, 0.5, 0.8, 1, 1.3, 1.5, 1.8, 2, 2.3, 2.5, 2.8,
    ]);
  });

  it("rejects with ffmpeg's error for an unreadable file", async () => {
    const info = await probeVideo(TINY_MP4);
    const plan = buildRenderPlan(request({}), info);
    await expect(captureAll(join(scratch, "missing.mp4"), plan, info)).rejects.toMatchObject({
      code: "internal",
      message: expect.stringContaining("ffmpeg exited") as unknown,
    });
  });
});

// Rotated and anamorphic, since the crop is in pixels of the picture as displayed.
describe("captureFrames with an area", () => {
  const AREA = { left: 206, top: 308, right: 506, bottom: 775 };

  async function firstFrame(path: string, area?: typeof AREA): Promise<RgbaFrame> {
    const info = await probeVideo(path);
    const plan = buildRenderPlan(request({ framesPerGrid: 1, ...(area && { area }) }), info);
    // A cell the size of the picture or the crop, so neither image is scaled.
    const { width, height } = plan.crop ?? info;
    const unscaled = { ...plan, cell: { width, height }, frames: plan.frames.slice(0, 1) };
    const [frame] = await captureAll(path, unscaled, info);
    if (!frame) throw new Error("no frame was captured");
    return frame;
  }

  function cut(whole: RgbaFrame, x: number, y: number, width: number, height: number): Buffer {
    const rows = Array.from({ length: height }, (_, row) => {
      const start = ((y + row) * whole.width + x) * 4;
      return Buffer.from(whole.data.subarray(start, start + width * 4));
    });
    return Buffer.concat(rows);
  }

  it.each([
    ["plain", ["-c", "copy"], [33, 37, 48, 56]],
    ["rotated", ["-c", "copy"], [25, 49, 36, 75]],
    ["anamorphic", ["-c:v", "libx264", "-vf", "setsar=2"], [66, 37, 96, 56]],
  ] as const)("yields the crop's own pixels of a %s video", async (kind, args, rect) => {
    const [x, y, width, height] = rect;
    const video = join(scratch, `${kind}.mp4`);
    const input = kind === "rotated" ? ["-display_rotation", "90"] : [];
    execFileSync(ffmpegPath ?? "ffmpeg", [
      ...["-v", "error", "-y", ...input, "-i", TINY_MP4, ...args, video],
    ]);

    const whole = await firstFrame(video);
    const cropped = await firstFrame(video, AREA);

    expect([cropped.width, cropped.height]).toEqual([width, height]);
    expect(Buffer.from(cropped.data).equals(cut(whole, x, y, width, height))).toBe(true);
  });
});

const VIDEO_FRAMES = 200; // keyframes-20s.mp4: 20 s at 10 fps

// How ffmpeg exits after a kill differs by build (Linux's traps SIGTERM and finishes the
// input), so what proves the kill is how little it wrote afterwards.
async function expectStoppedEarlyOnce(killed: KilledChild[], frameBytes: number): Promise<void> {
  const [child] = killed;
  if (!child) throw new Error("ffmpeg was never killed");
  expect(killed).toHaveLength(1);
  await child.exited;
  expect(child.bytesAfterKill / frameBytes).toBeLessThan(VIDEO_FRAMES / 2);
}

describe("captureFrames stopping ffmpeg", () => {
  it("kills it once, early, when every planned frame is filled", async () => {
    const video = fixtureVideo("keyframes-20s.mp4");
    const info = await probeVideo(video);
    const plan = buildRenderPlan(request({ endSeconds: 2, targetFps: 10 }), info);
    const { killed, restore } = watchKills();
    try {
      const images = await captureAll(video, plan, info);
      expect(images).toHaveLength(plan.frames.length);
      await expectStoppedEarlyOnce(killed, plan.cell.width * plan.cell.height * 4);
    } finally {
      restore();
    }
  });
});

const PULLED = 3;

// At 10 fps the plan takes every one of the video's frames, far more than a pipe holds.
describe("captureFrames backpressure", () => {
  it("pauses ffmpeg while the consumer is not pulling, and kills it on return", async () => {
    const video = fixtureVideo("keyframes-20s.mp4");
    const info = await probeVideo(video);
    const plan = buildRenderPlan(request({ endSeconds: 20, targetFps: 10 }), info);
    const frameBytes = plan.cell.width * plan.cell.height * 4;
    const pause = vi.spyOn(Socket.prototype, "pause");
    const { killed, restore } = watchKills();
    const frames = captureFrames(video, plan, info);
    try {
      for (let i = 0; i < PULLED; i++) await frames.next();
      const [stdout] = pause.mock.contexts;
      if (!(stdout instanceof Socket)) throw new Error("ffmpeg's stdout was never paused");
      await delay(300);
      const bytesRead = stdout.bytesRead;
      await delay(300);

      expect(plan.frames).toHaveLength(VIDEO_FRAMES);
      expect(stdout.isPaused()).toBe(true);
      expect(stdout.bytesRead).toBe(bytesRead);
      expect(bytesRead / frameBytes).toBeLessThanOrEqual(PULLED + 2);
      expect((await frames.next()).done).toBe(false);

      await frames.return();
      await expectStoppedEarlyOnce(killed, frameBytes);
    } finally {
      pause.mockRestore();
      restore();
    }
  });
});

function planAt(times: number[]): RenderPlan {
  const info = { durationSeconds: 1000, width: 320, height: 240 };
  const frames = times.map((timestampSeconds, frameIndex) => ({ frameIndex, timestampSeconds }));
  return { ...buildRenderPlan(request({}), info), frames };
}

// The times and pixels of frames, hashed because comparing them byte by byte is slow.
function picked(frames: RgbaFrame[]): string[] {
  return frames.map(({ decodedTimestampSeconds, data }) => {
    return `${decodedTimestampSeconds} ${createHash("sha1").update(data).digest("hex")}`;
  });
}

const ANY_INFO: VideoInfo = { durationSeconds: 1000, width: 320, height: 240 };

// The same times with every half second between them too, so nothing is far enough apart to
// seek over: one process decodes everything.
async function captureDecodingThrough(path: string, times: number[]): Promise<RgbaFrame[]> {
  const halfSeconds = Array.from({ length: 64 }, (_, i) => i / 2);
  const dense = [...new Set([...times, ...halfSeconds])].sort((a, b) => a - b);
  const images = await captureAll(path, planAt(dense), ANY_INFO);
  return times.flatMap((time) => images[dense.indexOf(time)] ?? []);
}

function encodeClip(name: string, codecArgs: string[], outputArgs: string[] = []): string {
  const clip = join(scratch, name);
  const source = "testsrc2=size=160x120:rate=10:duration=32,noise=alls=20:allf=t";
  execFileSync(ffmpegPath ?? "ffmpeg", [
    ...["-v", "error", "-y", "-f", "lavfi", "-i", source],
    ...["-preset", "ultrafast", "-sc_threshold", "0", "-g", "20", "-bf", "3"],
    ...["-c:v", "libx264", ...codecArgs, ...outputArgs, clip],
  ]);
  return clip;
}

function remux(source: string, name: string, inputArgs: string[], outputArgs: string[]): string {
  const clip = join(scratch, name);
  execFileSync(ffmpegPath ?? "ffmpeg", [
    ...["-v", "error", "-y", ...inputArgs, "-i", source, "-c", "copy", ...outputArgs, clip],
  ]);
  return clip;
}

const OPEN_GOP = ["-x264-params", "open-gop=1"];
const VARIABLE_RATE = ["-vf", "select='not(mod(n*n,7))'", "-fps_mode", "vfr", "-g", "5"];
const closedGop = () => encodeClip("closed.mp4", []);

interface SparseCase {
  name: string;
  clip: () => string;
  seeks: boolean;
}

const SPARSE_CASES: SparseCase[] = [
  { name: "B-frames", clip: closedGop, seeks: true },
  { name: "an open GOP in mp4", clip: () => encodeClip("open.mp4", OPEN_GOP), seeks: true },
  { name: "an open GOP in mkv", clip: () => encodeClip("open.mkv", OPEN_GOP), seeks: true },
  { name: "a variable frame rate", clip: () => encodeClip("vfr.mp4", VARIABLE_RATE), seeks: true },
  {
    name: "an edit list that starts inside a GOP",
    clip: () => remux(closedGop(), "edit.mp4", ["-ss", "3.35"], []),
    seeks: true,
  },
  {
    name: "a container start time of 1.4 s",
    clip: () => remux(closedGop(), "late-start.mp4", [], ["-output_ts_offset", "1.4"]),
    seeks: true,
  },
  {
    name: "a fragmented mp4",
    clip: () => remux(closedGop(), "frag.mp4", [], ["-movflags", "frag_keyframe+empty_moov"]),
    seeks: true,
  },
  { name: "one keyframe", clip: () => encodeClip("single.mp4", ["-g", "9999"]), seeks: false },
  {
    name: "seeks that land between keyframes",
    clip: () => remux(closedGop(), "stream.ts", [], []),
    seeks: false,
  },
];

const SPARSE_TIMES = [0.31, 0.62, 9.9343, 10, 17.8891, 18.2, 26.02];

function seekArgument(ffmpeg: ChildProcess | undefined): string | undefined {
  const args = ffmpeg?.spawnargs ?? [];
  return args[args.indexOf("-ss") + 1];
}

describe("captureFrames on a sparse plan", () => {
  it.each(SPARSE_CASES)("picks the frames a full decode does: $name", async ({ clip, seeks }) => {
    const path = clip();
    const frames = await captureAll(path, planAt(SPARSE_TIMES), ANY_INFO);

    expect(ffmpegProcesses().length > 1).toBe(seeks);
    expect(frames).toHaveLength(SPARSE_TIMES.length);
    expect(picked(frames)).toEqual(picked(await captureDecodingThrough(path, SPARSE_TIMES)));
  });

  // Decoding recovers more than a second after each of this clip's keyframes.
  it("decodes through from the first seek once a seek lands late", async () => {
    const path = encodeClip("refresh.mp4", ["-x264-params", "intra-refresh=1:keyint=20"]);
    const frames = await captureAll(path, planAt(SPARSE_TIMES), ANY_INFO);

    expect(ffmpegProcesses().length).toBeGreaterThanOrEqual(3);
    expect(seekArgument(ffmpegProcesses().at(-1))).toBe(seekArgument(ffmpegProcesses()[0]));
    expect(picked(frames)).toEqual(picked(await captureDecodingThrough(path, SPARSE_TIMES)));
  });

  it("picks the frames a full decode does on keyframes-20s.mp4", async () => {
    const times = [0.25, 6.5, 6.72, 12, 18.95];
    const frames = await captureAll(KEYFRAMES_MP4, planAt(times), ANY_INFO);

    expect(ffmpegProcesses()).toHaveLength(4);
    expect(picked(frames)).toEqual(picked(await captureDecodingThrough(KEYFRAMES_MP4, times)));
  });

  it("ends where the stream does", async () => {
    const times = [0, 8, 19.9, 19.95, 27, 35];
    const frames = await captureAll(KEYFRAMES_MP4, planAt(times), ANY_INFO);

    expect(frames.map((frame) => frame.decodedTimestampSeconds)).toEqual([0, 8, 19.9]);
    expect(ffmpegProcesses()).toHaveLength(3);
  });
});

async function expectAllExited(): Promise<void> {
  for (const child of spawned) {
    if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
  }
}

// Every frame of each far-apart second: more pixels than a pipe holds.
const SECONDS_APART = [0, 8, 16].flatMap((start) =>
  Array.from({ length: 20 }, (_, i) => start + i / 10),
);

describe("captureFrames stopping a sparse plan", () => {
  it("kills the segment under way and starts no other when the consumer returns", async () => {
    const frames = captureFrames(KEYFRAMES_MP4, planAt(SECONDS_APART), ANY_INFO);
    for (let i = 0; i < 21; i++) await frames.next();
    await frames.return();

    await expectAllExited();
    expect(ffmpegProcesses()).toHaveLength(2);
    expect(ffmpegProcesses().map((child) => child.killed)).toEqual([true, true]);
  });

  it("rejects when ffmpeg dies partway through a later segment", async () => {
    const frames = captureFrames(KEYFRAMES_MP4, planAt(SECONDS_APART), ANY_INFO);
    for (let i = 0; i < 21; i++) await frames.next();
    const [, second] = ffmpegProcesses();
    if (!second) throw new Error("the second segment never started");
    process.kill(second.pid ?? 0, "SIGKILL");

    await expect(async () => {
      for await (const frame of frames) expect(frame.decodedTimestampSeconds).toBeLessThan(10);
    }).rejects.toMatchObject({
      code: "internal",
      message: expect.stringContaining("ffmpeg exited") as unknown,
    });
    await expectAllExited();
    expect(ffmpegProcesses()).toHaveLength(2);
  });
});

describe("captureFrames aborting", () => {
  const reason = new Error("stopped");
  // Too close together to seek between, so ffmpeg starts without a landing probe.
  const CLOSE_TOGETHER = [0, 0.1, 0.2];

  function abortable(times: number[], abortReason: unknown = reason) {
    const controller = new AbortController();
    const { signal } = controller;
    const add = vi.spyOn(signal, "addEventListener");
    const remove = vi.spyOn(signal, "removeEventListener");
    return {
      signal,
      frames: captureFrames(KEYFRAMES_MP4, planAt(times), ANY_INFO, signal),
      abort: () => controller.abort(abortReason),
      expectNoListeners: () => expect(remove.mock.calls).toEqual(add.mock.calls),
    };
  }

  it("starts no process when already aborted", async () => {
    for (const times of [SECONDS_APART, CLOSE_TOGETHER]) {
      const signal = AbortSignal.abort(reason);
      const frames = captureFrames(KEYFRAMES_MP4, planAt(times), ANY_INFO, signal);

      await expect(frames.next()).rejects.toBe(reason);
    }
    expect(spawned).toEqual([]);
  });

  it("kills the landing probe and starts no ffmpeg", async () => {
    const { frames, abort, expectNoListeners } = abortable(SECONDS_APART);
    const pulled = frames.next();
    expect(spawned).toHaveLength(1);

    abort();

    await expect(pulled).rejects.toBe(reason);
    expect(spawned.map((child) => child.killed)).toEqual([true]);
    await expectAllExited();
    expectNoListeners();
  });

  it("rejects a pull that is waiting on ffmpeg", async () => {
    const { frames, abort, expectNoListeners } = abortable(CLOSE_TOGETHER);
    const pulled = frames.next();
    await nextTick();
    expect(ffmpegProcesses()).toHaveLength(1);

    abort();

    await expect(pulled).rejects.toBe(reason);
    expect(await frames.next()).toEqual({ done: true, value: undefined });
    await expectAllExited();
    expectNoListeners();
  });

  it("kills ffmpeg mid-segment without waiting for the next pull", async () => {
    const { frames, abort, expectNoListeners } = abortable(SECONDS_APART, "stopped");
    for (let i = 0; i < 21; i++) await frames.next();

    abort();

    expect(ffmpegProcesses().map((child) => child.killed)).toEqual([true, true]);
    await expectAllExited();
    await expect(frames.next()).rejects.toBe("stopped");
    expect(ffmpegProcesses()).toHaveLength(2);
    expectNoListeners();
  });

  it("starts no further segment when aborted between two", async () => {
    const { frames, abort, expectNoListeners } = abortable(SECONDS_APART);
    for (let i = 0; i < 20; i++) await frames.next();

    abort();

    await expect(frames.next()).rejects.toBe(reason);
    expect(ffmpegProcesses()).toHaveLength(1);
    await expectAllExited();
    expectNoListeners();
  });

  it("does nothing once the capture is over", async () => {
    const { frames, abort, expectNoListeners } = abortable(SECONDS_APART);
    let count = 0;
    for await (const frame of frames) {
      expect(frame.width).toBeGreaterThan(0);
      count++;
    }
    const processes = spawned.length;
    expectNoListeners();

    abort();

    expect(count).toBe(SECONDS_APART.length);
    expect(await frames.next()).toEqual({ done: true, value: undefined });
    expect(spawned).toHaveLength(processes);
    await expectAllExited();
  });
});
