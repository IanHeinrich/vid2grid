import type { PlanOptionInput, VideoInfo } from "@vid2grid/core";
import { imageLabel, recallName, sheetLine } from "../imageRefs";
import { clamp } from "../spans";
import { errorText, plural } from "../text";
import { formatTimestamp } from "../time";
import type { ImageRef, RunTool, ToolResult } from "../types";
import { runListen, type ListenContext } from "./listenTool";
import { MAX_FRAMES_PER_SHEET, choosePerSheet, type SheetGeometry } from "./packing";
import { roundForLabel, sheetGeometry, sheetRefs, type SheetContext } from "./sheets";
import {
  failure,
  integerArg,
  namesArg,
  numberArg,
  parseArguments,
  timesArg,
  type Args,
  type Parsed,
} from "./toolArgs";
import { MAX_FRAMES_TIMES, MAX_LOOK_FRAMES } from "./toolSchemas";

export { MAX_LISTEN_LINES, type ListenContext } from "./listenTool";
export { renderOverview, roundForLabel, sheetRefs, type SheetRenderExtras } from "./sheets";
export { LISTEN_SCHEMA, TOOL_GUIDANCE, TOOL_SCHEMAS, toolSchemas } from "./toolSchemas";

// A frame at the very end of the video has nothing to decode, so keep the request inside it.
const END_MARGIN_SECONDS = 0.05;
const SAME_MOMENT_SECONDS = 0.05;
// Keyframe ranges are inclusive, so the end only has to sit past the last time.
const KEYFRAME_RANGE_PADDING_SECONDS = 0.01;
// Above 1 fps the burned-in timestamps show milliseconds, so 1:45.5 is not printed as 1:45.
const SUBSECOND_TIMESTAMP_FPS = 2;

export interface ToolContext extends SheetContext {
  // Present only when the user turned audio on for this message.
  audio?: ListenContext;
  // The conversation's images so far, which recall finds by name; absent means none.
  knownImages?: () => readonly ImageRef[];
}

export function createToolRunner(ctx: ToolContext): RunTool {
  return async (call) => {
    const args = parseArguments(call);
    if ("problem" in args) return failure(args.problem);
    switch (call.name) {
      case "look":
        return runLook(ctx, args.value);
      case "frames":
        return runFrames(ctx, args.value);
      // Older chats called a single-moment frame(t) tool.
      case "frame":
        return runFrames(ctx, { times: [args.value["t"]] });
      case "note":
        return runNote(ctx, args.value);
      case "listen":
        return runListen(ctx, args.value);
      case "recall":
        return runRecall(ctx, args.value);
      default:
        return failure(
          `Unknown tool "${call.name}". The tools are look, frames, note${ctx.audio ? ", recall and listen" : " and recall"}.`,
        );
    }
  };
}

async function runLook(ctx: ToolContext, args: Args): Promise<ToolResult> {
  const duration = ctx.info.durationSeconds;
  const start = numberArg(args, "start");
  const end = numberArg(args, "end");
  const frames = integerArg(args, "frames", 1, MAX_LOOK_FRAMES);
  const perSheet = integerArg(args, "perSheet", 1, MAX_FRAMES_PER_SHEET);
  if ("problem" in start) return failure(start.problem);
  if ("problem" in end) return failure(end.problem);
  if ("problem" in frames) return failure(frames.problem);
  if ("problem" in perSheet) return failure(perSheet.problem);
  const latest = latestFrameTime(duration);
  const from = clamp(start.value, 0, latest);
  const to = clamp(end.value, 0, latest);
  if (!(from < to)) {
    return failure(
      `start must be before end, within 0 to ${latest} seconds (the video is ${formatTimestamp(duration)} long).`,
    );
  }
  if (perSheet.value > frames.value) {
    return failure(`perSheet (${perSheet.value}) cannot be more than frames (${frames.value}).`);
  }
  const snapped = snapToFullSheets(frames.value, perSheet.value, sheetGeometry(ctx));
  const sheetCount = snapped.frames / snapped.perSheet;
  if (sheetCount > ctx.maxImages) {
    return failure(
      `${sheetCount} images would not fit in one request, the limit is ${ctx.maxImages}. ` +
        "Use fewer frames, more frames per sheet, or a shorter range.",
    );
  }
  const adjusted = snapped.frames !== frames.value || snapped.perSheet !== perSheet.value;
  return runRender(
    ctx,
    {
      startSeconds: from,
      endSeconds: to,
      frameCount: snapped.frames,
      framesPerGrid: snapped.perSheet,
      outputResolution: ctx.resolution,
    },
    `look(${roundForLabel(from)}, ${roundForLabel(to)})`,
    adjusted
      ? `Rendered ${snapped.frames} frames, ${snapped.perSheet} per sheet (adjusted from ${frames.value} and ${perSheet.value} so every sheet is full).`
      : undefined,
  );
}

function snapToFullSheets(
  frames: number,
  perSheet: number,
  geometry: SheetGeometry,
): { frames: number; perSheet: number } {
  const snappedPerSheet = choosePerSheet(1, MAX_FRAMES_PER_SHEET, perSheet, geometry);
  const wantedSheets = Math.ceil(frames / snappedPerSheet);
  const sheets = Math.max(1, Math.min(wantedSheets, Math.floor(MAX_LOOK_FRAMES / snappedPerSheet)));
  return { frames: sheets * snappedPerSheet, perSheet: snappedPerSheet };
}

async function runFrames(ctx: ToolContext, args: Args): Promise<ToolResult> {
  const requested = timesArg(args, "times", MAX_FRAMES_TIMES);
  if ("problem" in requested) return failure(requested.problem);
  const times = distinctMoments(
    requested.value.map((t) => clamp(t, 0, latestFrameTime(ctx.info.durationSeconds))),
  );
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? first;
  return runRender(
    ctx,
    {
      keyframeSampling: true,
      startSeconds: first,
      endSeconds: last + KEYFRAME_RANGE_PADDING_SECONDS,
      framesPerGrid: times.length,
      outputResolution: ctx.resolution,
      ...(times.some(hasTenths) && { targetFps: SUBSECOND_TIMESTAMP_FPS }),
    },
    `frames(${times.map(momentLabel).join(", ")})`,
    undefined,
    { ...ctx.info, keyframeTimestampsSeconds: times },
  );
}

function distinctMoments(times: readonly number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted.filter((t, index) => {
    const previous = sorted[index - 1];
    return previous === undefined || t - previous > SAME_MOMENT_SECONDS;
  });
}

function hasTenths(seconds: number): boolean {
  return Math.floor(seconds * 10) % 10 !== 0;
}

function momentLabel(seconds: number): string {
  return formatTimestamp(seconds, hasTenths(seconds));
}

function runNote(ctx: ToolContext, args: Args): ToolResult {
  const t = numberArg(args, "t");
  if ("problem" in t) return failure(t.problem);
  const { text } = args;
  if (typeof text !== "string" || text.trim() === "") {
    return failure("text must be a non-empty string.");
  }
  const timeSeconds = clamp(t.value, 0, ctx.info.durationSeconds);
  return {
    text: `Noted at ${formatTimestamp(timeSeconds)}.`,
    images: [],
    note: { timeSeconds, text: text.trim() },
  };
}

function recallKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// A full name picks one image; a bare sheet name is accepted only while no other sheet shares it.
function findRecalled(known: readonly ImageRef[], name: string): Parsed<ImageRef> {
  const key = recallKey(name);
  const exact = known.filter((ref) => recallKey(recallName(ref)) === key);
  const bare = known.filter((ref) => recallKey(ref.source.name) === key);
  const matches = exact.length > 0 ? exact : bare;
  const latest = matches[matches.length - 1];
  if (latest === undefined) {
    return {
      problem: `No earlier image is named "${name}". Use a name exactly as its stub gives it.`,
    };
  }
  const distinct = new Set(matches.map((ref) => ref.id));
  if (exact.length === 0 && distinct.size > 1) {
    return {
      problem: `"${name}" names ${distinct.size} images. Use the full name a stub gives, such as "${recallName(latest)}".`,
    };
  }
  return { value: latest };
}

async function runRecall(ctx: ToolContext, args: Args): Promise<ToolResult> {
  const names = namesArg(args, "names");
  if ("problem" in names) return failure(names.problem);
  const known = ctx.knownImages?.() ?? [];
  const problems: string[] = [];
  const found = new Map<string, ImageRef>();
  for (const name of names.value) {
    const match = findRecalled(known, name);
    if ("problem" in match) problems.push(match.problem);
    else found.set(match.value.id, { ...match.value, pinned: false });
  }
  const stored: ImageRef[] = [];
  for (const ref of found.values()) {
    if ((await ctx.store.getImage(ref.id)) !== undefined) stored.push(ref);
    else problems.push(`${recallName(ref)} is no longer stored.`);
  }
  const pinned = new Set(known.filter((ref) => ref.pinned).map((ref) => ref.id));
  const slots = Math.max(0, ctx.maxImages - pinned.size);
  const images = stored.slice(0, slots);
  if (stored.length > images.length) {
    problems.push(
      `Only ${plural(slots, "image")} fit in one request beside the pinned ones; recall the rest later.`,
    );
  }
  if (images.length === 0) return failure(problems.join(" "));
  const lines = [...images.map(imageLabel), ...problems.map((problem) => `Error: ${problem}`)];
  return { text: [...lines, imagesFollow(images.length)].join("\n"), images };
}

async function runRender(
  ctx: ToolContext,
  values: PlanOptionInput,
  call: string,
  adjustment?: string,
  info?: VideoInfo,
): Promise<ToolResult> {
  try {
    const images = await sheetRefs(ctx, values, call, info === undefined ? {} : { info });
    const lines = adjustment === undefined ? [] : [adjustment];
    return { text: [...lines, describeSheets(images)].join("\n"), images };
  } catch (error) {
    return failure(`Rendering failed: ${errorText(error)}`);
  }
}

function imagesFollow(count: number): string {
  return count === 1 ? "1 image follows." : `${count} images follow.`;
}

function describeSheets(images: ImageRef[]): string {
  const lines = images.flatMap((image) => sheetLine(image) ?? []);
  return [...lines, imagesFollow(images.length)].join("\n");
}

function latestFrameTime(durationSeconds: number): number {
  return Math.max(0, durationSeconds - END_MARGIN_SECONDS);
}
