// Declared structurally so core never names a DOM type: a browser
// CanvasRenderingContext2D and a worker OffscreenCanvasRenderingContext2D both
// satisfy it as-is. fillStyle/strokeStyle are unknown because the DOM lib's
// colour-or-gradient-or-pattern union is not assignable to string.
export interface SheetContext2D<TImage> {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: "round" | "bevel" | "miter";
  textBaseline: "alphabetic" | "bottom" | "hanging" | "ideographic" | "middle" | "top";
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: "low" | "medium" | "high";
  font: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: TImage, x: number, y: number, w: number, h: number): void;
  measureText(text: string): { width: number };
  strokeText(text: string, x: number, y: number): void;
  fillText(text: string, x: number, y: number): void;
}
