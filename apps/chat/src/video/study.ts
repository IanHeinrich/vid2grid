import { modelVisionProfile, type PlanOptionInput } from "@vid2grid/core";
import { textRequest } from "../api/modelCall";
import { addUsage, usageCostUsd } from "../api/usage";
import { FALLBACK_IMAGE_TOKENS } from "../chat/tokenEstimate";
import { blobToDataUrl } from "../dataUrl";
import { clamp, mergeSpans } from "../spans";
import { errorText } from "../text";
import { CLOCK_TIME, clockSeconds, formatSpan } from "../time";
import type {
  ApiSettings,
  ChatRequest,
  ContentPart,
  ImageRef,
  ModelInfo,
  StreamChat,
  StudyPlanOptions,
  TimelineEntry,
  TokenUsage,
  UnclearSpan,
  VideoTimeline,
} from "../types";
import { MAX_FRAMES_PER_SHEET, choosePerSheet } from "./packing";
import { roundForLabel, sheetLine, sheetRefs, type ToolContext } from "./tools";

export const DEFAULT_WINDOW_SECONDS = 45;
const MAX_SHEETS_PER_WINDOW = 2;
const MAX_REQUESTED_SHEETS_PER_WINDOW = 4;
const MIN_STUDY_PER_SHEET = 12;
const TARGET_STUDY_PER_SHEET = 18;
const STUDY_FRAMES_PER_SECOND = 1;
const TEXT_INPUT_TOKENS_PER_WINDOW = 600;
const OUTPUT_TOKENS_PER_WINDOW = 700;
const REPLY_SECONDS_PER_WINDOW = 20;
const RENDER_SECONDS_PER_SHEET = 3;

const ZOOM_PADDING_SECONDS = 1;
const ZOOM_MERGE_GAP_SECONDS = 0.5;
const MAX_ZOOM_SECONDS = 15;
const MAX_ZOOMS_PER_PASS = 20;
const ZOOM_FRAMES_PER_SECOND = 4;
const MIN_ZOOM_PER_SHEET = 4;
const MAX_ZOOM_PER_SHEET = 9;
const TARGET_ZOOM_PER_SHEET = 6;
const MAX_SHEETS_PER_ZOOM = 3;

const FACTUAL_COVERAGE = [
  "Describe everything visible plainly and factually. Do not skip, soften or speculate beyond what is visible. Cover:",
  "- people: appearance, clothing, expressions, body language, positions;",
  "- actions and interactions, in order;",
  "- setting, lighting, camera angle and movement;",
  "- any on-screen text;",
  "- what changes between frames.",
  "Each frame has its timestamp printed on it.",
];

const ENTRY_FORMAT =
  "Output only lines of the form [m:ss.s-m:ss.s] description (or [m:ss] description for one moment), in time order, a new line whenever something changes";

export const STUDY_SYSTEM_PROMPT = [
  "You are building a reference timeline of a video for another assistant, which will rely on it later.",
  ...FACTUAL_COVERAGE,
  `${ENTRY_FORMAT}.`,
  "Where a moment is too small, fast or ambiguous to describe confidently, still write its entry, then add a line UNCLEAR [m:ss.s-m:ss.s] what could not be made out, in time order beside that entry.",
  "UNCLEAR lines are the only other lines allowed; use them sparingly. Write no other text.",
].join("\n");

export const ZOOM_SYSTEM_PROMPT = [
  "You are refining part of a reference timeline of a video for another assistant, which will rely on it later.",
  "You get dense frames from one short stretch and the coarse timeline of the same stretch, written from fewer frames.",
  "Lines marked unclear say what the coarse pass could not make out; look for that first.",
  "Write a more precise timeline from these frames, following them wherever they disagree with the coarse timeline. Write entries only within this stretch.",
  ...FACTUAL_COVERAGE,
  "Where something still cannot be made out, say so inside that entry's text.",
  `${ENTRY_FORMAT}, with no other text.`,
].join("\n");

export interface StudyPlanInput extends StudyPlanOptions {
  durationSeconds: number;
  sourceAspect: number;
  resolution: number;
  model: ModelInfo;
}

export interface StudyEstimate {
  requests: number;
  images: number;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  seconds: number;
  approximate: boolean;
}

export interface StudyWindow {
  startSeconds: number;
  endSeconds: number;
}

export interface StudyPlan {
  windows: StudyWindow[];
  framesPerWindow: number;
  perSheet: number;
  sheetsPerWindow: number;
  estimate: StudyEstimate;
}

export function planStudy(input: StudyPlanInput): StudyPlan {
  const windowSeconds = input.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const startSeconds = clamp(input.startSeconds ?? 0, 0, input.durationSeconds);
  const endSeconds = clamp(
    input.endSeconds ?? input.durationSeconds,
    startSeconds,
    input.durationSeconds,
  );
  const windows = studyWindows(startSeconds, endSeconds, windowSeconds);
  const geometry = { sourceAspect: input.sourceAspect, outputResolution: input.resolution };
  const perSheet = choosePerSheet(
    MIN_STUDY_PER_SHEET,
    MAX_FRAMES_PER_SHEET,
    TARGET_STUDY_PER_SHEET,
    geometry,
  );
  const firstSpan = windows[0] === undefined ? 0 : windows[0].endSeconds - windows[0].startSeconds;
  const sheetCap =
    input.framesPerWindow === undefined ? MAX_SHEETS_PER_WINDOW : MAX_REQUESTED_SHEETS_PER_WINDOW;
  const maxSheets = Math.max(1, Math.min(sheetCap, input.model.maxImages));
  const wantedFrames = input.framesPerWindow ?? firstSpan * STUDY_FRAMES_PER_SECOND;
  const wantedSheets = Math.round(wantedFrames / perSheet);
  const sheetsPerWindow = Math.min(maxSheets, Math.max(1, wantedSheets));
  return {
    windows,
    framesPerWindow: sheetsPerWindow * perSheet,
    perSheet,
    sheetsPerWindow,
    estimate: estimateStudy(windows.length, windows.length * sheetsPerWindow, input),
  };
}

function studyWindows(
  startSeconds: number,
  endSeconds: number,
  windowSeconds: number,
): StudyWindow[] {
  // Rounding rather than flooring lets the last window absorb a remainder under half a window.
  const count = Math.max(1, Math.round((endSeconds - startSeconds) / windowSeconds));
  return Array.from({ length: count }, (_, index) => ({
    startSeconds: startSeconds + index * windowSeconds,
    endSeconds: index === count - 1 ? endSeconds : startSeconds + (index + 1) * windowSeconds,
  }));
}

function estimateStudy(
  requests: number,
  images: number,
  { model, resolution }: Pick<StudyPlanInput, "model" | "resolution">,
): StudyEstimate {
  const imageTokens = modelVisionProfile(model.id).imageTokens?.(resolution);
  const inputTokens =
    images * (imageTokens ?? FALLBACK_IMAGE_TOKENS) + requests * TEXT_INPUT_TOKENS_PER_WINDOW;
  const outputTokens = requests * OUTPUT_TOKENS_PER_WINDOW;
  const costUsd = usageCostUsd(
    { promptTokens: inputTokens, completionTokens: outputTokens },
    model.pricing,
  );
  return {
    requests,
    images,
    inputTokens,
    outputTokens,
    ...(costUsd !== undefined && { costUsd }),
    seconds: requests * REPLY_SECONDS_PER_WINDOW + images * RENDER_SECONDS_PER_SHEET,
    approximate: imageTokens === undefined,
  };
}

export interface ZoomPlanInput extends Omit<StudyPlanInput, keyof StudyPlanOptions> {
  unclear: readonly UnclearSpan[];
  // The study's From and To, so padding stays inside the studied range.
  startSeconds?: number;
  endSeconds?: number;
}

export interface Zoom extends StudyWindow {
  frameCount: number;
  sheets: number;
}

export interface ZoomPlan {
  zooms: Zoom[];
  perSheet: number;
  estimate: StudyEstimate;
}

// Spans past the cap stay flagged, so another pass picks them up.
export function planZoom(input: ZoomPlanInput): ZoomPlan {
  const startSeconds = clamp(input.startSeconds ?? 0, 0, input.durationSeconds);
  const endSeconds = clamp(
    input.endSeconds ?? input.durationSeconds,
    startSeconds,
    input.durationSeconds,
  );
  const spans = zoomSpans(input.unclear, { startSeconds, endSeconds }).slice(0, MAX_ZOOMS_PER_PASS);
  const perSheet = choosePerSheet(MIN_ZOOM_PER_SHEET, MAX_ZOOM_PER_SHEET, TARGET_ZOOM_PER_SHEET, {
    sourceAspect: input.sourceAspect,
    outputResolution: input.resolution,
  });
  const maxSheets = Math.max(1, Math.min(MAX_SHEETS_PER_ZOOM, input.model.maxImages));
  const zooms = spans.map((span): Zoom => {
    const wantedFrames = (span.endSeconds - span.startSeconds) * ZOOM_FRAMES_PER_SECOND;
    const sheets = Math.min(maxSheets, Math.max(1, Math.round(wantedFrames / perSheet)));
    return { ...span, sheets, frameCount: sheets * perSheet };
  });
  const images = zooms.reduce((total, zoom) => total + zoom.sheets, 0);
  return { zooms, perSheet, estimate: estimateStudy(zooms.length, images, input) };
}

// An edge left by an earlier zoom of the same span is not padded back into the zoomed part.
function zoomSpans(unclear: readonly UnclearSpan[], bounds: StudyWindow): StudyWindow[] {
  const zoomedPiece = (span: UnclearSpan, touches: (piece: UnclearSpan) => boolean) =>
    unclear.some(
      (piece) => piece.zoomed === true && piece.reason === span.reason && touches(piece),
    );
  const padded = unclear
    .filter((span) => span.zoomed !== true)
    .map((span) => {
      const zoomedBefore = zoomedPiece(span, (piece) => piece.endSeconds === span.startSeconds);
      const zoomedAfter = zoomedPiece(span, (piece) => piece.startSeconds === span.endSeconds);
      const startPad = zoomedBefore ? 0 : ZOOM_PADDING_SECONDS;
      const endPad = zoomedAfter ? 0 : ZOOM_PADDING_SECONDS;
      return {
        startSeconds: clamp(span.startSeconds - startPad, bounds.startSeconds, bounds.endSeconds),
        endSeconds: clamp(span.endSeconds + endPad, bounds.startSeconds, bounds.endSeconds),
      };
    });
  const merged = mergeSpans(padded, ZOOM_MERGE_GAP_SECONDS);
  return merged.filter((span) => span.endSeconds > span.startSeconds).flatMap(splitSpan);
}

function splitSpan(span: StudyWindow): StudyWindow[] {
  const length = span.endSeconds - span.startSeconds;
  const parts = Math.ceil(length / MAX_ZOOM_SECONDS);
  const step = length / parts;
  return Array.from({ length: parts }, (_, index) => ({
    startSeconds: span.startSeconds + index * step,
    endSeconds: index === parts - 1 ? span.endSeconds : span.startSeconds + (index + 1) * step,
  }));
}

export function newTimeline(
  fileKey: string,
  modelId: string,
  plan: StudyPlan,
  now: number,
): VideoTimeline {
  return {
    fileKey,
    modelId,
    entries: [],
    nextWindow: 0,
    windowCount: plan.windows.length,
    updatedAt: now,
  };
}

export interface StudyDeps {
  ctx: ToolContext;
  plan: StudyPlan;
  model: ModelInfo;
  api: ApiSettings;
  streamChat: StreamChat;
  veniceParameters: boolean;
  timeline: VideoTimeline;
  saveTimeline(timeline: VideoTimeline): Promise<void>;
  signal: AbortSignal;
  onProgress(timeline: VideoTimeline): void;
}

export function runStudy(deps: StudyDeps): Promise<VideoTimeline> {
  const { plan } = deps;
  return runPass(deps, {
    name: "Study window",
    steps: plan.windows,
    first: deps.timeline.nextWindow,
    study: async (range) => {
      const studied = await studyRange(deps, {
        range,
        frameCount: plan.framesPerWindow,
        perSheet: plan.perSheet,
        call: "study",
        system: STUDY_SYSTEM_PROMPT,
        notes: [],
      });
      return studied && insideWindow(studied, range);
    },
    apply: (timeline, _range, studied, index) => {
      const unclear = [...(timeline.unclear ?? []), ...studied.unclear];
      const usage = addUsage(timeline.usage, studied.usage);
      return {
        ...timeline,
        entries: [...timeline.entries, ...studied.entries],
        nextWindow: index + 1,
        updatedAt: Date.now(),
        ...(unclear.length > 0 && { unclear }),
        ...(usage !== undefined && { usage }),
      };
    },
  });
}

// A window with nothing in it would read as studied, leaving a hole that resume never fills.
function insideWindow(studied: StudiedWindow, range: StudyWindow): StudiedWindow {
  const entries = clampedInside(studied.entries, range);
  if (entries.length === 0 && studied.unclear.length === 0) {
    throw new Error("The reply had nothing for this window.");
  }
  return { ...studied, entries };
}

export interface ZoomDeps extends Omit<StudyDeps, "plan"> {
  plan: ZoomPlan;
  // The timeline as shown now, so edits made while zooming are kept.
  current?: () => VideoTimeline;
}

export function runZoom(deps: ZoomDeps): Promise<VideoTimeline> {
  const { plan } = deps;
  const latest = (timeline: VideoTimeline) => deps.current?.() ?? timeline;
  return runPass(deps, {
    name: "Zoom",
    steps: plan.zooms,
    first: 0,
    study: (zoom, timeline) =>
      studyRange(deps, {
        range: zoom,
        frameCount: zoom.frameCount,
        perSheet: plan.perSheet,
        call: "zoom",
        system: ZOOM_SYSTEM_PROMPT,
        notes: [coarseContext(latest(timeline), zoom)],
      }),
    apply: (timeline, zoom, studied) => applyZoom(latest(timeline), zoom, studied),
  });
}

function overlaps(span: StudyWindow, range: StudyWindow): boolean {
  return span.startSeconds <= range.endSeconds && span.endSeconds >= range.startSeconds;
}

function overlapSeconds(span: StudyWindow, range: StudyWindow): number {
  return (
    Math.min(span.endSeconds, range.endSeconds) - Math.max(span.startSeconds, range.startSeconds)
  );
}

function coarseContext(timeline: VideoTimeline, zoom: StudyWindow): string {
  const entries = timeline.entries
    .filter((entry) => overlaps(entry, zoom))
    .map((entry) => `[${formatSpan(entry.startSeconds, entry.endSeconds)}] ${entry.text}`);
  const unclear = (timeline.unclear ?? [])
    .filter((span) => span.zoomed !== true && overlaps(span, zoom))
    .map((span) => `[${formatSpan(span.startSeconds, span.endSeconds)}] unclear: ${span.reason}`);
  const lines = [...entries, ...unclear];
  return lines.length === 0
    ? "The coarse timeline has nothing for this stretch."
    : ["Coarse timeline for this stretch:", ...lines].join("\n");
}

// A reply with no entries leaves the coarse entries and the flag, so the zoom can be retried.
function applyZoom(
  timeline: VideoTimeline,
  zoom: StudyWindow,
  studied: StudiedWindow,
): VideoTimeline {
  const usage = addUsage(timeline.usage, studied.usage);
  const withUsage = { ...timeline, updatedAt: Date.now(), ...(usage !== undefined && { usage }) };
  const zoomed = clampedInside(studied.entries, zoom).map((entry): TimelineEntry => ({
    ...entry,
    zoomed: true,
  }));
  if (zoomed.length === 0) return withUsage;
  const mostlyInside = (entry: TimelineEntry) =>
    overlapSeconds(entry, zoom) >= (entry.endSeconds - entry.startSeconds) / 2;
  const entries = [...timeline.entries.filter((entry) => !mostlyInside(entry)), ...zoomed].sort(
    (a, b) => a.startSeconds - b.startSeconds,
  );
  return { ...withUsage, entries, unclear: markZoomed(timeline.unclear ?? [], zoom) };
}

// A moment counts when it lies in the zoom; a longer entry only when it runs into it.
function touchesInside(entry: StudyWindow, zoom: StudyWindow): boolean {
  const overlap = overlapSeconds(entry, zoom);
  return overlap > 0 || (overlap === 0 && entry.startSeconds === entry.endSeconds);
}

function clampedInside(entries: readonly TimelineEntry[], span: StudyWindow): TimelineEntry[] {
  return entries
    .filter((entry) => touchesInside(entry, span))
    .map((entry) => {
      const startSeconds = clamp(entry.startSeconds, span.startSeconds, span.endSeconds);
      const endSeconds = clamp(entry.endSeconds, startSeconds, span.endSeconds);
      return { ...entry, startSeconds, endSeconds };
    });
}

// The part of a span the zoom covered is marked; any part outside it stays flagged.
function markZoomed(unclear: readonly UnclearSpan[], zoom: StudyWindow): UnclearSpan[] {
  return unclear.flatMap((span): UnclearSpan[] => {
    if (span.zoomed === true || !overlaps(span, zoom)) return [span];
    const covered: UnclearSpan = {
      ...span,
      startSeconds: Math.max(span.startSeconds, zoom.startSeconds),
      endSeconds: Math.min(span.endSeconds, zoom.endSeconds),
      zoomed: true,
    };
    const before = span.startSeconds < zoom.startSeconds;
    const after = span.endSeconds > zoom.endSeconds;
    return [
      ...(before ? [{ ...span, endSeconds: zoom.startSeconds }] : []),
      covered,
      ...(after ? [{ ...span, startSeconds: zoom.endSeconds }] : []),
    ];
  });
}

interface StudiedWindow {
  entries: TimelineEntry[];
  unclear: UnclearSpan[];
  usage?: TokenUsage;
}

interface Pass<T extends StudyWindow> {
  name: string;
  steps: readonly T[];
  first: number;
  study(step: T, timeline: VideoTimeline): Promise<StudiedWindow | undefined>;
  apply(timeline: VideoTimeline, step: T, studied: StudiedWindow, index: number): VideoTimeline;
}

type PassDeps = Omit<StudyDeps, "plan">;

async function runPass<T extends StudyWindow>(
  deps: PassDeps,
  pass: Pass<T>,
): Promise<VideoTimeline> {
  const { signal } = deps;
  let timeline = deps.timeline;
  for (let index = pass.first; index < pass.steps.length; index++) {
    const step = pass.steps[index];
    if (step === undefined || signal.aborted) break;
    let studied: StudiedWindow | undefined;
    try {
      studied = await pass.study(step, timeline);
    } catch (error) {
      if (signal.aborted) break;
      throw new Error(
        `${pass.name} ${index + 1} of ${pass.steps.length} (${formatSpan(step.startSeconds, step.endSeconds)}) failed: ${errorText(error)}`,
        { cause: error },
      );
    }
    if (studied === undefined) break;
    timeline = pass.apply(timeline, step, studied, index);
    await deps.saveTimeline(timeline);
    deps.onProgress(timeline);
  }
  return timeline;
}

interface RangeRequest {
  range: StudyWindow;
  frameCount: number;
  perSheet: number;
  call: string;
  system: string;
  // Text sent after the caption and before the sheets.
  notes: string[];
}

// Undefined when aborted: a render cannot be cancelled, so its result is dropped instead.
async function studyRange(
  deps: PassDeps,
  { range, frameCount, perSheet, call, system, notes }: RangeRequest,
): Promise<StudiedWindow | undefined> {
  const { ctx, signal } = deps;
  const values: PlanOptionInput = {
    startSeconds: range.startSeconds,
    endSeconds: range.endSeconds,
    frameCount,
    framesPerGrid: perSheet,
    outputResolution: ctx.resolution,
  };
  const refs = await sheetRefs(
    ctx,
    values,
    `${call}(${roundForLabel(range.startSeconds)}, ${roundForLabel(range.endSeconds)})`,
  );
  if (signal.aborted) return undefined;
  const parts = await sheetParts(ctx, refs);
  const caption = `Frames from ${formatSpan(range.startSeconds, range.endSeconds)} of the video.`;
  const texts = [caption, ...notes].map((text): ContentPart => ({ type: "text", text }));
  const request: ChatRequest = {
    ...textRequest({ modelId: deps.model.id, veniceParameters: deps.veniceParameters }, [
      { role: "system", content: system },
      { role: "user", content: [...texts, ...parts] },
    ]),
    stream_options: { include_usage: true },
  };
  let reply = "";
  let usage: TokenUsage | undefined;
  for await (const event of deps.streamChat(deps.api, request, signal)) {
    if (event.type === "text") reply += event.delta;
    if (event.type === "usage") usage = event.usage;
  }
  if (signal.aborted) return undefined;
  const parsed = parseStudyReply(reply, range);
  return usage === undefined ? parsed : { ...parsed, usage };
}

async function sheetParts(ctx: ToolContext, refs: readonly ImageRef[]): Promise<ContentPart[]> {
  const parts = await Promise.all(
    refs.map(async (ref): Promise<ContentPart[]> => {
      const blob = await ctx.store.getImage(ref.id);
      if (blob === undefined) throw new Error(`Sheet image ${ref.id} is missing from the store`);
      return [
        { type: "text", text: sheetLine(ref) ?? ref.id },
        { type: "image_url", image_url: { url: await blobToDataUrl(blob) } },
      ];
    }),
  );
  return parts.flat();
}

const SPAN_AND_TEXT = String.raw`\[?\s*${CLOCK_TIME}(?:\s*(?:-|–|—|to)\s*${CLOCK_TIME})?\s*\]?\s*[:–—-]?\s*(.*)$`;
const BULLET = String.raw`^\s*(?:[-*•]\s*)?`;
const ENTRY_LINE = new RegExp(`${BULLET}${SPAN_AND_TEXT}`);
const UNCLEAR_LINE = new RegExp(String.raw`${BULLET}UNCLEAR\b\s*:?\s*${SPAN_AND_TEXT}`, "i");

export interface StudyReply {
  entries: TimelineEntry[];
  unclear: UnclearSpan[];
}

export function parseStudyReply(reply: string, range: StudyWindow): StudyReply {
  const entries: TimelineEntry[] = [];
  const unclear: UnclearSpan[] = [];
  let extend: ((text: string) => void) | undefined;
  let flaggedAny = false;
  for (const line of reply.split(/\r?\n/)) {
    const text = line.trim();
    if (text === "") continue;
    const flagged = UNCLEAR_LINE.exec(text);
    const match = flagged ?? ENTRY_LINE.exec(text);
    if (match === null) {
      extend?.(text);
      continue;
    }
    flaggedAny ||= flagged !== null;
    const start = clockSeconds(match.slice(1, 4));
    const end = match[5] === undefined ? start : clockSeconds(match.slice(4, 7));
    const body = (match[7] ?? "").trim();
    if (flagged === null) {
      const entry: TimelineEntry = { startSeconds: start, endSeconds: end, text: body };
      entries.push(entry);
      extend = (more) => {
        entry.text = `${entry.text} ${more}`.trim();
      };
    } else if (!touchesInside({ startSeconds: start, endSeconds: end }, range)) {
      extend = undefined;
    } else {
      const startSeconds = clamp(start, range.startSeconds, range.endSeconds);
      const span: UnclearSpan = {
        startSeconds,
        endSeconds: clamp(end, startSeconds, range.endSeconds),
        reason: body,
      };
      unclear.push(span);
      extend = (more) => {
        span.reason = `${span.reason} ${more}`.trim();
      };
    }
  }
  const usable = entries.filter((entry) => entry.text !== "");
  const whole = reply.trim();
  if (usable.length > 0 || flaggedAny || whole === "") return { entries: usable, unclear };
  return {
    entries: [{ startSeconds: range.startSeconds, endSeconds: range.endSeconds, text: whole }],
    unclear,
  };
}
