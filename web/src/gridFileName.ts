export function gridFileName(index: number): string {
  return `grid_${String(index + 1).padStart(4, "0")}.jpg`;
}
