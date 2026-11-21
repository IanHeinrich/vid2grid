import type { AudioAnalysisProgress, PlanOptionInput, VideoInfo } from "@vid2grid/core";
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
import { imageLabel, recallName } from "../chat/history";
import { clamp } from "../spans";
import { errorText, plural } from "../text";
import { formatSpan, formatTimestamp } from "../time";
import type {
  AudioSpan,
  ImageRef,
  ImageStore,
  RunTool,
  SheetCache,
  ToolCall,
  ToolResult,
  ToolSchema,
  VideoAttachment,
  VideoAudio,
} from "../types";
import { overviewOptions } from "./overview";
import { MAX_FRAMES_PER_SHEET, choosePerSheet, type SheetGeometry } from "./packing";
import { renderSheets, type RenderedSheet } from "./render";
import { sheetCacheKey } from "./sheetCache";

const MAX_LOOK_FRAMES = 64;
const MAX_FRAMES_TIMES = 9;
// A frame at the very end of the video has nothing to decode, so keep the request inside it.
const END_MARGIN_SECONDS = 0.05;
const SAME_MOMENT_SECONDS = 0.05;
// Keyframe ranges are inclusive, so the end only has to sit past the last time.
const KEYFRAME_RANGE_PADDING_SECONDS = 0.01;
// Above 1 fps the burned-in timestamps show milliseconds, so 1:45.5 is not printed as 1:45.
const SUBSECOND_TIMESTAMP_FPS = 2;
const MAX_LISTEN_SECONDS = 600;
export const MAX_LISTEN_LINES = 150;

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "look",
      description:
        "Render frames from start to end of the video as grid images, perSheet frames per image. " +
        "Fewer frames per sheet means larger, more detailed frames: about 16 to 20 for a broad scan, 6 to 9 for a normal look, 1 to 4 to read fine detail. " +
        "frames and perSheet are adjusted so every sheet is full, with no blank space. Every frame has its timestamp printed on it.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "number", description: "Start time in seconds." },
          end: { type: "number", description: "End time in seconds." },
          frames: {
            type: "integer",
            minimum: 1,
            maximum: MAX_LOOK_FRAMES,
            description: "How many evenly spaced frames to take between start and end.",
          },
          perSheet: {
            type: "integer",
            minimum: 1,
            maximum: MAX_FRAMES_PER_SHEET,
            description:
              "Frames packed into each image, at most frames. Adjusted to fill the sheets.",
          },
        },
        required: ["start", "end", "frames", "perSheet"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "frames",
      description:
        "Render exactly these moments of the video on one image. Use it to check specific details. " +
        "One call with several times costs one image.",
      parameters: {
        type: "object",
        properties: {
          times: {
            type: "array",
            items: { type: "number" },
            minItems: 1,
            maxItems: MAX_FRAMES_TIMES,
            description: "Times in seconds, 1 to 9 of them.",
          },
        },
        required: ["times"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "note",
      description:
        "Record an observation in the scene log, which is kept for the rest of the chat.",
      parameters: {
        type: "object",
        properties: {
          t: { type: "number", description: "Time in seconds the observation is about." },
          text: { type: "string", description: "The observation." },
        },
        required: ["t", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description:
        "Attach earlier images again, by the names their stubs give, without rendering anything.",
      parameters: {
        type: "object",
        properties: {
          names: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: 'Image names as the stubs give them, e.g. "grid_0002 from look(60, 90)".',
          },
        },
        required: ["names"],
      },
    },
  },
];

// Listed only on a message with audio turned on, so the model is never offered it otherwise.
export const LISTEN_SCHEMA: ToolSchema = {
  type: "function",
  function: {
    name: "listen",
    description:
      "Read what is heard from start to end of the video: speech in quotes and sound events, one line each in time order. " +
      "The audio is analysed on the user's machine the first time a stretch is heard, which can take a while. " +
      "One call covers at most 10 minutes; call again from where it stopped for more.",
    parameters: {
      type: "object",
      properties: {
        start: { type: "number", description: "Start time in seconds." },
        end: {
          type: "number",
          description: "End time in seconds, at most 10 minutes after start.",
        },
      },
      required: ["start", "end"],
    },
  },
};

export function toolSchemas(audio: boolean): ToolSchema[] {
  return audio ? [...TOOL_SCHEMAS, LISTEN_SCHEMA] : TOOL_SCHEMAS;
}

// How to use the tools, the same for every voice; history adds the voice's answer style.
export const TOOL_GUIDANCE = [
  "The attached video is available through the look, frames and note tools.",
  "Scan with a dense look first (16 to 20 frames per sheet). When a detail is unclear, repeat that range with fewer frames per sheet (6 to 9 for a normal look, 1 to 4 for fine detail), or check the moments with frames, instead of guessing.",
  "Batch the specific moments you want into one frames call rather than one call per moment, and make several tool calls in one round rather than one per round.",
  "perSheet is adjusted to fill each sheet without blank space, and the result says what was actually rendered.",
  "Every frame has its timestamp printed on it.",
  "Older images become text stubs; recall one by its stub's name, and use note for anything worth remembering.",
].join("\n");

export interface ToolContext {
  file: File;
  info: VideoInfo;
  video: VideoAttachment;
  resolution: number;
  maxImages: number;
  store: ImageStore & SheetCache;
  // Picks the overview's resolution from its sheet count; absent means ctx.resolution.
  overviewResolution?: (sheets: number) => number;
  render?: typeof renderSheets;
  // Present only when the user turned audio on for this message.
  audio?: ListenContext;
  // The conversation's images so far, which recall finds by name; absent means none.
  knownImages?: () => readonly ImageRef[];
}

export interface ListenContext extends AudioDeps {
  signal?: AbortSignal;
  onProgress?: (progress: AudioAnalysisProgress) => void;
}

type Parsed<T> = { value: T } | { problem: string };
type Args = Record<string, unknown>;

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

export async function renderOverview(
  ctx: ToolContext,
  onProgress?: (done: number, total: number) => void,
): Promise<ImageRef[]> {
  const duration = ctx.info.durationSeconds;
  const sized = overviewOptions(duration, ctx.maxImages, sheetGeometry(ctx));
  const resolution = ctx.overviewResolution?.(sized.frameCount / sized.framesPerGrid);
  const values: PlanOptionInput = {
    startSeconds: 0,
    endSeconds: duration,
    ...(resolution === undefined
      ? sized
      : overviewOptions(duration, ctx.maxImages, sheetGeometry(ctx, resolution))),
    outputResolution: resolution ?? ctx.resolution,
  };
  return sheetRefs(ctx, values, "overview", onProgress === undefined ? {} : { onProgress });
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

function sheetGeometry(ctx: ToolContext, outputResolution = ctx.resolution): SheetGeometry {
  return { sourceAspect: ctx.info.width / ctx.info.height, outputResolution };
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

async function runListen(ctx: ToolContext, args: Args): Promise<ToolResult> {
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
  const closing = images.length === 1 ? "1 image follows." : `${images.length} images follow.`;
  const lines = [...images.map(imageLabel), ...problems.map((problem) => `Error: ${problem}`)];
  return { text: [...lines, closing].join("\n"), images };
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

export interface SheetRenderExtras {
  // Replaces the probed info, e.g. to hand the keyframe path the exact times to capture.
  info?: VideoInfo;
  onProgress?: (done: number, total: number) => void;
}

export async function sheetRefs(
  ctx: ToolContext,
  values: PlanOptionInput,
  call: string,
  { info = ctx.info, onProgress }: SheetRenderExtras = {},
): Promise<ImageRef[]> {
  const keyframes = values.keyframeSampling === true ? info.keyframeTimestampsSeconds : undefined;
  const key = sheetCacheKey(ctx.video.fileKey, values, keyframes);
  const cached = await ctx.store.getSheets(key);
  if (cached !== undefined) return cached;
  const render = ctx.render ?? renderSheets;
  const sheets = await render(ctx.file, info, values, onProgress);
  const { outputResolution } = values;
  const refs = await Promise.all(
    sheets.map((sheet) => storeSheet(ctx.store, sheet, call, outputResolution)),
  );
  await ctx.store.putSheets(key, refs);
  return refs;
}

async function storeSheet(
  store: ImageStore,
  sheet: RenderedSheet,
  call: string,
  resolution: number | undefined,
): Promise<ImageRef> {
  return {
    id: await store.putImage(sheet.blob),
    pinned: false,
    source: {
      kind: "sheet",
      call,
      name: sheet.name,
      startSeconds: sheet.startSeconds,
      endSeconds: sheet.endSeconds,
      frameCount: sheet.frameCount,
      ...(resolution === undefined ? {} : { resolution }),
    },
  };
}

export function sheetLine(ref: ImageRef): string | undefined {
  const { source } = ref;
  return source.kind === "sheet"
    ? `${source.name}: ${formatSpan(source.startSeconds, source.endSeconds)}, ${plural(source.frameCount, "frame")}`
    : undefined;
}

function describeSheets(images: ImageRef[]): string {
  const lines = images.flatMap((image) => sheetLine(image) ?? []);
  const closing = images.length === 1 ? "1 image follows." : `${images.length} images follow.`;
  return [...lines, closing].join("\n");
}

function parseArguments(call: ToolCall): Parsed<Args> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.arguments === "" ? "{}" : call.arguments);
  } catch {
    return { problem: "The arguments were not valid JSON. Send a JSON object." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { problem: "The arguments must be a JSON object." };
  }
  return { value: parsed as Args };
}

function numberArg(args: Args, name: string): Parsed<number> {
  const value = args[name];
  return typeof value === "number" && Number.isFinite(value)
    ? { value }
    : { problem: `${name} must be a finite number.` };
}

function timesArg(args: Args, name: string, max: number): Parsed<number[]> {
  const value: unknown = args[name];
  if (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= max &&
    value.every(isFiniteNumber)
  ) {
    return { value };
  }
  return { problem: `${name} must be an array of 1 to ${max} numbers in seconds.` };
}

function namesArg(args: Args, name: string): Parsed<string[]> {
  const value: unknown = args[name];
  if (Array.isArray(value) && value.length >= 1 && value.every(isNonEmptyString)) {
    return { value };
  }
  return { problem: `${name} must be an array of one or more image names.` };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integerArg(args: Args, name: string, min: number, max: number): Parsed<number> {
  const value = args[name];
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? { value }
    : { problem: `${name} must be an integer from ${min} to ${max}.` };
}

function failure(problem: string): ToolResult {
  return { text: `Error: ${problem}`, images: [] };
}

export function roundForLabel(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}

function latestFrameTime(durationSeconds: number): number {
  return Math.max(0, durationSeconds - END_MARGIN_SECONDS);
}
