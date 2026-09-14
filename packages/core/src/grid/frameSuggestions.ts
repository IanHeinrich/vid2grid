// The suggestions judge a full sheet's packing only: a partially-filled trailing sheet is
// expected, so its leftover cells are deliberately ignored.
import { computeOptimalGrid } from "./gridMaths";
import { planFrameTimestamps } from "../plan/framePlanning";
import type { CollagePlanRequest, VideoInfo } from "../types";

// Runs the planner's own sampling so the UI's estimate cannot drift from the plan.
// The fields the sampling never reads are filled with placeholders.
export function estimateExtractedFrameCount(
  startSeconds: number,
  endSeconds: number,
  targetFps: number,
  durationSeconds?: number,
  frameCount?: number,
): number {
  if (endSeconds <= startSeconds || targetFps <= 0) return 0;
  const request: CollagePlanRequest = {
    startSeconds,
    endSeconds,
    targetFps,
    frameCount,
    framesPerGrid: 1,
    outputResolution: 1,
    jpegQuality: 1,
  };
  const info: VideoInfo = {
    durationSeconds: durationSeconds ?? Infinity,
    width: 1,
    height: 1,
  };
  return planFrameTimestamps(request, info).length;
}

export function estimateSheetCount(totalFrames: number, framesPerGrid: number): number {
  if (totalFrames <= 0 || framesPerGrid <= 0) return 0;
  return Math.ceil(totalFrames / framesPerGrid);
}

export function countGridPackingBlanks(
  framesPerGrid: number,
  sourceAspect: number,
  outputResolution: number,
  gutterPx: number,
): number | null {
  if (framesPerGrid <= 0) return null;
  try {
    const layout = computeOptimalGrid(framesPerGrid, sourceAspect, outputResolution, gutterPx);
    return layout.cols * layout.rows - framesPerGrid;
  } catch {
    return null;
  }
}

export interface FramesPerGridSuggestion {
  framesPerGrid: number;
  wastedCells: number;
  sheets: number;
}

export function suggestFramesPerGrid(
  totalFrames: number,
  currentValue: number,
  sourceAspect: number,
  outputResolution: number,
  gutterPx: number,
  searchRadius = 12,
  maxSuggestions = 4,
): FramesPerGridSuggestion[] {
  if (totalFrames <= 0 || currentValue <= 0) return [];

  const candidates: FramesPerGridSuggestion[] = [];
  const min = Math.max(1, currentValue - searchRadius);
  const max = currentValue + searchRadius;
  for (let framesPerGrid = min; framesPerGrid <= max; framesPerGrid++) {
    if (framesPerGrid === currentValue) continue;
    const wastedCells = countGridPackingBlanks(
      framesPerGrid,
      sourceAspect,
      outputResolution,
      gutterPx,
    );
    if (wastedCells === null) continue;
    candidates.push({
      framesPerGrid,
      wastedCells,
      sheets: Math.ceil(totalFrames / framesPerGrid),
    });
  }

  candidates.sort((a, b) => {
    if (a.wastedCells !== b.wastedCells) return a.wastedCells - b.wastedCells;
    return Math.abs(a.framesPerGrid - currentValue) - Math.abs(b.framesPerGrid - currentValue);
  });

  return candidates.slice(0, maxSuggestions);
}
