import type { PlanOptionInput } from "@vid2grid/core";

export function sheetCacheKey(
  fileKey: string,
  values: PlanOptionInput,
  keyframeTimes?: readonly number[],
): string {
  const entries = Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const times = keyframeTimes === undefined ? "" : `@${keyframeTimes.join(",")}`;
  return `${fileKey}#${JSON.stringify(entries)}${times}`;
}
