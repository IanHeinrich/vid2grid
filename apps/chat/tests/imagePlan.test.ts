import { describe, expect, it } from "vitest";
import { blankChat } from "../src/chat/chats";
import type { Chat, ChatMessage, ChatStore, ImageRef, VideoAttachment } from "../src/types";
import { sheetCacheKey, zoomCacheKey } from "../src/video/sheetCache";
import { assistant, sheet, tool, user } from "./support/factories";
import {
  isStored,
  NOTHING,
  saveImage,
  stores,
  sweep,
  uploadRef,
  use,
  zoomRef,
} from "./support/images";

const AREA = { left: 0, top: 0, right: 500, bottom: 500 };
const VIDEO: VideoAttachment = {
  name: "clip.mp4",
  fileKey: "clip.mp4|1|7",
  durationSeconds: 60,
  width: 640,
  height: 360,
};
const SHEETS_KEY = sheetCacheKey(VIDEO.fileKey, { frameCount: 4 });
const MOMENT_KEY = zoomCacheKey({ kind: "moment", seconds: 5, fileKey: VIDEO.fileKey }, AREA, 1024);

function imageZoomKey(id: string): string {
  return zoomCacheKey({ kind: "image", id, name: "beach.jpg" }, AREA, 1024);
}

async function seedChat(store: ChatStore, id: string, messages: ChatMessage[] = []) {
  await store.putChat({ ...blankChat("model", id, 1), video: VIDEO });
  for (const message of messages) await store.putMessage(id, message);
}

async function orphan(store: ChatStore, text: string): Promise<string> {
  const id = await saveImage(store, text);
  await store.putMessage("gone", tool("t", "call", [sheet(id, 0, 1)]));
  await store.deleteMessages("gone", ["t"]);
  return id;
}

type Place = (store: ChatStore, id: string) => Promise<void>;

const places: [string, Place][] = [
  [
    "a user message",
    (store, id) => store.putMessage("c", user("u", "hi", { images: [sheet(id, 0, 1)] })),
  ],
  ["a tool message", (store, id) => store.putMessage("c", tool("t", "call", [sheet(id, 0, 1)]))],
  [
    "an upload's larger copy",
    (store, id) => store.putMessage("c", user("u", "hi", { images: [uploadRef("sent", id)] })),
  ],
  [
    "the picture a zoom was cropped from",
    (store, id) => store.putMessage("c", tool("t", "call", [zoomRef("zoom", id)])),
  ],
  [
    "a reply kept as a swipe",
    (store, id) => {
      const messages = [assistant("a", "old"), tool("t", "call", [sheet(id, 0, 1)])];
      const alternates = [{ messages, createdAt: 1 }];
      return store.putMessage("c", user("u", "hi", { alternates }));
    },
  ],
  [
    "a zoom in a reply kept as a swipe",
    (store, id) => {
      const alternates = [{ messages: [tool("t", "call", [zoomRef("zoom", id)])], createdAt: 1 }];
      return store.putMessage("c", user("u", "hi", { alternates }));
    },
  ],
  ["a cached sheet", (store, id) => store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)])],
  ["a cached zoom into a video", (store, id) => store.putSheets(MOMENT_KEY, [sheet(id, 0, 1)])],
  ["a cached entry of an unknown kind", (store, id) => store.putSheets("other", [sheet(id, 0, 1)])],
];

describe.each(stores)("%s: what a release deletes", (_name, open) => {
  it.each(places)("keeps an image in %s", async (_place, place) => {
    const store = await open();
    await seedChat(store, "c");
    const id = await saveImage(store);
    await place(store, id);
    await store.releaseImages(use([id]), () => NOTHING);
    expect((await sweep(store))?.images).toEqual([]);
    expect(await isStored(store, id)).toBe(true);
  });

  it("keeps a cached zoom of an upload while a message holds the upload", async () => {
    const store = await open();
    const [id, zoom] = [await saveImage(store), await saveImage(store)];
    await seedChat(store, "c", [user("u", "hi", { images: [uploadRef(id)] })]);
    await store.putSheets(imageZoomKey(id), [zoomRef(zoom, id)]);
    await store.releaseImages(use([id, zoom]), () => NOTHING);
    await sweep(store);
    expect(await isStored(store, zoom)).toBe(true);
    expect(await store.getSheets(imageZoomKey(id))).toHaveLength(1);
  });

  it("deletes only the released images, sparing what is in use but not saved", async () => {
    const store = await open();
    const ids = [await saveImage(store), await saveImage(store), await saveImage(store)];
    const [gone = "", unsaved = "", other = ""] = ids;
    await store.releaseImages(use([gone, unsaved]), () => use([unsaved]));
    expect(await Promise.all(ids.map((id) => isStored(store, id)))).toEqual([false, true, true]);
    expect(other).not.toBe("");
  });

  it("drops an unused video's sheets and zooms with their images", async () => {
    const store = await open();
    const [cached, zoom] = [await saveImage(store), await saveImage(store)];
    await store.putSheets(SHEETS_KEY, [sheet(cached, 0, 1)]);
    await store.putSheets(MOMENT_KEY, [sheet(zoom, 0, 1)]);
    await store.releaseImages(use([], [VIDEO.fileKey]), () => NOTHING);
    expect(await store.getSheets(SHEETS_KEY)).toBeUndefined();
    expect(await store.getSheets(MOMENT_KEY)).toBeUndefined();
    expect(await isStored(store, cached)).toBe(false);
    expect(await isStored(store, zoom)).toBe(false);
  });

  it("drops an unused video's sheets but keeps an image a message still holds", async () => {
    const store = await open();
    const id = await saveImage(store);
    await store.putChat(blankChat("model", "c", 1));
    await store.putMessage("c", tool("t", "call", [sheet(id, 0, 1)]));
    await store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)]);
    await store.releaseImages(use([id], [VIDEO.fileKey]), () => NOTHING);
    expect(await store.getSheets(SHEETS_KEY)).toBeUndefined();
    expect(await isStored(store, id)).toBe(true);
  });

  const users: [string, (store: ChatStore) => Promise<void>, string[]][] = [
    ["a chat", (store) => seedChat(store, "c"), []],
    ["a message", (store) => store.putMessage("c", user("u", "hi", { video: VIDEO })), []],
    ["something unsaved", () => Promise.resolve(), [VIDEO.fileKey]],
  ];
  it.each(users)("keeps a video's sheets while %s refers to it", async (_user, refer, unsaved) => {
    const store = await open();
    const id = await saveImage(store);
    await store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)]);
    await refer(store);
    await store.releaseImages(use([id], [VIDEO.fileKey]), () => use([], unsaved));
    await sweep(store, use([], unsaved));
    expect(await store.getSheets(SHEETS_KEY)).toHaveLength(1);
    expect(await isStored(store, id)).toBe(true);
  });

  it("leaves another video's sheets alone", async () => {
    const store = await open();
    const id = await saveImage(store);
    const key = sheetCacheKey(`${VIDEO.fileKey}0`, { frameCount: 4 });
    await store.putSheets(key, [sheet(id, 0, 1)]);
    await store.releaseImages(use([], [VIDEO.fileKey]), () => NOTHING);
    expect(await store.getSheets(key)).toHaveLength(1);
    expect(await isStored(store, id)).toBe(true);
  });

  it("drops a released upload's cached zooms with their images", async () => {
    const store = await open();
    const ids = [await saveImage(store), await saveImage(store), await saveImage(store)];
    const [id = "", originalId = "", zoom = ""] = ids;
    await store.putSheets(imageZoomKey(id), [zoomRef(zoom, id)]);
    await store.releaseImages(use([id, originalId]), () => NOTHING);
    expect(await store.getSheets(imageZoomKey(id))).toBeUndefined();
    expect(await Promise.all(ids.map((each) => isStored(store, each)))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("keeps a released upload's cached zooms while a zoom of it is in a message", async () => {
    const store = await open();
    const [id, zoom] = [await saveImage(store), await saveImage(store)];
    await seedChat(store, "c", [tool("t", "call", [zoomRef(zoom, id)])]);
    await store.putSheets(imageZoomKey(id), [zoomRef(zoom, id)]);
    await store.releaseImages(use([id]), () => NOTHING);
    expect(await store.getSheets(imageZoomKey(id))).toHaveLength(1);
    expect(await isStored(store, id)).toBe(true);
    expect(await isStored(store, zoom)).toBe(true);
  });
});

describe.each(stores)("%s: what a sweep deletes", (_name, open) => {
  it("drops the sheets of videos no chat refers to and the zooms of pictures that are gone", async () => {
    const store = await open();
    const [cached, zoom] = [await saveImage(store, "12"), await saveImage(store, "345")];
    await store.putSheets(SHEETS_KEY, [sheet(cached, 0, 1)]);
    await store.putSheets(imageZoomKey("deleted"), [zoomRef(zoom, "deleted")]);
    const deleted = await sweep(store);
    expect([...(deleted?.images ?? [])].sort()).toEqual([cached, zoom].sort());
    expect(deleted?.bytes).toBe(5);
    expect(await store.getSheets(SHEETS_KEY)).toBeUndefined();
    expect(await store.getSheets(imageZoomKey("deleted"))).toBeUndefined();
  });

  it("deletes only what was counted, though more has become unused since", async () => {
    const store = await open();
    const [first, second] = [await orphan(store, "1"), await saveImage(store)];
    await store.putMessage("c", tool("t", "call", [sheet(second, 0, 1)]));
    const counted = await store.countUnusedImages(() => NOTHING);
    await store.deleteMessages("c", ["t"]);
    const deleted = await store.deleteUnusedImages(counted, () => NOTHING);
    expect(deleted).toMatchObject({ images: [first], bytes: 1 });
    expect(await isStored(store, second)).toBe(true);
  });

  it("drops only the cache entries that were counted, with their images", async () => {
    const store = await open();
    const [old, recent] = [await saveImage(store), await saveImage(store)];
    await store.putSheets(SHEETS_KEY, [sheet(old, 0, 1)]);
    const counted = await store.countUnusedImages(() => NOTHING);
    await store.putSheets(MOMENT_KEY, [sheet(recent, 0, 1)]);
    const deleted = await store.deleteUnusedImages(counted, () => NOTHING);
    expect(deleted).toMatchObject({ images: [old], sheets: [SHEETS_KEY] });
    expect(await store.getSheets(MOMENT_KEY)).toHaveLength(1);
    expect(await isStored(store, recent)).toBe(true);
  });

  it("spares a counted image that has come into use since, or into an uncounted entry", async () => {
    const store = await open();
    const [used, cached] = [await orphan(store, "1"), await orphan(store, "2")];
    const counted = await store.countUnusedImages(() => NOTHING);
    expect(counted.images).toHaveLength(2);
    await store.putMessage("c", tool("t", "call", [sheet(used, 0, 1)]));
    await store.putSheets(SHEETS_KEY, [sheet(cached, 0, 1)]);
    expect(await store.deleteUnusedImages(counted, () => NOTHING)).toMatchObject({ images: [] });
    expect(await isStored(store, used)).toBe(true);
    expect(await isStored(store, cached)).toBe(true);
  });
});

describe.each(stores)("%s: a record of a kind this version does not know", (_name, open) => {
  const oddMessage = { ...user("odd", "hi"), role: "system" } as unknown as ChatMessage;
  const oddRef = { id: "x", pinned: false, source: { kind: "clip" } } as unknown as ImageRef;
  const oddChat = { ...blankChat("model", "odd", 1), video: { name: "v" } } as unknown as Chat;
  const oddPlaces: [string, Place][] = [
    ["a message", (store) => store.putMessage("c", oddMessage)],
    ["an image", (store) => store.putMessage("c", tool("odd", "call", [oddRef]))],
    ["a cached image", (store) => store.putSheets(SHEETS_KEY, [oddRef])],
    [
      "a cached entry",
      (store) => store.putSheets(SHEETS_KEY, sheet("x", 0, 1) as unknown as ImageRef[]),
    ],
    ["a chat's video", (store) => store.putChat(oddChat)],
  ];
  it.each(oddPlaces)("stops every deletion: %s", async (_place, place) => {
    const store = await open();
    const id = await orphan(store, "1");
    const counted = await store.countUnusedImages(() => NOTHING);
    await place(store, id);
    const refused = "so nothing is deleted";
    await expect(store.releaseImages(use([id]), () => NOTHING)).rejects.toThrow(refused);
    await expect(store.countUnusedImages(() => NOTHING)).rejects.toThrow(refused);
    await expect(store.deleteUnusedImages(counted, () => NOTHING)).rejects.toThrow(refused);
    expect(await isStored(store, id)).toBe(true);
  });
});
