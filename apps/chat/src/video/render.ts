import { generateCollages, requestFromOptions } from "@vid2grid/core";
import type { PlanOptionInput, RenderPlan, VideoInfo } from "@vid2grid/core";
import { createBrowserPorts, probeVideo, readFrameTimes } from "@vid2grid/browser";
import type { VideoAttachment } from "../types";
import { endingAtFrame } from "./lastFrame";

const DEFAULT_JPEG_QUALITY = 80;

export interface RenderedSheet {
  name: string;
  blob: Blob;
  startSeconds: number;
  endSeconds: number;
  frameCount: number;
  cellTimes: number[];
}

export function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export async function probeAttachment(
  file: File,
): Promise<{ attachment: VideoAttachment; info: VideoInfo }> {
  const info = await probeVideo(file);
  const attachment: VideoAttachment = {
    name: file.name,
    fileKey: fileKey(file),
    durationSeconds: info.durationSeconds,
    width: info.width,
    height: info.height,
  };
  return { attachment, info };
}

export async function renderSheets(
  file: File,
  info: VideoInfo,
  values: PlanOptionInput,
  onProgress?: (done: number, total: number) => void,
): Promise<RenderedSheet[]> {
  const frameTimes = await readFrameTimes(file).catch(() => undefined);
  const inside = endingAtFrame(values, info, frameTimes?.at(-1));
  const request = requestFromOptions(
    { ...inside.values, jpegQuality: values.jpegQuality ?? DEFAULT_JPEG_QUALITY },
    inside.info,
  );
  const { plan, sheets } = await generateCollages(file, request, createBrowserPorts(), {
    videoInfo: inside.info,
    ...(onProgress && {
      onProgress: (progress) => {
        if (progress.phase === "extracting") onProgress(progress.done, progress.total);
      },
    }),
  });
  return sheets
    .map((sheet) => renderedSheet(plan, sheet.name, sheet.data))
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

function renderedSheet(plan: RenderPlan, name: string, blob: Blob): RenderedSheet {
  const cells = plan.sheets.find((sheet) => sheet.fileName === name)?.cells ?? [];
  const first = cells[0];
  const last = cells[cells.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error(`Sheet ${name} has no frames in the render plan`);
  }
  return {
    name,
    blob,
    startSeconds: first.timestampSeconds,
    endSeconds: last.timestampSeconds,
    frameCount: cells.length,
    cellTimes: cells.map((cell) => cell.timestampSeconds),
  };
}
