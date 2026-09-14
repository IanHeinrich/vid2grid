/** Gaps between sheets split at their midpoint, so every cue lands in exactly one window. */
export function computeSheetWindows(
  sheets: { timestamps: number[] }[],
  startSeconds: number,
  endSeconds: number,
): [number, number][] {
  const firsts = sheets.map((s) => s.timestamps[0]);
  const lasts = sheets.map((s) => s.timestamps[s.timestamps.length - 1]);
  return sheets.map((_, i) => {
    const start = i === 0 ? startSeconds : (lasts[i - 1] + firsts[i]) / 2;
    const end = i === sheets.length - 1 ? endSeconds : (lasts[i] + firsts[i + 1]) / 2;
    return [start, end];
  });
}
