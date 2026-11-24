import type { PlanOptionInput } from "@vid2grid/core";
import { streamReply, textRequest } from "../api/modelCall";
import { addUsage } from "../api/usage";
import { blobToDataUrl } from "../dataUrl";
import { sheetLine } from "../imageRefs";
import { errorText } from "../text";
import { formatSpan } from "../time";
import type {
  ApiSettings,
  ContentPart,
  ImageRef,
  ModelInfo,
  StreamChat,
  VideoTimeline,
} from "../types";
import { roundForLabel, sheetRefs } from "./sheets";
import type { StudyPlan, StudyWindow, ZoomPlan } from "./studyPlan";
import { parseStudyReply, type StudiedWindow } from "./studyReply";
import type { ToolContext } from "./tools";
import { applyZoom, clampedInside, coarseContext } from "./zoom";

export {
  DEFAULT_WINDOW_SECONDS,
  newTimeline,
  planStudy,
  planZoom,
  type StudyEstimate,
  type StudyPlan,
  type StudyPlanInput,
  type StudyWindow,
  type Zoom,
  type ZoomPlan,
  type ZoomPlanInput,
} from "./studyPlan";
export { parseStudyReply, type StudyReply } from "./studyReply";

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
      return insideWindow(studied, range);
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

interface Pass<T extends StudyWindow> {
  name: string;
  steps: readonly T[];
  first: number;
  study(step: T, timeline: VideoTimeline): Promise<StudiedWindow>;
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
    let studied: StudiedWindow;
    try {
      studied = await pass.study(step, timeline);
    } catch (error) {
      if (signal.aborted) break;
      throw new Error(
        `${pass.name} ${index + 1} of ${pass.steps.length} (${formatSpan(step.startSeconds, step.endSeconds)}) failed: ${errorText(error)}`,
        { cause: error },
      );
    }
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

async function studyRange(
  deps: PassDeps,
  { range, frameCount, perSheet, call, system, notes }: RangeRequest,
): Promise<StudiedWindow> {
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
  // Cached sheets, and storing rendered ones, take no notice of a stop.
  signal.throwIfAborted();
  const parts = await sheetParts(ctx, refs);
  const caption = `Frames from ${formatSpan(range.startSeconds, range.endSeconds)} of the video.`;
  const texts = [caption, ...notes].map((text): ContentPart => ({ type: "text", text }));
  const request = textRequest(
    { modelId: deps.model.id, veniceParameters: deps.veniceParameters },
    [
      { role: "system", content: system },
      { role: "user", content: [...texts, ...parts] },
    ],
    { usage: true },
  );
  const { text, usage } = await streamReply(deps, request);
  const parsed = parseStudyReply(text, range);
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
