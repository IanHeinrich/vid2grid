import type { GridLayout } from "../grid/gridMaths";
import type { TimestampFormat } from "./timestampFormat";

/** `TImage` stays the host's own capture type (an `ImageBitmap` in the browser) so a sheet
 * remains transfer-friendly and can be posted to a render worker unchanged. */
export interface CollageSheetInput<TImage> {
  images: TImage[];
  timestamps: number[];
  frameIndices: number[];
  layout: GridLayout;
  outputResolution: number;
  gutterPx: number;
  timestampFormat: TimestampFormat;
}
