import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateCollages,
  type CollagePlanRequest,
  type CollagePorts,
  type GenerateCollagesOptions,
  type GenerationTimings,
  type RenderPlan,
  type Vid2GridWarning,
} from "@vid2grid/core";
import { captureFrames, type RgbaFrame } from "./capture";
import { probeVideo, readKeyframeTimes } from "./probe";
import { encodeSheets } from "./render";

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
    sheets: { encode: encodeSheets },
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
  const result = await generateCollages(path, request, createNodePorts(), {
    ...options,
    onTiming: (reported) => (timings = reported),
    onWarning: (warning) => warnings.push(warning),
  });

  await mkdir(outDir, { recursive: true });
  const sheetPaths = await Promise.all(
    result.sheets.map(async ({ name, data }) => {
      const sheetPath = join(outDir, name);
      await writeFile(sheetPath, data);
      return sheetPath;
    }),
  );
  return { plan: result.plan, sheetPaths, timings, warnings };
}

export { captureFrames, type RgbaFrame } from "./capture";
export { probeVideo, readKeyframeTimes } from "./probe";
export { encodeSheets } from "./render";
