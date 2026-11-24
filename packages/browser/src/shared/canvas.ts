import type { PlannedCrop } from "@vid2grid/core";

export interface Canvas2d {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export interface OffscreenCanvas2d {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

function requireContext<TContext>(ctx: TContext | null, label: string): TContext {
  if (!ctx) throw new Error(`${label} 2D context unavailable`);
  return ctx;
}

export function create2dCanvas(width: number, height: number): Canvas2d {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: requireContext(canvas.getContext("2d"), "Canvas") };
}

export function create2dOffscreenCanvas(width: number, height: number): OffscreenCanvas2d {
  const canvas = new OffscreenCanvas(width, height);
  return { canvas, ctx: requireContext(canvas.getContext("2d"), "OffscreenCanvas") };
}

// Each frame is drawn over the whole canvas, then captured.
export interface FrameCanvas extends Canvas2d {
  capture: () => Promise<ImageBitmap>;
}

export function createFrameCanvas(
  cell: { width: number; height: number },
  crop?: PlannedCrop,
): FrameCanvas {
  const scaled = createCellCanvas(cell.width, cell.height);
  if (!crop) return { ...scaled, capture: () => createImageBitmap(scaled.canvas) };
  const { x, y, width, height } = crop;
  const picture = createCellCanvas(crop.sourceWidth, crop.sourceHeight);
  return {
    ...picture,
    capture: () => {
      // A source rectangle, because scaling one takes no pixels from outside it.
      const source = [x, y, width, height] as const;
      scaled.ctx.drawImage(picture.canvas, ...source, 0, 0, cell.width, cell.height);
      return createImageBitmap(scaled.canvas);
    },
  };
}

export function createCellCanvas(width: number, height: number): Canvas2d {
  const cell = create2dCanvas(width, height);
  cell.ctx.imageSmoothingEnabled = true;
  cell.ctx.imageSmoothingQuality = "high";
  return cell;
}
