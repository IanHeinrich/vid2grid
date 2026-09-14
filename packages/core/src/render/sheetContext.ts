/** Structural so core names no DOM type; both canvas 2D contexts satisfy it as-is. The style
 * fields are `unknown` because the DOM lib's colour-or-gradient-or-pattern union rejects `string`. */
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
