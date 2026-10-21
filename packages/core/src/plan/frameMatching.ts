import { roundToMicroseconds } from "./framePlanning";
import type { RenderPlan } from "./renderPlan";

export interface FrameMatcher {
  // The planned indices this decoded frame fills, in order; empty when it fills none.
  fill(decodedSeconds: number): number[];
  readonly done: boolean;
}

export function isKeyframePlan(
  plan: Pick<RenderPlan, "frames">,
  keyframeTimes: readonly number[] | undefined,
): boolean {
  if (keyframeTimes === undefined) return false;
  const keyframes = new Set(keyframeTimes.map(roundToMicroseconds));
  return plan.frames.every((frame) => keyframes.has(roundToMicroseconds(frame.timestampSeconds)));
}

// Each planned time takes the first decoded frame at or after it, compared at whole
// microseconds. Counting from the next unfilled index means a frame the decoder never
// emitted shifts none of the others; a frame with no usable time fills nothing.
export function plannedIndicesFilledBy(
  plannedSeconds: readonly number[],
  nextIndex: number,
  decodedSeconds: number,
): number[] {
  if (!Number.isFinite(decodedSeconds)) return [];
  const decoded = roundToMicroseconds(decodedSeconds);
  const filled: number[] = [];
  for (let i = nextIndex; i < plannedSeconds.length; i++) {
    const planned = plannedSeconds[i];
    if (planned === undefined || decoded < roundToMicroseconds(planned)) break;
    filled.push(i);
  }
  return filled;
}

export function createFrameMatcher(plannedSeconds: readonly number[]): FrameMatcher {
  let nextIndex = 0;
  return {
    fill(decodedSeconds) {
      const filled = plannedIndicesFilledBy(plannedSeconds, nextIndex, decodedSeconds);
      nextIndex += filled.length;
      return filled;
    },
    get done() {
      return nextIndex >= plannedSeconds.length;
    },
  };
}
