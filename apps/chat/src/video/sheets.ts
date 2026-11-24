import type { PlanOptionInput, VideoInfo } from "@vid2grid/core";
import type { ImageRef, ImageStore, SheetCache, VideoAttachment } from "../types";
import type { captureFrame } from "./captureFrame";
import { overviewOptions } from "./overview";
import type { SheetGeometry } from "./packing";
import { renderSheets, type RenderedSheet } from "./render";
import { sheetCacheKey } from "./sheetCache";

export interface SheetContext {
  file: File;
  info: VideoInfo;
  video: VideoAttachment;
  resolution: number;
  maxImages: number;
  store: ImageStore & SheetCache;
  // Picks the overview's resolution from its sheet count; absent means ctx.resolution.
  overviewResolution?: (sheets: number) => number;
  render?: typeof renderSheets;
  capture?: typeof captureFrame;
}

export async function renderOverview(
  ctx: SheetContext,
  onProgress?: (done: number, total: number) => void,
): Promise<ImageRef[]> {
  const duration = ctx.info.durationSeconds;
  const sized = overviewOptions(duration, ctx.maxImages, sheetGeometry(ctx));
  const resolution = ctx.overviewResolution?.(sized.frameCount / sized.framesPerGrid);
  const values: PlanOptionInput = {
    startSeconds: 0,
    endSeconds: duration,
    ...(resolution === undefined
      ? sized
      : overviewOptions(duration, ctx.maxImages, sheetGeometry(ctx, resolution))),
    outputResolution: resolution ?? ctx.resolution,
  };
  return sheetRefs(ctx, values, "overview", onProgress === undefined ? {} : { onProgress });
}

export function sheetGeometry(ctx: SheetContext, outputResolution = ctx.resolution): SheetGeometry {
  return { sourceAspect: ctx.info.width / ctx.info.height, outputResolution };
}

export interface SheetRenderExtras {
  // Replaces the probed info, e.g. to hand the keyframe path the exact times to capture.
  info?: VideoInfo;
  onProgress?: (done: number, total: number) => void;
}

export async function sheetRefs(
  ctx: SheetContext,
  values: PlanOptionInput,
  call: string,
  { info = ctx.info, onProgress }: SheetRenderExtras = {},
): Promise<ImageRef[]> {
  const keyframes = values.keyframeSampling === true ? info.keyframeTimestampsSeconds : undefined;
  const key = sheetCacheKey(ctx.video.fileKey, values, keyframes);
  const cached = await ctx.store.getSheets(key);
  if (cached !== undefined) return cached.map((ref) => stamped(ref, ctx.video.fileKey));
  const render = ctx.render ?? renderSheets;
  const sheets = await render(ctx.file, info, values, onProgress);
  if (sheets.length === 0) throw new Error("No frame was found there; try an earlier time.");
  const { outputResolution } = values;
  const refs = await Promise.all(
    sheets.map((sheet) => storeSheet(ctx, sheet, call, outputResolution)),
  );
  await ctx.store.putSheets(key, refs);
  return refs;
}

function stamped(ref: ImageRef, fileKey: string): ImageRef {
  return ref.source.kind === "sheet" ? { ...ref, source: { ...ref.source, fileKey } } : ref;
}

async function storeSheet(
  { store, video }: SheetContext,
  sheet: RenderedSheet,
  call: string,
  resolution: number | undefined,
): Promise<ImageRef> {
  return {
    id: await store.putImage(sheet.blob),
    pinned: false,
    source: {
      kind: "sheet",
      call,
      name: sheet.name,
      startSeconds: sheet.startSeconds,
      endSeconds: sheet.endSeconds,
      frameCount: sheet.frameCount,
      cellTimes: sheet.cellTimes,
      fileKey: video.fileKey,
      ...(resolution === undefined ? {} : { resolution }),
    },
  };
}

export function roundForLabel(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
