import type { PlanOptionInput } from "@vid2grid/core";

// Raised when the same request would render different pictures, so older sheets are not reused.
const RENDER_VERSION = 2;

export function sheetCacheKey(
  fileKey: string,
  values: PlanOptionInput,
  keyframeTimes?: readonly number[],
): string {
  const entries = Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const times = keyframeTimes === undefined ? "" : `@${keyframeTimes.join(",")}`;
  return `${fileKey}#${JSON.stringify([RENDER_VERSION, ...entries])}${times}`;
}
