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

export function createCellCanvas(width: number, height: number): Canvas2d {
  const cell = create2dCanvas(width, height);
  cell.ctx.imageSmoothingEnabled = true;
  cell.ctx.imageSmoothingQuality = "high";
  return cell;
}
