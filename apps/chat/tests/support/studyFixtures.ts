import type { UnclearSpan } from "../../src/types";
import { planZoom, type ZoomPlanInput } from "../../src/video/studyPlan";
import { model } from "./factories";

export const WIDE = 16 / 9;

export function flag(startSeconds: number, endSeconds: number, extra: Partial<UnclearSpan> = {}) {
  return { startSeconds, endSeconds, reason: "blur", ...extra };
}

export function zoomInput(
  unclear: UnclearSpan[],
  overrides: Partial<ZoomPlanInput> = {},
): ZoomPlanInput {
  return {
    durationSeconds: 120,
    sourceAspect: WIDE,
    resolution: 1024,
    model: model("qwen3-6-27b"),
    unclear,
    ...overrides,
  };
}

export function spans(input: ZoomPlanInput): [number, number][] {
  return planZoom(input).zooms.map((zoom) => [zoom.startSeconds, zoom.endSeconds]);
}
