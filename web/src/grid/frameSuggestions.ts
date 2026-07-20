/**
 * Suggests `framesPerGrid` values that make the best use of every full grid
 * sheet i.e. values where the packed rectangle
 *
 * This is distinct from, and deliberately ignores the trailing sheet's
 * leftover cells (when totalFrames isn't evenly divisible by framesPerGrid):
 * that last, partially-filled sheet is expected and not worth optimizing for.
 */
import { computeOptimalGrid } from "./gridMaths";


export function estimateExtractedFrameCount(
  startTime: number,
  endTime: number,
  targetFps: number,
  videoDuration?: number,
): number {
  const duration = endTime - startTime;
  if (duration <= 0 || targetFps <= 0) return 0;
  const naiveCount = Math.max(1, Math.floor(duration * targetFps));
  if (videoDuration === undefined) return naiveCount;

  let count = 0;
  for (let i = 0; i < naiveCount; i++) {
    const timestamp = startTime + i / targetFps;
    if (timestamp >= videoDuration) break;
    count++;
  }
  return Math.max(1, count);
}

export function countBlankCells(totalFrames: number, framesPerGrid: number): number {
  const remainder = totalFrames % framesPerGrid;
  return remainder === 0 ? 0 : framesPerGrid - remainder;
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
    const wastedCells = countGridPackingBlanks(framesPerGrid, sourceAspect, outputResolution, gutterPx);
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
