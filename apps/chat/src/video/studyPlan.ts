import { modelVisionProfile } from "@vid2grid/core";
import { usageCostUsd } from "../api/usage";
import { FALLBACK_IMAGE_TOKENS } from "../chat/tokenEstimate";
import { clamp, mergeSpans } from "../spans";
import type { ModelInfo, StudyPlanOptions, UnclearSpan, VideoTimeline } from "../types";
import { MAX_FRAMES_PER_SHEET, choosePerSheet } from "./packing";

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
