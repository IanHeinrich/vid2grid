interface Span {
  startSeconds: number;
  endSeconds: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mergeSpans<T extends Span>(spans: readonly T[], gapSeconds: number): T[] {
  const sorted = [...spans].sort((a, b) => a.startSeconds - b.startSeconds);
  const merged: T[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.startSeconds <= last.endSeconds + gapSeconds) {
      last.endSeconds = Math.max(last.endSeconds, span.endSeconds);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

export function sameSpans(a: readonly Span[], b: readonly Span[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (span, index) =>
        span.startSeconds === b[index]?.startSeconds && span.endSeconds === b[index]?.endSeconds,
    )
  );
}
