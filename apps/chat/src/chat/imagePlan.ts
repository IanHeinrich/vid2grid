import { checkedImageIds, checkedVideoKeys, refuse } from "../imageIds";
import type { Chat, ChatMessage, ImageRef, ImageUse } from "../types";
import { sheetOwner } from "../video/sheetCache";

export interface StoredUse {
  chats: readonly Chat[];
  messages: readonly ChatMessage[];
  // Undefined for an entry whose value is missing, which is then unreadable.
  sheets: readonly (readonly [string, readonly ImageRef[] | undefined])[];
}

export interface DeletePlan {
  sheets: readonly string[];
  images: readonly string[];
}

// Cached sheets go with their video and a zoom with its picture; any other entry is kept.
export function planRelease(
  stored: StoredUse,
  dropped: ImageUse,
  unsaved: ImageUse,
  mayGo: (sheetKey: string) => boolean = () => true,
): DeletePlan {
  const { chats, messages } = stored;
  const used = new Set([...checkedImageIds({ messages }), ...unsaved.images]);
  const videos = new Set([...checkedVideoKeys(chats, messages), ...unsaved.videos]);
  const goes = (key: string): boolean => {
    const owner = sheetOwner(key);
    if (owner === undefined || !mayGo(key)) return false;
    return owner.kind === "video"
      ? dropped.videos.has(owner.fileKey) && !videos.has(owner.fileKey)
      : dropped.images.has(owner.id) && !used.has(owner.id);
  };
  const sheets = stored.sheets.flatMap(([key]) => (goes(key) ? [key] : []));
  const going = new Set(sheets);
  const candidates = new Set(dropped.images);
  for (const [key, refs] of stored.sheets) {
    for (const id of cachedIds(refs)) (going.has(key) ? candidates : used).add(id);
  }
  return { sheets, images: [...candidates].filter((id) => !used.has(id)) };
}

function cachedIds(refs: unknown): Set<string> {
  if (!Array.isArray(refs)) return refuse("A cached entry");
  return checkedImageIds({ refs: refs as ImageRef[] });
}

// Everything stored is up for release, and what nothing uses goes; only limits that to a plan made earlier.
export function planSweep(
  stored: StoredUse,
  imageIds: readonly string[],
  unsaved: ImageUse,
  only?: DeletePlan,
): DeletePlan {
  const images = new Set(imageIds);
  const videos = new Set<string>();
  for (const [key] of stored.sheets) {
    const owner = sheetOwner(key);
    if (owner?.kind === "video") videos.add(owner.fileKey);
    if (owner?.kind === "image") images.add(owner.id);
  }
  const limit = only && { sheets: new Set(only.sheets), images: new Set(only.images) };
  const mayGo = (key: string) => limit?.sheets.has(key) ?? true;
  const plan = planRelease(stored, { images, videos }, unsaved, mayGo);
  const exists = new Set(imageIds);
  const goes = (id: string) => exists.has(id) && (limit?.images.has(id) ?? true);
  return { ...plan, images: plan.images.filter(goes) };
}
