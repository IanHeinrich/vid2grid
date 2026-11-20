import { MAX_FRAMES_PER_SHEET, choosePerSheet, clamp, type SheetGeometry } from "./packing";

const MAX_OVERVIEW_SHEETS = 4;
const OVERVIEW_FRAMES_PER_SECOND = 2;
const MIN_OVERVIEW_PER_SHEET = 9;

export function overviewOptions(
  durationSeconds: number,
  maxImages: number,
  geometry: SheetGeometry,
): { frameCount: number; framesPerGrid: number } {
  const wantedFrames = Math.max(1, Math.round(durationSeconds * OVERVIEW_FRAMES_PER_SECOND));
  const widest = Math.min(MAX_FRAMES_PER_SHEET, wantedFrames);
  const narrowest = wantedFrames < MIN_OVERVIEW_PER_SHEET ? 1 : MIN_OVERVIEW_PER_SHEET;
  const framesPerGrid = choosePerSheet(narrowest, widest, widest, geometry);
  // Half the image cap stays free for zooms.
  const sheetCap = clamp(Math.floor(maxImages / 2), 1, MAX_OVERVIEW_SHEETS);
  const sheets = clamp(Math.floor(wantedFrames / framesPerGrid), 1, sheetCap);
  return { frameCount: sheets * framesPerGrid, framesPerGrid };
}
