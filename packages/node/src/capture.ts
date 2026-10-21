import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import ffmpegPath from "ffmpeg-static";
import {
  createFrameMatcher,
  isKeyframePlan,
  roundToMicroseconds,
  Vid2GridError,
  type PortProgressCallback,
  type RenderPlan,
  type VideoInfo,
} from "@vid2grid/core";
import { assertPixelsMatchLog, createFrameStream, type FrameHandler } from "./frameStream";

export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  // The decoded frame's own time, at or after the planned time it fills.
  decodedTimestampSeconds: number;
}

const RGBA_BYTES = 4;

export async function captureFrames(
  path: string,
  plan: RenderPlan,
  info: VideoInfo,
  onProgress?: PortProgressCallback,
): Promise<RgbaFrame[]> {
  const planned = plan.frames.map((frame) => frame.timestampSeconds);
  const firstSeconds = planned[0];
  if (firstSeconds === undefined) return [];

  const { width, height } = plan.cell;
  const matcher = createFrameMatcher(planned);
  const images: RgbaFrame[] = [];
  const keyframesOnly = isKeyframePlan(plan, info.keyframeTimestampsSeconds);
  const args = ffmpegArgs(path, plan, firstSeconds, keyframesOnly);
  await decodeFrames(path, args, width * height * RGBA_BYTES, (frame) => {
    const { exactSeconds, pixels } = frame;
    const filled = matcher.fill(exactSeconds);
    if (filled.length === 0) return false;
    // Checked only on kept frames: a frame lost from either stream shifts every pairing
    // after it, so the next kept frame's pixels no longer match its logged checksum.
    assertPixelsMatchLog(frame);
    const image: RgbaFrame = {
      width,
      height,
      data: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length),
      decodedTimestampSeconds: roundToMicroseconds(exactSeconds),
    };
    filled.forEach(() => images.push(image));
    onProgress?.({ done: images.length, total: planned.length });
    return matcher.done;
  });
  return images;
}

// One ffmpeg process for the whole plan, from the keyframe before the first planned time.
function ffmpegArgs(
  path: string,
  plan: RenderPlan,
  firstSeconds: number,
  keyframesOnly: boolean,
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    ...(keyframesOnly ? ["-skip_frame", "nokey"] : []),
    // -seek_timestamp keeps ffmpeg from adding the container's start time to -ss, and
    // -copyts keeps the stream's own timestamps: the raw times Python's capture seeks by.
    ...(firstSeconds > 0
      ? ["-seek_timestamp", "1", "-ss", firstSeconds.toFixed(6), "-noaccurate_seek"]
      : []),
    "-copyts",
    "-i",
    path,
    "-map",
    "0:v:0",
    "-vf",
    `scale=${plan.cell.width}:${plan.cell.height}:flags=bicubic,format=rgba,showinfo`,
    "-fps_mode",
    "passthrough",
    "-f",
    "rawvideo",
    "pipe:1",
  ];
}

// Anything thrown while handling ffmpeg's output, including by the caller's progress
// callback, stops ffmpeg and rejects instead of escaping the stream listener.
function decodeFrames(
  path: string,
  args: string[],
  frameBytes: number,
  onFrame: FrameHandler,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawnFfmpeg(path, args, reject);
    if (!ffmpeg) return;
    const stream = createFrameStream(frameBytes, onFrame);
    let failed = false;
    // SIGKILL because ffmpeg 7 on Linux traps SIGTERM and still decodes the rest of the input.
    const stop = (): void => {
      if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
    };
    const guarded =
      <T>(handle: (value: T) => void) =>
      (value: T): void => {
        if (failed) return;
        try {
          handle(value);
          if (stream.stopped) stop();
        } catch (error) {
          failed = true;
          stop();
          reject(error instanceof Error ? error : new Vid2GridError("internal", String(error)));
        }
      };

    ffmpeg.stdout.on(
      "data",
      guarded((chunk: Buffer) => stream.writePixels(chunk)),
    );
    createInterface({ input: ffmpeg.stderr }).on(
      "line",
      guarded((line: string) => stream.readLogLine(line)),
    );
    ffmpeg.on("error", (cause) => {
      failed = true;
      reject(new Vid2GridError("internal", `ffmpeg could not start for ${path}`, { cause }));
    });
    ffmpeg.on(
      "close",
      guarded((code: number | null) => {
        if (!stream.stopped && code !== 0) {
          const message = `ffmpeg exited with code ${code} on ${path}:\n${stream.logTail()}`;
          throw new Vid2GridError("internal", message);
        }
        stream.finish();
        resolve();
      }),
    );
  });
}

function spawnFfmpeg(path: string, args: string[], reject: (error: Vid2GridError) => void) {
  const binary = ffmpegPath;
  if (!binary) {
    reject(new Vid2GridError("internal", "ffmpeg-static has no binary for this platform"));
    return undefined;
  }
  try {
    return spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" },
    });
  } catch (cause) {
    reject(new Vid2GridError("internal", `ffmpeg could not start for ${path}`, { cause }));
    return undefined;
  }
}
