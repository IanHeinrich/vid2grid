import { GUTTER_PX, countGridPackingBlanks } from "@vid2grid/core";

export const MAX_FRAMES_PER_SHEET = 20;

export interface SheetGeometry {
  sourceAspect: number;
  outputResolution: number;
}

// Fewest blank cells first, then nearest to the target, then the larger count.
export function choosePerSheet(
  min: number,
  max: number,
  target: number,
  geometry: SheetGeometry,
): number {
  let best = min;
  let bestRank = rankOf(min, target, geometry);
  for (let candidate = min + 1; candidate <= max; candidate++) {
    const rank = rankOf(candidate, target, geometry);
    if (isBetter(rank, bestRank)) {
      best = candidate;
      bestRank = rank;
    }
  }
  return best;
}

interface Rank {
  blanks: number;
  distance: number;
  perSheet: number;
}

function rankOf(perSheet: number, target: number, geometry: SheetGeometry): Rank {
  const blanks = countGridPackingBlanks(perSheet, { ...geometry, gutterPx: GUTTER_PX });
  return { blanks: blanks ?? Infinity, distance: Math.abs(perSheet - target), perSheet };
}

function isBetter(a: Rank, b: Rank): boolean {
  if (a.blanks !== b.blanks) return a.blanks < b.blanks;
  if (a.distance !== b.distance) return a.distance < b.distance;
  return a.perSheet > b.perSheet;
}
