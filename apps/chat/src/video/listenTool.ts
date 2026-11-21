import type { AudioAnalysisProgress } from "@vid2grid/core";
import { isAbortError } from "../abort";
import {
  AudioDecodeError,
  ensureAudio,
  isRangeHeard,
  timedAudioLines,
  type AudioDeps,
  type AudioLabels,
  type TimedAudioLine,
} from "../audio/videoAudio";
import { clamp } from "../spans";
import { errorText } from "../text";
import { formatSpan, formatTimestamp } from "../time";
import type { AudioSpan, ToolResult, VideoAudio } from "../types";
import type { SheetContext } from "./sheets";
import { roundForLabel } from "./sheets";
import { failure, numberArg, type Args } from "./toolArgs";

const MAX_LISTEN_SECONDS = 600;
export const MAX_LISTEN_LINES = 150;

export interface ListenContext extends AudioDeps {
  signal?: AbortSignal;
  onProgress?: (progress: AudioAnalysisProgress) => void;
}

type ListenToolContext = Pick<SheetContext, "file" | "info" | "video"> & {
  audio?: ListenContext;
};

export async function runListen(ctx: ListenToolContext, args: Args): Promise<ToolResult> {
  const { audio } = ctx;
  if (!audio) {
    return failure("listen is not available: the user has audio turned off for this message.");
  }
  const start = numberArg(args, "start");
  const end = numberArg(args, "end");
  if ("problem" in start) return failure(start.problem);
  if ("problem" in end) return failure(end.problem);
  const duration = ctx.info.durationSeconds;
  const from = clamp(start.value, 0, duration);
  const wanted = clamp(end.value, 0, duration);
  if (!(from < wanted)) {
    return failure(
      `start must be before end, within 0 to ${roundForLabel(duration)} seconds (the video is ${formatTimestamp(duration)} long).`,
    );
  }
  const to = Math.min(wanted, from + MAX_LISTEN_SECONDS);
  const range = { startSeconds: from, endSeconds: to };
  const source = { file: ctx.file, fileKey: ctx.video.fileKey, durationSeconds: duration };
  const options = {
    ...(audio.signal ? { signal: audio.signal } : {}),
    ...(audio.onProgress ? { onProgress: audio.onProgress } : {}),
  };
  let heard: VideoAudio;
  try {
    heard = await ensureAudio(audio, source, range, options);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof AudioDecodeError) {
      return failure(`The audio from ${formatSpan(from, to)} could not be decoded.`);
    }
    return failure(`Audio analysis failed: ${errorText(error)}`);
  }
  return heardResult(heard, range, wanted, audio.labels);
}

function heardResult(
  heard: VideoAudio,
  range: AudioSpan,
  wanted: number,
  labels: AudioLabels,
): ToolResult {
  const span = formatSpan(range.startSeconds, range.endSeconds);
  if (heard.noAudio) {
    return heardText(["This video has no audio track, so there is nothing to hear."]);
  }
  if (!isRangeHeard(heard, range, labels)) {
    return heardText([`The audio from ${span} is too short to analyse.`]);
  }
  const lines = timedAudioLines(heard, range, labels);
  const shown = lines.slice(0, MAX_LISTEN_LINES);
  const ending = whereToCarryOn(lines[shown.length], shown.length, lines.length, range, wanted);
  if (lines.length === 0) return heardText([`Nothing was heard from ${span}.`, ...ending]);
  return heardText([`Heard from ${span}:`, ...shown.map((entry) => entry.line), ...ending]);
}

function whereToCarryOn(
  next: TimedAudioLine | undefined,
  shown: number,
  total: number,
  range: AudioSpan,
  wanted: number,
): string[] {
  if (next) {
    const from = roundForLabel(Math.max(range.startSeconds, next.startSeconds));
    return [`Showing the first ${shown} of ${total} lines. Call listen from ${from} for the rest.`];
  }
  if (range.endSeconds < wanted) {
    const from = roundForLabel(range.endSeconds);
    return [`Only 10 minutes are read per call. Call listen from ${from} for the rest.`];
  }
  return [];
}

function heardText(lines: readonly string[]): ToolResult {
  return { text: lines.join("\n"), images: [] };
}
