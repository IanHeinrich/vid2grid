// The suggestions judge a full sheet's packing only: a partially-filled trailing sheet is
// expected, so its leftover cells are deliberately ignored.
import { Vid2GridError } from "../errors";
import { computeOptimalGrid, type GridParams } from "../grid/gridMaths";
import { planFrameTimestamps } from "./framePlanning";
import type { VideoInfo } from "../probe/videoInfo";
import { samplingRangeProblem, type CollagePlanRequest, type SamplingRange } from "./request";

export const KEYFRAME_DENSE_PER_SECOND = 2;

export interface FrameCountEstimateInput extends SamplingRange {
  durationSeconds?: number;
  frameCount?: number;
}

// Runs the planner's own sampling so the UI's estimate cannot drift from the plan.
// The fields the sampling never reads are filled with placeholders.
export function estimateExtractedFrameCount(input: FrameCountEstimateInput): number {
  if (samplingRangeProblem(input) !== undefined) return 0;
  const request: CollagePlanRequest = {
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    targetFps: input.targetFps,
    ...(input.frameCount !== undefined && { frameCount: input.frameCount }),
    framesPerGrid: 1,
    outputResolution: 1,
    jpegQuality: 1,
  };
  const info: VideoInfo = {
    durationSeconds: input.durationSeconds ?? Infinity,
    width: 1,
    height: 1,
  };
  return planFrameTimestamps(request, info).length;
}

export function estimateSheetCount(totalFrames: number, framesPerGrid: number): number {
  if (totalFrames <= 0 || framesPerGrid <= 0) return 0;
  return Math.ceil(totalFrames / framesPerGrid);
}

export function keyframesPerSecond(keyframeCount: number, rangeSeconds: number): number {
  return rangeSeconds > 0 ? keyframeCount / rangeSeconds : 0;
}

export function isKeyframeDense(keyframeCount: number, rangeSeconds: number): boolean {
  return keyframesPerSecond(keyframeCount, rangeSeconds) >= KEYFRAME_DENSE_PER_SECOND;
}

export function countGridPackingBlanks(framesPerGrid: number, grid: GridParams): number | null {
  if (framesPerGrid <= 0) return null;
  try {
    const layout = computeOptimalGrid(framesPerGrid, grid);
    return layout.cols * layout.rows - framesPerGrid;
  } catch (err) {
    if (err instanceof Vid2GridError && err.code === "invalid_request") return null;
    throw err;
  }
}

export interface FramesPerGridSuggestion {
  framesPerGrid: number;
  wastedCells: number;
  sheets: number;
}

export interface SuggestFramesPerGridInput {
  totalFrames: number;
  currentValue: number;
  grid: GridParams;
  searchRadius?: number;
  maxSuggestions?: number;
}

export function suggestFramesPerGrid({
  totalFrames,
  currentValue,
  grid,
  searchRadius = 12,
  maxSuggestions = 4,
}: SuggestFramesPerGridInput): FramesPerGridSuggestion[] {
  if (totalFrames <= 0 || currentValue <= 0) return [];

  const candidates: FramesPerGridSuggestion[] = [];
  const min = Math.max(1, currentValue - searchRadius);
  const max = currentValue + searchRadius;
  for (let framesPerGrid = min; framesPerGrid <= max; framesPerGrid++) {
    if (framesPerGrid === currentValue) continue;
    const wastedCells = countGridPackingBlanks(framesPerGrid, grid);
    if (wastedCells === null) continue;
    candidates.push({
      framesPerGrid,
      wastedCells,
      sheets: estimateSheetCount(totalFrames, framesPerGrid),
    });
  }

  candidates.sort((a, b) => {
    if (a.wastedCells !== b.wastedCells) return a.wastedCells - b.wastedCells;
    return Math.abs(a.framesPerGrid - currentValue) - Math.abs(b.framesPerGrid - currentValue);
  });

  return candidates.slice(0, maxSuggestions);
}
