import type { GridLayout } from "../grid/gridMaths";
import type { TimestampFormat } from "./timestampFormat";

/**
 * A single collage sheet's worth of frames plus the geometry needed to paint it.
 *
 * `TImage` is whatever the host's frame capture produced (an `ImageBitmap` in
 * the browser), so a sheet stays transfer friendly and can be shipped to a
 * render worker unchanged.
 */
export interface CollageSheetInput<TImage> {
  images: TImage[];
  timestamps: number[];
  frameIndices: number[];
  layout: GridLayout;
  outputResolution: number;
  gutterPx: number;
  timestampFormat: TimestampFormat;
}
