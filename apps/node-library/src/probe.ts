import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import ffprobe from "@ffprobe-installer/ffprobe";
import {
  displaySize,
  normalizeRotationClockwise,
  roundToMicroseconds,
  Vid2GridError,
  type AbortSignalLike,
  type SampleAspectRatio,
  type VideoInfo,
} from "@vid2grid/core";
import { onAbort, throwIfAborted } from "./abort";
import { exitFailure, isCrash } from "./processExit";

interface FfprobeStream {
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  avg_frame_rate?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  packets?: { pts?: number }[];
  format?: { duration?: string; format_name?: string };
}

interface Packet {
  // NaN when ffprobe has no pts for it.
  seconds: number;
  flags: string;
}

export interface SeekFacts {
  // False when the first packet has no pts: ffmpeg then makes up times a seek would not.
  startsWithPts: boolean;
  // Undefined when ffprobe does not know it.
  framesPerSecond: number | undefined;
  isFlv: boolean;
  // How much earlier than asked ffmpeg may seek.
  backOffSeconds: number;
}

const PACKET_LINE = /^packet,([^,]*),(\w*)/;
const TIME_BASE_LINE = /^stream,(\d+\/\d+)/;
// Keeps the command line well under Windows' 32,767 characters.
const SEEKS_PER_FFPROBE = 500;
// ffmpeg takes 3/23 s off -ss when a stream has B-frames and its demuxer, unlike the mov one,
// seeks by decode time.
const DECODE_TIME_BACK_OFF_SECONDS = 0.131;

export async function probeVideo(path: string): Promise<VideoInfo> {
  // Whole sections rather than -show_entries: ffprobe 4.4, as shipped for macOS arm64, has
  // no stream_side_data section to name.
  const output = await readJson(path, ["-show_streams", "-show_format"]);
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
  const packets = await readPackets(path, [], isKeyframe);
  // Packets arrive in decode order, hence the sort.
  const times = packets
    .map((packet) => packet.seconds)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return times.length > 0 ? times : undefined;
}

export async function readSeekFacts(path: string, signal?: AbortSignalLike): Promise<SeekFacts> {
  const entries = "packet=pts:stream=avg_frame_rate:format=format_name";
  const query = ["-read_intervals", "%+#1", "-show_entries", entries];
  const { packets, streams, format } = await readJson(path, query, signal);
  const rate = parseRatio(streams?.[0]?.avg_frame_rate, "/");
  const formatNames = format?.format_name?.split(",") ?? [];
  return {
    startsWithPts: packets?.[0]?.pts !== undefined,
    framesPerSecond: rate ? rate.numerator / rate.denominator : undefined,
    isFlv: formatNames.includes("flv"),
    backOffSeconds: formatNames.includes("mov") ? 0 : DECODE_TIME_BACK_OFF_SECONDS,
  };
}

// The time of the keyframe a seek to each time lands on, without the times whose seek lands
// on anything else. One packet is read per time, so a long file costs no more than a short one.
export async function readSeekLandings(
  path: string,
  times: readonly number[],
  backOffSeconds = 0,
  signal?: AbortSignalLike,
): Promise<Map<number, number>> {
  const landings = new Map<number, number>();
  for (let start = 0; start < times.length; start += SEEKS_PER_FFPROBE) {
    const batch = times.slice(start, start + SEEKS_PER_FFPROBE);
    const seeks = batch.map((seconds) => Math.max(0, seconds - backOffSeconds));
    const packets = await readPacketAtEach(path, seeks, signal);
    // A seek that found no packet leaves no way to tell which time each packet answers.
    if (packets.length !== batch.length) continue;
    batch.forEach((seconds, i) => {
      const packet = packets[i];
      if (packet && isKeyframe(packet.flags) && !isDiscarded(packet.flags)) {
        landings.set(seconds, packet.seconds);
      }
    });
  }
  return landings;
}

async function readPacketAtEach(
  path: string,
  seeks: readonly number[],
  signal: AbortSignalLike | undefined,
): Promise<Packet[]> {
  const intervals = seeks.map((seconds) => `${seconds.toFixed(6)}%+#1`).join(",");
  try {
    return await readPackets(path, ["-read_intervals", intervals], () => true, signal);
  } catch (error) {
    // Some ffprobe builds crash seeking in some containers; those seeks have no landing.
    if (isCrash(error)) return [];
    throw error;
  }
}

function isKeyframe(flags: string): boolean {
  return flags.startsWith("K");
}

// Decoded but not shown: an edit list's pre-roll.
function isDiscarded(flags: string): boolean {
  return flags.includes("D");
}

async function readPackets(
  path: string,
  query: string[],
  keep: (flags: string) => boolean,
  signal?: AbortSignalLike,
): Promise<Packet[]> {
  const packets: { pts: number; flags: string }[] = [];
  let timeBase: SampleAspectRatio | null = null;
  const entries = ["-show_entries", "stream=time_base:packet=pts,flags", "-of", "csv"];
  for await (const line of ffprobeLines(path, [...entries, ...query], signal)) {
    const [, pts, flags] = PACKET_LINE.exec(line) ?? [];
    if (pts !== undefined && flags !== undefined && keep(flags)) {
      packets.push({ pts: Number(pts), flags });
    }
    // ffprobe prints the streams after their packets.
    timeBase ??= parseRatio(TIME_BASE_LINE.exec(line)?.[1], "/");
  }
  if (timeBase === null) return [];
  const { numerator, denominator } = timeBase;
  return packets.map(({ pts, flags }) => ({
    seconds: roundToMicroseconds((pts * numerator) / denominator),
    flags,
  }));
}

async function readJson(
  path: string,
  query: string[],
  signal?: AbortSignalLike,
): Promise<FfprobeOutput> {
  let json = "";
  for await (const line of ffprobeLines(path, [...query, "-of", "json"], signal)) json += line;
  return JSON.parse(json) as FfprobeOutput;
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

async function* ffprobeLines(
  path: string,
  query: string[],
  signal?: AbortSignalLike,
): AsyncGenerator<string> {
  throwIfAborted(signal);
  const ffprobeProcess = spawnFfprobe(path, query);
  const stderr: Buffer[] = [];
  ffprobeProcess.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const finished = new Promise<Error | undefined>((resolve) => {
    ffprobeProcess.on("error", resolve);
    ffprobeProcess.on("close", (code, exitSignal) => {
      resolve(exitFailure("ffprobe", code, exitSignal));
    });
  });
  const stopListening = onAbort(signal, () => ffprobeProcess.kill("SIGKILL"));
  try {
    yield* createInterface({ input: ffprobeProcess.stdout });
    const failure = await finished;
    throwIfAborted(signal);
    if (failure) {
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      throw unreadable(path, failure, detail || failure.message);
    }
  } finally {
    stopListening();
  }
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
