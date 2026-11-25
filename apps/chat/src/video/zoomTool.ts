import { imageLabel, recallName, type SheetSource, type ZoomSource } from "../imageRefs";
import { clamp } from "../spans";
import { errorText } from "../text";
import { formatTimestamp } from "../time";
import type {
  ImageArea,
  ImageRef,
  ImageStore,
  SheetCache,
  ToolResult,
  VideoAttachment,
  ZoomTarget,
} from "../types";
import { captureFrame } from "./captureFrame";
import { browserPictures, type PictureTools } from "./cropPicture";
import { latestFrameTime } from "./exactTimes";
import { findRecalled } from "./recallTool";
import { frameAreaOnSheet } from "./sheetArea";
import { storedSheets, zoomCacheKey } from "./sheetCache";
import { sheetCellTimes, sheetGrid } from "./sheetCells";
import type { SheetContext } from "./sheets";
import { failure, imagesFollow, numberArg, type Args, type Parsed } from "./toolArgs";
import { areaArg, areaRect, areaWithin, outputSize, shownArea, wholeArea } from "./zoomArea";

const ONE_TARGET = "Give exactly one of image, an image's name, or t, a time in seconds.";
// Tried in turn while no frame is found.
const EARLIER_SECONDS = [0.1, 0.5, 1, 2];

export interface ZoomContext {
  store: ImageStore & SheetCache;
  // Longest edge in px of what zoom returns.
  resolution: number;
  knownImages?: () => readonly ImageRef[];
  // The video that the message which first held an image was about.
  videoOfImage?: (imageId: string) => VideoAttachment | undefined;
  // Present only while the chat's video is loaded.
  sheets?: SheetContext;
  pictures?: PictureTools;
}

interface ZoomRequest {
  target: ZoomTarget;
  // Before padding, in whole thousandths, so the same call always gives the same picture.
  wanted: ImageArea;
  notes: string[];
}

export async function runZoom(ctx: ZoomContext, args: Args): Promise<ToolResult> {
  try {
    const request = await zoomRequest(ctx, args);
    if ("problem" in request) return failure(request.problem);
    const zoomed = await zoomImage(ctx, request.value);
    if ("problem" in zoomed) return failure(zoomed.problem);
    const { ref, notes } = zoomed.value;
    const lines = [imageLabel(ref), ...request.value.notes, ...notes, imagesFollow(1)];
    return { text: lines.join("\n"), images: [ref] };
  } catch (error) {
    return failure(`Zooming failed: ${errorText(error)}`);
  }
}

function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

async function zoomRequest(ctx: ZoomContext, args: Args): Promise<Parsed<ZoomRequest>> {
  const area = areaArg(args);
  if ("problem" in area) return area;
  const { image } = args;
  if (given(image) === given(args["t"])) return { problem: ONE_TARGET };
  if (!given(image)) return momentRequest(ctx, args, area.value);
  if (typeof image !== "string") return { problem: "image must be an image's name." };
  const found = findRecalled(ctx.knownImages?.() ?? [], image);
  if ("problem" in found) return found;
  const { ref, notes } = found.value;
  const wanted = await imageRequest(ctx, ref, area.value);
  if ("problem" in wanted) return wanted;
  return { value: { ...wanted.value, notes: [...notes, ...wanted.value.notes] } };
}

function momentRequest({ sheets }: ZoomContext, args: Args, area: ImageArea): Parsed<ZoomRequest> {
  const t = numberArg(args, "t");
  if ("problem" in t) return t;
  if (!sheets) {
    return { problem: "t needs the chat's video, which is not loaded. Name an image instead." };
  }
  const wanted = Math.round(t.value * 1000) / 1000;
  const seconds = clamp(wanted, 0, latestFrameTime(sheets.info.durationSeconds));
  return request({ kind: "moment", seconds, fileKey: sheets.video.fileKey }, area);
}

function request(target: ZoomTarget, area: ImageArea, notes: string[] = []): Parsed<ZoomRequest> {
  return { value: { target, wanted: wholeArea(area), notes } };
}

async function imageRequest(
  ctx: ZoomContext,
  ref: ImageRef,
  area: ImageArea,
): Promise<Parsed<ZoomRequest>> {
  const { source } = ref;
  switch (source.kind) {
    case "upload":
      return request({ kind: "image", id: ref.id, name: source.name }, area);
    case "zoom":
      return zoomedRequest(ctx, source, area);
    case "sheet":
      return sheetRequest(ctx, ref, source, area);
  }
}

// Cropped from the original target again, never from the zoomed JPEG.
function zoomedRequest(
  { sheets }: ZoomContext,
  { name, target, area: outer }: ZoomSource,
  area: ImageArea,
): Parsed<ZoomRequest> {
  if (target.kind === "moment" && target.fileKey !== sheets?.video.fileKey) {
    return { problem: notLoaded(sheets, name, undefined) };
  }
  return request(target, areaWithin(area, outer));
}

function notLoaded(
  sheets: SheetContext | undefined,
  name: string,
  video: VideoAttachment | undefined,
): string {
  const from = video?.name ?? (sheets ? "another video" : "a video");
  return `${name} shows ${from}, which is not loaded, so its frames cannot be captured again. ${loadedNote(sheets, video)}`;
}

function loadedNote(sheets: SheetContext | undefined, video: VideoAttachment | undefined): string {
  if (!sheets) return "The user can load it again.";
  const { name } = sheets.video;
  return video?.name === name
    ? "The loaded video is another file of that name."
    : `The loaded video is ${name}.`;
}

async function sheetRequest(
  ctx: ZoomContext,
  ref: ImageRef,
  source: SheetSource,
  area: ImageArea,
): Promise<Parsed<ZoomRequest>> {
  const { sheets } = ctx;
  const name = recallName(ref);
  const governing = ctx.videoOfImage?.(ref.id);
  const fileKey = source.fileKey ?? governing?.fileKey;
  if (!sheets || fileKey !== sheets.video.fileKey) {
    const video = governing?.fileKey === fileKey ? governing : undefined;
    return { problem: notLoaded(sheets, name, video) };
  }
  const { frameCount } = source;
  const { width, height } = sheets.info;
  const side = source.resolution ?? (await storedWidth(ctx, ref)) ?? 0;
  const grid = sheetGrid(frameCount, width / height, side, side);
  if (!grid) return { problem: `The frames on ${name} could not be told apart. Use t instead.` };
  const frame = frameAreaOnSheet(area, grid, side, frameCount);
  const seconds = frame && sheetCellTimes(source)[frame.cellIndex];
  if (!frame || seconds === undefined) {
    return { problem: `The middle of that area is not on a frame of ${name}. Aim at one frame.` };
  }
  const notes = [`The frame at ${momentName(seconds)} is the one in the middle of that area.`];
  if (frame.coveredMore) {
    notes.push("The area covered more than that one frame; only that frame is shown.");
  }
  return request({ kind: "moment", seconds, fileKey: sheets.video.fileKey }, frame.area, notes);
}

// For sheets saved before their resolution was recorded.
async function storedWidth(ctx: ZoomContext, ref: ImageRef): Promise<number | undefined> {
  const blob = await ctx.store.getImage(ref.id);
  if (blob === undefined) return undefined;
  const picture = await (ctx.pictures ?? browserPictures).decode(blob);
  const { width } = picture;
  picture.close();
  return width;
}

// To the millisecond where tenths are not exact, so neighbouring frames get names of their own.
function momentName(seconds: number): string {
  const milliseconds = Math.floor(seconds * 1000 + 1e-3);
  const beyondTenths = milliseconds % 100;
  const digits = beyondTenths === 0 ? "" : String(beyondTenths).padStart(2, "0");
  return `${formatTimestamp(milliseconds / 1000, true)}${digits}`;
}

function zoomName(target: ZoomTarget, { left, top, right, bottom }: ImageArea): string {
  const of = target.kind === "moment" ? momentName(target.seconds) : target.name;
  return `zoom(${of}, ${left}, ${top}, ${right}, ${bottom})`;
}

interface Zoomed {
  ref: ImageRef;
  notes: string[];
}

async function zoomImage(
  ctx: ZoomContext,
  { target, wanted }: ZoomRequest,
): Promise<Parsed<Zoomed>> {
  const key = zoomCacheKey(target, wanted, ctx.resolution);
  const cached = await cachedZoom(ctx, key);
  if (cached) return zoomed(cached, target);
  const opened = await openTarget(ctx, target);
  if ("problem" in opened) return opened;
  const { picture, shown } = opened.value;
  try {
    const shownKey = zoomCacheKey(shown, wanted, ctx.resolution);
    const ref =
      (await cachedZoom(ctx, shownKey)) ?? (await cropTarget(ctx, shown, wanted, picture));
    for (const each of new Set([key, shownKey])) await ctx.store.putSheets(each, [ref]);
    return zoomed(ref, target);
  } finally {
    picture.close();
  }
}

async function cachedZoom(ctx: ZoomContext, key: string): Promise<ImageRef | undefined> {
  return (await storedSheets(ctx.store, key))?.[0];
}

function zoomed(ref: ImageRef, asked: ZoomTarget): Parsed<Zoomed> {
  const shown = ref.source.kind === "zoom" ? ref.source.target : asked;
  if (asked.kind !== "moment" || shown.kind !== "moment" || shown.seconds === asked.seconds) {
    return { value: { ref, notes: [] } };
  }
  const note = `No frame could be captured at ${momentName(asked.seconds)}, so this is the frame at ${momentName(shown.seconds)}.`;
  return { value: { ref, notes: [note] } };
}

async function cropTarget(
  ctx: ZoomContext,
  target: ZoomTarget,
  wanted: ImageArea,
  picture: ImageBitmap,
): Promise<ImageRef> {
  const area = shownArea(wanted, picture);
  const crop = areaRect(area, picture);
  const size = outputSize(crop, ctx.resolution);
  const blob = await (ctx.pictures ?? browserPictures).crop(picture, crop, size);
  const id = await ctx.store.putImage(blob);
  const name = zoomName(target, wanted);
  return { id, pinned: false, source: { kind: "zoom", name, target, area, ...size } };
}

interface OpenedTarget {
  picture: ImageBitmap;
  // The target, or the earlier moment that had a frame in its place.
  shown: ZoomTarget;
}

async function openTarget(ctx: ZoomContext, target: ZoomTarget): Promise<Parsed<OpenedTarget>> {
  if (target.kind === "moment") return openMoment(ctx, target);
  const blob = await largestStored(ctx, target.id);
  if (blob === undefined) return { problem: `${target.name} is no longer stored.` };
  const picture = await (ctx.pictures ?? browserPictures).decode(blob);
  return { value: { picture, shown: target } };
}

// The last frame can start well before the video ends, with nothing at or after a later time.
async function openMoment(
  { sheets }: ZoomContext,
  target: Extract<ZoomTarget, { kind: "moment" }>,
): Promise<Parsed<OpenedTarget>> {
  if (!sheets) return { problem: "The video is not loaded." };
  const capture =
    sheets.capture ??
    ((file, info, seconds) => captureFrame(file, info, seconds, undefined, sheets.signal));
  const earlier = EARLIER_SECONDS.map((by) => Math.round((target.seconds - by) * 1e6) / 1e6);
  for (const seconds of [target.seconds, ...earlier.filter((time) => time >= 0)]) {
    const picture = await capture(sheets.file, sheets.info, seconds);
    if (picture) return { value: { picture, shown: { ...target, seconds } } };
  }
  return {
    problem: `No frame could be captured at ${momentName(target.seconds)} or just before it. Try an earlier t.`,
  };
}

async function largestStored(ctx: ZoomContext, id: string): Promise<Blob | undefined> {
  const source = ctx.knownImages?.().find((ref) => ref.id === id)?.source;
  const originalId = source?.kind === "upload" ? source.originalId : undefined;
  const original = originalId === undefined ? undefined : await ctx.store.getImage(originalId);
  return original ?? ctx.store.getImage(id);
}
