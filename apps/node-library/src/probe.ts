import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import ffprobe from "@ffprobe-installer/ffprobe";
import {
  displaySize,
  normalizeRotationClockwise,
  roundToMicroseconds,
  Vid2GridError,
  type SampleAspectRatio,
  type VideoInfo,
} from "@vid2grid/core";

interface FfprobeStream {
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

interface PacketTime {
  // NaN when ffprobe has no pts for it.
  seconds: number;
  isKeyframe: boolean;
}

const PACKET_LINE = /^packet,([^,]*),(\w*)/;
const TIME_BASE_LINE = /^stream,(\d+\/\d+)/;
// Keeps the command line well under Windows' 32,767 characters.
const SEEKS_PER_FFPROBE = 500;

export async function probeVideo(path: string): Promise<VideoInfo> {
  // Whole sections rather than -show_entries: ffprobe 4.4, as shipped for macOS arm64, has
  // no stream_side_data section to name.
  const query = ["-show_streams", "-show_format", "-of", "json"];
  let json = "";
  for await (const line of ffprobeLines(path, query)) json += line;
  const output = JSON.parse(json) as FfprobeOutput;
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
  const packets = await readPacketTimes(path, [], (isKeyframe) => isKeyframe);
  // Packets arrive in decode order, hence the sort.
  const times = packets
    .map((packet) => packet.seconds)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return times.length > 0 ? times : undefined;
}

// The time of the keyframe a seek to each time lands on, without the times whose seek lands
// on anything else. One packet is read per time, so a long file costs no more than a short one.
export async function readSeekLandings(
  path: string,
  times: readonly number[],
): Promise<Map<number, number>> {
  const landings = new Map<number, number>();
  for (let start = 0; start < times.length; start += SEEKS_PER_FFPROBE) {
    const batch = times.slice(start, start + SEEKS_PER_FFPROBE);
    const intervals = batch.map((seconds) => `${seconds.toFixed(6)}%+#1`).join(",");
    const packets = await readPacketTimes(path, ["-read_intervals", intervals], () => true);
    // A seek that found no packet leaves no way to tell which time each packet answers.
    if (packets.length !== batch.length) continue;
    batch.forEach((seconds, i) => {
      const packet = packets[i];
      if (packet?.isKeyframe === true) landings.set(seconds, packet.seconds);
    });
  }
  return landings;
}

async function readPacketTimes(
  path: string,
  query: string[],
  keep: (isKeyframe: boolean) => boolean,
): Promise<PacketTime[]> {
  const packets: { pts: number; isKeyframe: boolean }[] = [];
  let timeBase: SampleAspectRatio | null = null;
  const entries = ["-show_entries", "stream=time_base:packet=pts,flags", "-of", "csv"];
  for await (const line of ffprobeLines(path, [...entries, ...query])) {
    const [, pts, flags] = PACKET_LINE.exec(line) ?? [];
    const isKeyframe = flags?.startsWith("K") === true;
    if (pts !== undefined && keep(isKeyframe)) packets.push({ pts: Number(pts), isKeyframe });
    // ffprobe prints the streams after their packets.
    timeBase ??= parseRatio(TIME_BASE_LINE.exec(line)?.[1], "/");
  }
  if (timeBase === null) return [];
  const { numerator, denominator } = timeBase;
  return packets.map(({ pts, isKeyframe }) => ({
    seconds: roundToMicroseconds((pts * numerator) / denominator),
    isKeyframe,
  }));
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

async function* ffprobeLines(path: string, query: string[]): AsyncGenerator<string> {
  const ffprobeProcess = spawnFfprobe(path, query);
  const stderr: Buffer[] = [];
  ffprobeProcess.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const finished = new Promise<Error | undefined>((resolve) => {
    ffprobeProcess.on("error", resolve);
    ffprobeProcess.on("close", (code) => {
      resolve(code === 0 ? undefined : new Error(`ffprobe exited with code ${code}`));
    });
  });
  yield* createInterface({ input: ffprobeProcess.stdout });
  const failure = await finished;
  if (failure) throw unreadable(path, failure, Buffer.concat(stderr).toString("utf8").trim());
}

function spawnFfprobe(path: string, query: string[]) {
  const args = ["-v", "error", "-select_streams", "v:0", ...query, path];
  try {
    return spawn(ffprobe.path, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (cause) {
    throw unreadable(path, cause);
  }
}

function unreadable(path: string, cause: unknown, detail = ""): Vid2GridError {
  const message = `ffprobe could not read ${path}${detail ? `: ${detail}` : ""}`;
  return new Vid2GridError("internal", message, { cause });
}
