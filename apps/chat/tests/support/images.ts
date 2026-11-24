import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";
import { createImageCleanup, type ImageCleanup } from "../../src/app/imageCleanup";
import type { Tabs } from "../../src/app/tabs";
import { createMemoryStore, openChatStore } from "../../src/chat/store";
import type { AppState } from "../../src/state";
import type { ChatStore, ImageRef, ImageUse, UnusedImages } from "../../src/types";

export const stores: [string, () => Promise<ChatStore>][] = [
  ["IndexedDB", () => openChatStore({ name: "test", factory: new IDBFactory() })],
  ["memory", () => Promise.resolve(createMemoryStore())],
];

export const aloneTabs: Tabs = {
  supported: true,
  whileAlone: async (work) => ({ done: await work(() => true) }),
};

export function cleanupFor(state: AppState, store: ChatStore, tabs: Tabs = aloneTabs) {
  return createImageCleanup(state, { store, tabs });
}

// For tests about something else: nothing is ever held or released.
export function idleImages() {
  return {
    hold: vi.fn<ImageCleanup["hold"]>(() => ({ letGo: vi.fn(), final: vi.fn() })),
    release: vi.fn<ImageCleanup["release"]>(() => Promise.resolve()),
  };
}

// jsdom's Blob does not survive fake-indexeddb's structured clone; the Blob a Response makes does.
export async function saveImage(store: ChatStore, text = "jpeg"): Promise<string> {
  return store.putImage(
    await new Response(text, { headers: { "content-type": "image/jpeg" } }).blob(),
  );
}

export async function isStored(store: ChatStore, id: string): Promise<boolean> {
  return (await store.getImage(id)) !== undefined;
}

export function use(images: readonly string[], videos: readonly string[] = []): ImageUse {
  return { images: new Set(images), videos: new Set(videos) };
}

export const NOTHING = use([]);

export async function sweep(
  store: ChatStore,
  unsaved: ImageUse = NOTHING,
): Promise<UnusedImages | undefined> {
  const counted = await store.countUnusedImages(() => unsaved);
  return store.deleteUnusedImages(counted, () => unsaved);
}

export function uploadRef(id: string, originalId?: string): ImageRef {
  return {
    id,
    pinned: false,
    source: { kind: "upload", name: "beach.jpg", ...(originalId !== undefined && { originalId }) },
  };
}

export function zoomRef(id: string, targetId: string): ImageRef {
  return {
    id,
    pinned: false,
    source: {
      kind: "zoom",
      name: "zoom(beach.jpg, 0, 0, 500, 500)",
      target: { kind: "image", id: targetId, name: "beach.jpg" },
      area: { left: 0, top: 0, right: 500, bottom: 500 },
      width: 10,
      height: 10,
    },
  };
}
