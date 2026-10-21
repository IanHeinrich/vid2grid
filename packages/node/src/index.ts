import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  streamCollages,
  type CollagePlanRequest,
  type CollagePorts,
  type GenerateCollagesOptions,
  type GenerationTimings,
  type RenderPlan,
  type Vid2GridWarning,
} from "@vid2grid/core";
import { captureFrames, type RgbaFrame } from "./capture";
import { probeVideo, readKeyframeTimes } from "./probe";
import { encodeSheet, SHEET_ENCODE_CONCURRENCY } from "./render";

export interface RenderVideoResult {
  plan: RenderPlan;
  sheetPaths: string[];
  timings: GenerationTimings;
  warnings: Vid2GridWarning[];
}

export function createNodePorts(): CollagePorts<string, RgbaFrame, Buffer> {
  return {
    probe: { probe: probeVideo, readKeyframeTimes },
    frames: { capture: captureFrames },
    sheets: { encode: encodeSheet, concurrency: SHEET_ENCODE_CONCURRENCY },
    text: { encodeText: (text) => Buffer.from(text, "utf8") },
    clock: { now: () => performance.now() },
  };
}

export async function renderVideo(
  path: string,
  request: CollagePlanRequest,
  outDir: string,
  options: Pick<GenerateCollagesOptions, "onProgress" | "videoInfo"> = {},
): Promise<RenderVideoResult> {
  let timings: GenerationTimings = { phaseMs: {}, frameCount: 0, sheetCount: 0 };
  const warnings: Vid2GridWarning[] = [];
  const sheetPaths: string[] = [];
  const { plan } = await streamCollages(path, request, createNodePorts(), {
    ...options,
    onTiming: (reported) => (timings = reported),
    onWarning: (warning) => warnings.push(warning),
    onSheet: async ({ name, data }) => {
      // Made on the first sheet, so a rejected request or an empty capture leaves no folder.
      if (sheetPaths.length === 0) await mkdir(outDir, { recursive: true });
      const sheetPath = join(outDir, name);
      await writeFile(sheetPath, data);
      sheetPaths.push(sheetPath);
    },
  });
  return { plan, sheetPaths, timings, warnings };
}

export { captureFrames, type RgbaFrame } from "./capture";
export { probeVideo, readKeyframeTimes } from "./probe";
export { encodeSheet, SHEET_ENCODE_CONCURRENCY } from "./render";
