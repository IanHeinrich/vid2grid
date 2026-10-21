import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffprobe from "@ffprobe-installer/ffprobe";
import {
  displaySize,
  normalizeRotationClockwise,
  roundToMicroseconds,
  Vid2GridError,
  type SampleAspectRatio,
  type VideoInfo,
} from "@vid2grid/core";

const execFileAsync = promisify(execFile);

interface FfprobeStream {
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  time_base?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

interface FfprobePacket {
  pts?: number;
  flags?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  packets?: FfprobePacket[];
  format?: { duration?: string };
}

export async function probeVideo(path: string): Promise<VideoInfo> {
  const output = await runFfprobe(path, [
    "-show_entries",
    "stream=width,height,sample_aspect_ratio,duration:stream_tags=rotate:stream_side_data=rotation:format=duration",
  ]);
  const stream = output.streams?.[0];
  if (!stream?.width || !stream.height) {
    throw new Vid2GridError("no_frames", `No video stream in ${path}`);
  }

  const { width, height } = displaySize(
    stream.width,
    stream.height,
    parseRatio(stream.sample_aspect_ratio, ":"),
    rotationClockwise(stream),
  );
  return {
    durationSeconds: parseSeconds(output.format?.duration) ?? parseSeconds(stream.duration) ?? 0,
    width,
    height,
  };
}

// Undefined when the file has no video stream or no keyframe with a pts; an unreadable
// file rejects.
export async function readKeyframeTimes(path: string): Promise<number[] | undefined> {
  const output = await runFfprobe(path, ["-show_entries", "stream=time_base:packet=pts,flags"]);
  const timeBase = parseRatio(output.streams?.[0]?.time_base, "/");
  if (timeBase === null) return undefined;

  // Packets arrive in decode order, hence the sort.
  const times = (output.packets ?? [])
    .flatMap(({ pts, flags }) =>
      pts !== undefined && flags?.startsWith("K") === true
        ? [roundToMicroseconds((pts * timeBase.numerator) / timeBase.denominator)]
        : [],
    )
    .sort((a, b) => a - b);
  return times.length > 0 ? times : undefined;
}

// ffprobe's display matrix rotation is already av_display_rotation_get's angle, and the
// container's "rotate" tag is clockwise where that angle is counter-clockwise.
function rotationClockwise(stream: FfprobeStream): number {
  const rotateTag = stream.tags?.rotate;
  if (rotateTag !== undefined) return normalizeRotationClockwise(-Number(rotateTag));
  const displayMatrix = stream.side_data_list?.find((sideData) => sideData.rotation !== undefined);
  return normalizeRotationClockwise(displayMatrix?.rotation ?? 0);
}

// An unset ratio arrives as "0:1" or "N/A".
function parseRatio(text: string | undefined, separator: string): SampleAspectRatio | null {
  const [numerator, denominator] = (text ?? "").split(separator).map(Number);
  if (numerator === undefined || denominator === undefined) return null;
  if (!(numerator > 0) || !(denominator > 0)) return null;
  return { numerator, denominator };
}

function parseSeconds(text: string | undefined): number | undefined {
  const seconds = Number(text);
  return text === undefined || !Number.isFinite(seconds) ? undefined : seconds;
}

async function runFfprobe(path: string, entries: string[]): Promise<FfprobeOutput> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      ffprobe.path,
      ["-v", "error", "-select_streams", "v:0", ...entries, "-of", "json", path],
      { maxBuffer: Infinity },
    ));
  } catch (cause) {
    const detail = cause instanceof Error && "stderr" in cause ? String(cause.stderr).trim() : "";
    const message = `ffprobe could not read ${path}${detail ? `: ${detail}` : ""}`;
    throw new Vid2GridError("internal", message, { cause });
  }
  return JSON.parse(stdout) as FfprobeOutput;
}
