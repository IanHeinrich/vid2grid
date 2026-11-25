import type { PlanOptionInput } from "@vid2grid/core";
import { sheetLine } from "../imageRefs";
import { clamp } from "../spans";
import { errorText } from "../text";
import { formatTimestamp } from "../time";
import type { ImageRef, RunTool, ToolResult, ToolSchema } from "../types";
import { runAsk, type AskContext } from "./askTool";
import { exactTimes, latestFrameTime } from "./exactTimes";
import { runListen, type ListenContext } from "./listenTool";
import { MAX_FRAMES_PER_SHEET, choosePerSheet, type SheetGeometry } from "./packing";
import { runRecall, type RecallContext } from "./recallTool";
import { roundForLabel, sheetGeometry, sheetRefs, type SheetContext } from "./sheets";
import {
  failure,
  imagesDescribed,
  imagesFollow,
  integerArg,
  numberArg,
  parseArguments,
  timesArg,
  type Args,
} from "./toolArgs";
import { MAX_FRAMES_TIMES, MAX_LOOK_FRAMES } from "./toolSchemas";
import { runZoom, type ZoomContext } from "./zoomTool";

export type { AskContext } from "./askTool";
export { MAX_LISTEN_LINES, type ListenContext } from "./listenTool";
export { renderOverview, roundForLabel, sheetRefs, type SheetRenderExtras } from "./sheets";
export { LISTEN_SCHEMA, toolOffer, type ToolOffer } from "./toolSchemas";

const SAME_MOMENT_SECONDS = 0.05;

// The loaded video, as the overview, a study and its audio use it.
export type ToolContext = SheetContext;

// The video, in sheets, is present only while it is loaded.
export interface ToolRunnerContext extends ZoomContext, Omit<RecallContext, "store"> {
  // What the model was offered, listed when it calls something else.
  tools: readonly ToolSchema[];
  // Present only when the user turned audio on for this message.
  audio?: ListenContext;
  // Present only when the chat has a looking model.
  ask?: AskContext;
}

type VideoTool = (sheets: SheetContext) => ToolResult | Promise<ToolResult>;

export function createToolRunner(ctx: ToolRunnerContext): RunTool {
  const run = toolRunner(ctx);
  return ctx.ask ? async (call) => describedBelow(await run(call)) : run;
}

function describedBelow(result: ToolResult): ToolResult {
  const count = result.images.length;
  const follow = imagesFollow(count);
  if (!result.text.endsWith(follow)) return result;
  return { ...result, text: result.text.slice(0, -follow.length) + imagesDescribed(count) };
}

function toolRunner(ctx: ToolRunnerContext): RunTool {
  return async (call) => {
    const args = parseArguments(call);
    if ("problem" in args) return failure(args.problem);
    const withVideo = (run: VideoTool) =>
      ctx.sheets ? run(ctx.sheets) : failure(needsVideo(ctx, call.name));
    switch (call.name) {
      case "look":
        return withVideo((sheets) => runLook(sheets, args.value));
      case "frames":
        return withVideo((sheets) => runFrames(sheets, args.value));
      // Older chats called a single-moment frame(t) tool.
      case "frame":
        return withVideo((sheets) => runFrames(sheets, { times: [args.value["t"]] }));
      case "note":
        return withVideo((sheets) => runNote(sheets, args.value));
      case "listen":
        return withVideo(({ file, info, video }) =>
          runListen({ file, info, video, ...(ctx.audio && { audio: ctx.audio }) }, args.value),
        );
      case "recall":
        return runRecall(ctx, args.value);
      case "ask":
        return ctx.ask ? runAsk(ctx.ask, args.value) : unknownTool(ctx, "ask");
      case "zoom":
        return isOffered(ctx, "zoom") ? runZoom(ctx, args.value) : unknownTool(ctx, "zoom");
      default:
        return unknownTool(ctx, call.name);
    }
  };
}

function toolNames({ tools }: ToolRunnerContext): string[] {
  return tools.map((tool) => tool.function.name);
}

function isOffered(ctx: ToolRunnerContext, name: string): boolean {
  return toolNames(ctx).includes(name);
}

function availableTools(ctx: ToolRunnerContext): string {
  const names = toolNames(ctx);
  const last = names.pop() ?? "";
  return `The tools are ${names.length > 0 ? `${names.join(", ")} and ${last}` : last}.`;
}

function unknownTool(ctx: ToolRunnerContext, name: string): ToolResult {
  return failure(`Unknown tool "${name}". ${availableTools(ctx)}`);
}

function needsVideo(ctx: ToolRunnerContext, name: string): string {
  return `${name} needs the chat's video, which is not loaded. ${availableTools(ctx)}`;
}

async function runLook(ctx: SheetContext, args: Args): Promise<ToolResult> {
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

async function runFrames(ctx: SheetContext, args: Args): Promise<ToolResult> {
  const requested = timesArg(args, "times", MAX_FRAMES_TIMES);
  if ("problem" in requested) return failure(requested.problem);
  const times = distinctMoments(
    requested.value.map((t) => clamp(t, 0, latestFrameTime(ctx.info.durationSeconds))),
  );
  return runRender(
    ctx,
    { ...exactTimes(times), outputResolution: ctx.resolution },
    `frames(${times.map(momentLabel).join(", ")})`,
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

function runNote(ctx: SheetContext, args: Args): ToolResult {
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

async function runRender(
  ctx: SheetContext,
  values: PlanOptionInput,
  call: string,
  adjustment?: string,
): Promise<ToolResult> {
  try {
    const images = await sheetRefs(ctx, values, call);
    const lines = adjustment === undefined ? [] : [adjustment];
    return { text: [...lines, describeSheets(images)].join("\n"), images };
  } catch (error) {
    return failure(`Rendering failed: ${errorText(error)}`);
  }
}

function describeSheets(images: ImageRef[]): string {
  const lines = images.flatMap((image) => sheetLine(image) ?? []);
  return [...lines, imagesFollow(images.length)].join("\n");
}
