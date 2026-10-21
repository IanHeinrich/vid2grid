// The lower bound wins when the bounds cross, so a range never shrinks below its minimum.
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
