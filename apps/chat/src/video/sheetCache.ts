import type { PlanOptionInput } from "@vid2grid/core";
import type { ImageArea, ImageRef, ImageStore, SheetCache, ZoomTarget } from "../types";

const SHEET_KEY = /^(.*)#\[.*\](?:@.*)?$/s;
const ZOOM_PREFIX = "zoom#";

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

export function zoomCacheKey(target: ZoomTarget, wanted: ImageArea, resolution: number): string {
  const { left, top, right, bottom } = wanted;
  const of = target.kind === "moment" ? [target.fileKey, target.seconds] : [target.id, target.name];
  return `${ZOOM_PREFIX}${JSON.stringify([target.kind, ...of, left, top, right, bottom, resolution])}`;
}

// What a cached entry was made from, and so what it goes with.
export type SheetOwner = { kind: "video"; fileKey: string } | { kind: "image"; id: string };

// Null when it is not a zoom's key: the sheets of a video whose name begins like one.
function zoomParts(key: string): unknown {
  if (!key.startsWith(ZOOM_PREFIX)) return null;
  try {
    return JSON.parse(key.slice(ZOOM_PREFIX.length));
  } catch {
    return null;
  }
}

function zoomOwner(parts: unknown): SheetOwner | undefined {
  const [kind, of] = Array.isArray(parts) ? (parts as unknown[]) : [];
  if (typeof of !== "string") return undefined;
  if (kind === "image") return { kind: "image", id: of };
  return kind === "moment" ? { kind: "video", fileKey: of } : undefined;
}

export function sheetOwner(key: string): SheetOwner | undefined {
  const zoom = zoomParts(key);
  if (zoom !== null) return zoomOwner(zoom);
  const fileKey = SHEET_KEY.exec(key)?.[1];
  return fileKey === undefined ? undefined : { kind: "video", fileKey };
}

// An entry with a picture that is no longer stored counts as a miss, so it is rendered again.
export async function storedSheets(
  store: ImageStore & SheetCache,
  key: string,
): Promise<ImageRef[] | undefined> {
  const refs = await store.getSheets(key);
  if (refs === undefined) return undefined;
  const blobs = await Promise.all(refs.map((ref) => store.getImage(ref.id)));
  return blobs.includes(undefined) ? undefined : refs;
}
