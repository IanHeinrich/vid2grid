import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { openChatStore } from "../src/chat/store";
import type {
  AssistantMessage,
  Chat,
  ChatMessage,
  ChatStore,
  Folder,
  ImageRef,
  UserMessage,
  VideoAttachment,
  VideoAudio,
  VideoCast,
  VideoTimeline,
} from "../src/types";
import { sheetCacheKey } from "../src/video/sheetCache";
import { tool } from "./support/factories";
import { isStored, NOTHING, saveImage, stores, sweep, use } from "./support/images";

function chat(id: string, updatedAt: number): Chat {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: 1,
    updatedAt,
    settings: { systemPrompt: "Be brief.", modelId: "model", sheetResolution: 1024 },
    sceneLog: [{ timeSeconds: 12, text: "door opens" }],
  };
}

function userMessage(id: string, createdAt: number, text = id): ChatMessage {
  return { id, createdAt, role: "user", text, images: [] };
}

const sheetRef: ImageRef = {
  id: "image-1",
  pinned: false,
  source: {
    kind: "sheet",
    call: "overview",
    name: "grid_0001",
    startSeconds: 0,
    endSeconds: 30,
    frameCount: 16,
  },
};

// jsdom's Blob does not survive fake-indexeddb's structured clone; the Blob a Response makes does.
function jpeg(text: string): Promise<Blob> {
  return new Response(text, { headers: { "content-type": "image/jpeg" } }).blob();
}

const timeline: VideoTimeline = {
  fileKey: "video.mp4|100|1",
  modelId: "model",
  entries: [{ startSeconds: 0, endSeconds: 30, text: "a dog runs" }],
  nextWindow: 1,
  windowCount: 4,
  updatedAt: 7,
};

const cast: VideoCast = {
  fileKey: "video.mp4|100|1",
  cards: [
    { id: "c1", name: "Mara", description: "red coat", firstSeenSeconds: 12 },
    { id: "c2", name: "Rex", description: "terrier" },
  ],
  updatedAt: 8,
};

const audio: VideoAudio = {
  fileKey: "video.mp4|100|1",
  labels: ["music", "applause"],
  backgroundLabels: ["silence"],
  speechSpans: [{ startSeconds: 0, endSeconds: 60 }],
  soundSpans: [{ startSeconds: 0, endSeconds: 60 }],
  speech: [{ start: 2, end: 4, text: "Over here." }],
  events: [
    {
      startSeconds: 10,
      endSeconds: 20,
      label: "applause",
      score: 0.8,
      loudnessDb: 3,
      ratePerMinute: 90,
    },
  ],
  updatedAt: 9,
};

const handle = { kind: "file", name: "video.mp4" } as unknown as FileSystemFileHandle;

describe.each(stores)("%s chat store chats and messages", (_name, open) => {
  it("round-trips a chat", async () => {
    const store = await open();
    await store.putChat(chat("a", 5));
    expect(await store.getChat("a")).toEqual(chat("a", 5));
    expect(await store.getChat("missing")).toBeUndefined();
  });

  it("lists chats newest updatedAt first", async () => {
    const store = await open();
    await store.putChat(chat("old", 1));
    await store.putChat(chat("new", 9));
    await store.putChat(chat("middle", 5));
    expect((await store.listChats()).map((c) => c.id)).toEqual(["new", "middle", "old"]);
  });

  it("lists a chat's messages by createdAt, ties in insertion order", async () => {
    const store = await open();
    await store.putChat(chat("a", 1));
    await store.putChat(chat("b", 1));
    await store.putMessage("a", userMessage("late", 20));
    await store.putMessage("a", userMessage("tie-1", 10));
    await store.putMessage("b", userMessage("other", 5));
    await store.putMessage("a", userMessage("tie-2", 10));
    await store.putMessage("a", userMessage("early", 1));
    expect((await store.listMessages("a")).map((m) => m.id)).toEqual([
      "early",
      "tie-1",
      "tie-2",
      "late",
    ]);
  });

  it("upserts a message by id, keeping its place", async () => {
    const store = await open();
    await store.putChat(chat("a", 1));
    await store.putMessage("a", userMessage("first", 10, "draft"));
    await store.putMessage("a", userMessage("second", 10));
    await store.putMessage("a", userMessage("first", 10, "final"));
    const messages = await store.listMessages("a");
    expect(messages.map((m) => m.id)).toEqual(["first", "second"]);
    expect(messages[0]).toMatchObject({ text: "final" });
  });

  it("deletes only the named messages of one chat", async () => {
    const store = await open();
    await store.putChat(chat("a", 1));
    await store.putChat(chat("b", 1));
    await store.putMessage("a", userMessage("keep", 1));
    await store.putMessage("a", userMessage("drop-1", 2));
    await store.putMessage("a", userMessage("drop-2", 3));
    await store.putMessage("b", userMessage("drop-1", 1));
    await store.deleteMessages("a", ["drop-1", "drop-2", "missing"]);
    expect((await store.listMessages("a")).map((m) => m.id)).toEqual(["keep"]);
    expect((await store.listMessages("b")).map((m) => m.id)).toEqual(["drop-1"]);
  });

  it("saves no message to a chat that is gone or was never there, until it is put back", async () => {
    const store = await open();
    const id = await saveImage(store);
    const message = tool("t", "call", [{ ...sheetRef, id }]);
    const gone = "This chat has been deleted.";
    await expect(store.putMessage("a", message)).rejects.toThrow(gone);
    await store.putChat(chat("a", 1));
    await store.putMessage("a", message);
    await store.deleteChat("a");
    await expect(store.putMessage("a", message)).rejects.toThrow(gone);
    expect(await store.listMessages("a")).toEqual([]);
    expect((await store.countUnusedImages(() => NOTHING)).images).toEqual([id]);
    await store.putChat(chat("a", 1));
    await store.putMessage("a", message);
    expect(await store.listMessages("a")).toEqual([message]);
  });

  it("still spares a new image whose message was refused", async () => {
    const store = await open();
    const id = await saveImage(store);
    const refused = store.putMessage("a", tool("t", "call", [{ ...sheetRef, id }]));
    await expect(refused).rejects.toThrow();
    expect((await sweep(store))?.images).toEqual([]);
    expect(await isStored(store, id)).toBe(true);
  });
});

describe("IndexedDB chat store messages of a deleted chat", () => {
  it("refuses one saved in another tab just after the chat is deleted", async () => {
    const tabs = { name: "deleted", factory: new IDBFactory() };
    const [here, there] = [await openChatStore(tabs), await openChatStore(tabs)];
    await here.putChat(chat("a", 1));
    await there.putMessage("a", userMessage("first", 1));
    const deleting = here.deleteChat("a");
    const saving = there.putMessage("a", userMessage("second", 2));
    await expect(saving).rejects.toThrow("This chat has been deleted.");
    await deleting;
    expect(await there.listMessages("a")).toEqual([]);
  });
});

function video(fileKey: string): VideoAttachment {
  return { name: `${fileKey}.mp4`, fileKey, durationSeconds: 1, width: 1, height: 1 };
}

function videoMessage(id: string, createdAt: number, fileKey: string): UserMessage {
  return { id, createdAt, role: "user", text: id, images: [], video: video(fileKey) };
}

describe.each(stores)("%s chat store video keys", (_name, open) => {
  it("lists, per chat, every fileKey its chat or messages refer to, once each", async () => {
    const store = await open();
    await store.putChat({ ...chat("a", 1), video: video("latest") });
    await store.putChat(chat("b", 2));
    await store.putMessage("a", videoMessage("a-1", 1, "older"));
    await store.putMessage("a", videoMessage("a-2", 2, "latest"));
    await store.putMessage("b", videoMessage("b-1", 1, "other"));
    await store.putMessage("b", videoMessage("b-2", 2, "older"));
    await store.putMessage("b", userMessage("b-3", 3));
    const keys = await store.listVideoKeysByChat();
    expect([...keys.keys()].sort()).toEqual(["a", "b"]);
    expect(keys.get("a")?.sort()).toEqual(["latest", "older"]);
    expect(keys.get("b")?.sort()).toEqual(["older", "other"]);
  });

  it("lists nothing when no chat or message has a video", async () => {
    const store = await open();
    await store.putChat(chat("a", 1));
    await store.putMessage("a", userMessage("a-1", 1));
    expect((await store.listVideoKeysByChat()).size).toBe(0);
  });

  it("leaves out a video removed from its chat", async () => {
    const store = await open();
    await store.putChat(chat("a", 1));
    await store.putMessage("a", videoMessage("a-1", 1, "older"));
    const removed = { ...userMessage("a-2", 2), removedVideo: video("removed") };
    await store.putMessage("a", removed);
    expect(await store.listVideoKeysByChat()).toEqual(new Map([["a", ["older"]]]));
    expect((await store.listMessages("a"))[1]).toEqual(removed);
  });

  it("forgets the videos of a deleted chat", async () => {
    const store = await open();
    await store.putChat({ ...chat("a", 1), video: video("latest") });
    await store.putMessage("a", videoMessage("a-1", 1, "older"));
    await store.deleteChat("a");
    expect((await store.listVideoKeysByChat()).size).toBe(0);
  });
});

describe.each(stores)("%s chat store images, sheets and deletes", (_name, open) => {
  it("round-trips an image blob", async () => {
    const store = await open();
    const id = await store.putImage(await jpeg("jpeg bytes"));
    const blob = await store.getImage(id);
    expect(blob?.type).toBe("image/jpeg");
    expect(blob?.size).toBe(10);
    expect(await store.getImage("missing")).toBeUndefined();
  });

  it("caches sheets by key", async () => {
    const store = await open();
    await store.putSheets("video|1|2", [sheetRef]);
    expect(await store.getSheets("video|1|2")).toEqual([sheetRef]);
    expect(await store.getSheets("other")).toBeUndefined();
  });

  it("deletes a chat with its messages and video handle, keeping images and sheets", async () => {
    const store = await open();
    await store.putChat(chat("a", 1));
    await store.putChat(chat("b", 2));
    await store.putMessage("a", userMessage("a-1", 1));
    await store.putMessage("b", userMessage("b-1", 1));
    await store.putVideoHandle("a", handle);
    const imageId = await store.putImage(await jpeg("x"));
    await store.putSheets("key", [sheetRef]);
    await store.putTimeline(timeline);
    await store.putCast(cast);

    await store.deleteChat("a");

    expect(await store.getChat("a")).toBeUndefined();
    expect(await store.listMessages("a")).toEqual([]);
    expect(await store.getVideoHandle("a")).toBeUndefined();
    expect((await store.listMessages("b")).map((m) => m.id)).toEqual(["b-1"]);
    expect(await store.getImage(imageId)).toBeDefined();
    expect(await store.getSheets("key")).toEqual([sheetRef]);
    expect(await store.getTimeline(timeline.fileKey)).toEqual(timeline);
    expect(await store.getCast(cast.fileKey)).toEqual(cast);
  });

  it("deletes one chat's video handle", async () => {
    const store = await open();
    await store.putVideoHandle("a", handle);
    await store.putVideoHandle("b", handle);
    await store.deleteVideoHandle("a");
    await store.deleteVideoHandle("missing");
    expect(await store.getVideoHandle("a")).toBeUndefined();
    expect(await store.getVideoHandle("b")).toEqual(handle);
  });

  it("stores timelines by file key, replacing on put", async () => {
    const store = await open();
    await store.putTimeline(timeline);
    expect(await store.getTimeline(timeline.fileKey)).toEqual(timeline);
    const resumed = { ...timeline, nextWindow: 4, updatedAt: 9 };
    await store.putTimeline(resumed);
    expect(await store.getTimeline(timeline.fileKey)).toEqual(resumed);
    expect(await store.getTimeline("other")).toBeUndefined();
  });
});

describe.each(stores)("%s chat store swipes and cast", (_name, open) => {
  it("round-trips a user message's alternate replies", async () => {
    const store = await open();
    const reply: AssistantMessage = {
      id: "a1",
      createdAt: 3,
      role: "assistant",
      text: "old answer",
      toolCalls: [],
    };
    const message: UserMessage = {
      id: "u1",
      createdAt: 1,
      role: "user",
      text: "u1",
      images: [],
      alternates: [{ messages: [reply], modelId: "model-b", createdAt: 3 }],
      replyIndex: 1,
      replyModelId: "model",
    };
    await store.putChat(chat("a", 1));
    await store.putMessage("a", message);
    expect(await store.listMessages("a")).toEqual([message]);
  });

  it("stores a video's cast by file key, replacing on put", async () => {
    const store = await open();
    await store.putCast(cast);
    expect(await store.getCast(cast.fileKey)).toEqual(cast);
    const edited = { ...cast, cards: cast.cards.slice(1), updatedAt: 9 };
    await store.putCast(edited);
    expect(await store.getCast(cast.fileKey)).toEqual(edited);
    expect(await store.getCast("other")).toBeUndefined();
  });

  it("stores a video's audio by file key, replacing on put", async () => {
    const store = await open();
    await store.putAudio(audio);
    expect(await store.getAudio(audio.fileKey)).toEqual(audio);
    const grown = { ...audio, speechSpans: [{ startSeconds: 0, endSeconds: 120 }], updatedAt: 10 };
    await store.putAudio(grown);
    expect(await store.getAudio(audio.fileKey)).toEqual(grown);
    expect(await store.getAudio("other")).toBeUndefined();
  });
});

describe.each(stores)("%s chat store folders", (_name, open) => {
  const trips: Folder = { id: "f1", name: "Trips", createdAt: 2, collapsed: true };
  const cooking: Folder = { id: "f2", name: "Cooking", createdAt: 1 };

  it("lists folders oldest first and replaces one on put", async () => {
    const store = await open();
    await store.putFolder(trips);
    await store.putFolder(cooking);
    expect(await store.listFolders()).toEqual([cooking, trips]);
    await store.putFolder({ ...trips, name: "Holidays" });
    expect((await store.listFolders()).map((folder) => folder.name)).toEqual([
      "Cooking",
      "Holidays",
    ]);
  });

  it("deletes a folder without touching the chats filed in it", async () => {
    const store = await open();
    await store.putFolder(trips);
    await store.putChat({ ...chat("a", 1), folderId: trips.id });
    await store.deleteFolder(trips.id);
    expect(await store.listFolders()).toEqual([]);
    expect((await store.getChat("a"))?.folderId).toBe(trips.id);
  });
});

function openVersion1(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("chats", { keyPath: "id" });
      const messages = db.createObjectStore("messages", { keyPath: "seq", autoIncrement: true });
      messages.createIndex("byChat", "chatId");
      messages.createIndex("byMessage", ["chatId", "messageId"], { unique: true });
      db.createObjectStore("images");
      db.createObjectStore("sheetCache");
      db.createObjectStore("videoHandles");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
  });
}

function writeVersion1(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["chats", "messages", "sheetCache"], "readwrite");
    transaction.objectStore("chats").put(chat("old", 3));
    const message = userMessage("m1", 1, "kept");
    transaction.objectStore("messages").put({ chatId: "old", messageId: "m1", message });
    transaction.objectStore("sheetCache").put([sheetRef], "key");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("write failed"));
  });
}

function openVersion2(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("chats", { keyPath: "id" });
      const messages = db.createObjectStore("messages", { keyPath: "seq", autoIncrement: true });
      messages.createIndex("byChat", "chatId");
      messages.createIndex("byMessage", ["chatId", "messageId"], { unique: true });
      db.createObjectStore("images");
      db.createObjectStore("sheetCache");
      db.createObjectStore("videoHandles");
      db.createObjectStore("timelines", { keyPath: "fileKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
  });
}

function writeVersion2(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["chats", "messages", "timelines"], "readwrite");
    transaction.objectStore("chats").put(chat("old", 3));
    const message = userMessage("m1", 1, "kept");
    transaction.objectStore("messages").put({ chatId: "old", messageId: "m1", message });
    transaction.objectStore("timelines").put(timeline);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("write failed"));
  });
}

function openVersion3(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("chats", { keyPath: "id" });
      const messages = db.createObjectStore("messages", { keyPath: "seq", autoIncrement: true });
      messages.createIndex("byChat", "chatId");
      messages.createIndex("byMessage", ["chatId", "messageId"], { unique: true });
      db.createObjectStore("images");
      db.createObjectStore("sheetCache");
      db.createObjectStore("videoHandles");
      db.createObjectStore("timelines", { keyPath: "fileKey" });
      db.createObjectStore("cast", { keyPath: "fileKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
  });
}

function writeVersion3(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["chats", "timelines", "cast"], "readwrite");
    transaction.objectStore("chats").put(chat("old", 3));
    transaction.objectStore("timelines").put(timeline);
    transaction.objectStore("cast").put(cast);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("write failed"));
  });
}

function openVersion4(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 4);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("chats", { keyPath: "id" });
      const messages = db.createObjectStore("messages", { keyPath: "seq", autoIncrement: true });
      messages.createIndex("byChat", "chatId");
      messages.createIndex("byMessage", ["chatId", "messageId"], { unique: true });
      db.createObjectStore("images");
      db.createObjectStore("sheetCache");
      db.createObjectStore("videoHandles");
      db.createObjectStore("timelines", { keyPath: "fileKey" });
      db.createObjectStore("cast", { keyPath: "fileKey" });
      db.createObjectStore("audio", { keyPath: "fileKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
  });
}

function writeVersion4(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["chats", "audio"], "readwrite");
    transaction.objectStore("chats").put(chat("old", 3));
    transaction.objectStore("audio").put(audio);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("write failed"));
  });
}

describe("IndexedDB chat store upgrade to folders", () => {
  it("keeps a version 4 database's chats and audio, unfiled, and adds folders", async () => {
    const factory = new IDBFactory();
    const old = await openVersion4(factory, "upgrade-4");
    await writeVersion4(old);
    old.close();

    const store = await openChatStore({ name: "upgrade-4", factory });

    const [kept] = await store.listChats();
    expect(kept).toEqual(chat("old", 3));
    expect(kept?.folderId).toBeUndefined();
    expect(await store.getAudio(audio.fileKey)).toEqual(audio);
    expect(await store.listFolders()).toEqual([]);
    await store.putFolder({ id: "f", name: "Trips", createdAt: 1 });
    expect(await store.listFolders()).toHaveLength(1);
  });
});

describe("IndexedDB chat store upgrade to audio", () => {
  it("keeps a version 3 database's chats, timelines and cast and adds audio", async () => {
    const factory = new IDBFactory();
    const old = await openVersion3(factory, "upgrade-3");
    await writeVersion3(old);
    old.close();

    const store = await openChatStore({ name: "upgrade-3", factory });

    expect(await store.listChats()).toEqual([chat("old", 3)]);
    expect(await store.getTimeline(timeline.fileKey)).toEqual(timeline);
    expect(await store.getCast(cast.fileKey)).toEqual(cast);
    expect(await store.getAudio(audio.fileKey)).toBeUndefined();
    await store.putAudio(audio);
    expect(await store.getAudio(audio.fileKey)).toEqual(audio);
  });
});

describe("IndexedDB chat store upgrade", () => {
  it("keeps a version 2 database's chats, messages and timelines and adds cast", async () => {
    const factory = new IDBFactory();
    const old = await openVersion2(factory, "upgrade-2");
    await writeVersion2(old);
    old.close();

    const store = await openChatStore({ name: "upgrade-2", factory });

    expect(await store.listChats()).toEqual([chat("old", 3)]);
    expect(await store.listMessages("old")).toEqual([userMessage("m1", 1, "kept")]);
    expect(await store.getTimeline(timeline.fileKey)).toEqual(timeline);
    await store.putMessage("old", userMessage("m2", 2));
    expect((await store.listMessages("old")).map((m) => m.id)).toEqual(["m1", "m2"]);
    await store.putCast(cast);
    expect(await store.getCast(cast.fileKey)).toEqual(cast);
  });

  it("keeps a version 1 database's chats, messages and sheets and adds timelines", async () => {
    const factory = new IDBFactory();
    const old = await openVersion1(factory, "upgrade");
    await writeVersion1(old);
    old.close();

    const store = await openChatStore({ name: "upgrade", factory });

    expect(await store.listChats()).toEqual([chat("old", 3)]);
    expect(await store.listMessages("old")).toEqual([userMessage("m1", 1, "kept")]);
    expect(await store.getSheets("key")).toEqual([sheetRef]);
    await store.putMessage("old", userMessage("m2", 2));
    expect((await store.listMessages("old")).map((m) => m.id)).toEqual(["m1", "m2"]);
    await store.putTimeline(timeline);
    expect(await store.getTimeline(timeline.fileKey)).toEqual(timeline);
    await store.putCast(cast);
    expect(await store.getCast(cast.fileKey)).toEqual(cast);
  });

  it("fails with a clear message while another tab holds an older version open", async () => {
    const factory = new IDBFactory();
    const old = await openVersion2(factory, "blocked");

    await expect(openChatStore({ name: "blocked", factory })).rejects.toThrow(
      "Close other vid2grid chat tabs and reload.",
    );
    old.close();
  });

  it("closes its connection when another tab upgrades the database", async () => {
    const factory = new IDBFactory();
    await openChatStore({ name: "newer", factory });

    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("newer", 7);
      request.onblocked = () => reject(new Error("blocked"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("open failed"));
    });
    expect(newer.version).toBe(7);
    newer.close();
  });

  it("says to reload once another tab has upgraded the database", async () => {
    const factory = new IDBFactory();
    const store = await openChatStore({ name: "upgraded", factory });
    const request = factory.open("upgraded", 7);
    await new Promise((resolve) => (request.onsuccess = resolve));
    request.result.close();
    const reload = "Reload this page";
    await expect(store.listChats()).rejects.toThrow(reload);
    await expect(store.listVideoKeysByChat()).rejects.toThrow(reload);
    await expect(store.putChat(chat("a", 1))).rejects.toThrow(reload);
    await expect(store.releaseImages(use(["x"]), () => NOTHING)).rejects.toThrow(reload);
  });
});

function openVersion5(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 5);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("chats", { keyPath: "id" });
      const messages = db.createObjectStore("messages", { keyPath: "seq", autoIncrement: true });
      messages.createIndex("byChat", "chatId");
      messages.createIndex("byMessage", ["chatId", "messageId"], { unique: true });
      for (const store of ["images", "sheetCache", "videoHandles"]) db.createObjectStore(store);
      for (const store of ["timelines", "cast", "audio"]) {
        db.createObjectStore(store, { keyPath: "fileKey" });
      }
      db.createObjectStore("folders", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      // As the older build does.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("open failed"));
  });
}

function writeVersion5(db: IDBDatabase, image: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([...db.objectStoreNames], "readwrite");
    const message = userMessage("m1", 1, "kept");
    const put = (store: string, value: unknown, key?: string) =>
      transaction.objectStore(store).put(value, key);
    put("chats", chat("old", 3));
    put("messages", { chatId: "old", messageId: "m1", message });
    put("images", image, "image-1");
    put("sheetCache", [sheetRef], "key");
    put("videoHandles", { name: "video.mp4" }, "old");
    put("timelines", timeline);
    put("cast", cast);
    put("audio", audio);
    put("folders", { id: "f", name: "Trips", createdAt: 1 });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("write failed"));
  });
}

describe("IndexedDB chat store upgrade that closes older builds", () => {
  it("keeps everything in a version 5 database", async () => {
    const factory = new IDBFactory();
    const old = await openVersion5(factory, "upgrade-5");
    await writeVersion5(old, await jpeg("pixels"));
    old.close();

    const store = await openChatStore({ name: "upgrade-5", factory });

    expect(await store.listChats()).toEqual([chat("old", 3)]);
    expect(await store.listMessages("old")).toEqual([userMessage("m1", 1, "kept")]);
    expect((await store.getImage("image-1"))?.size).toBe(6);
    expect(await store.getSheets("key")).toEqual([sheetRef]);
    expect(await store.getVideoHandle("old")).toEqual({ name: "video.mp4" });
    expect(await store.getTimeline(timeline.fileKey)).toEqual(timeline);
    expect(await store.getCast(cast.fileKey)).toEqual(cast);
    expect(await store.getAudio(audio.fileKey)).toEqual(audio);
    expect(await store.listFolders()).toEqual([{ id: "f", name: "Trips", createdAt: 1 }]);
  });

  it("closes a tab of the older build, which can save nothing afterwards", async () => {
    const factory = new IDBFactory();
    const old = await openVersion5(factory, "open-5");
    const store = await openChatStore({ name: "open-5", factory });
    expect(() => old.transaction("messages", "readwrite")).toThrow();
    await store.putChat(chat("a", 1));
    expect(await store.listChats()).toHaveLength(1);
  });

  it("says to close the other tabs when an older build keeps the database open", async () => {
    const factory = new IDBFactory();
    const old = await openVersion5(factory, "stuck-5");
    old.onversionchange = null;
    await expect(openChatStore({ name: "stuck-5", factory })).rejects.toThrow(
      "Close other vid2grid chat tabs and reload.",
    );
    old.close();
  });
});

describe.each(stores)("%s chat store unused images", (_name, open) => {
  async function orphan(store: ChatStore, text: string): Promise<string> {
    const id = await saveImage(store, text);
    await store.putChat(chat("gone", 1));
    await store.putMessage("gone", tool("t", "call", [{ ...sheetRef, id }]));
    await store.deleteChat("gone");
    return id;
  }

  it("counts what nothing refers to, then deletes just that", async () => {
    const store = await open();
    const kept = await saveImage(store, "kept");
    await store.putChat(chat("c", 1));
    await store.putMessage("c", tool("t", "call", [{ ...sheetRef, id: kept }]));
    const ids = [await orphan(store, "12345"), await orphan(store, "123")];
    const counted = await store.countUnusedImages(() => NOTHING);
    expect([...counted.images].sort()).toEqual([...ids].sort());
    expect(counted.bytes).toBe(8);
    expect(await store.deleteUnusedImages(counted, () => NOTHING)).toEqual(counted);
    expect(await sweep(store)).toEqual({ images: [], sheets: [], bytes: 0 });
    expect(await Promise.all(ids.map((id) => isStored(store, id)))).toEqual([false, false]);
    expect(await isStored(store, kept)).toBe(true);
  });

  it("spares what is in use but not saved", async () => {
    const store = await open();
    const id = await orphan(store, "123");
    const counted = await store.countUnusedImages(() => NOTHING);
    expect((await store.countUnusedImages(() => use([id]))).images).toEqual([]);
    await store.deleteUnusedImages(counted, () => use([id]));
    expect(await isStored(store, id)).toBe(true);
  });

  it("spares an image this tab has just saved, until it is released", async () => {
    const store = await open();
    const id = await saveImage(store);
    expect((await sweep(store))?.images).toEqual([]);
    expect(await isStored(store, id)).toBe(true);
    await store.releaseImages(use([id]), () => undefined);
    expect((await store.countUnusedImages(() => NOTHING)).images).toEqual([id]);
  });

  it("deletes nothing when asked not to", async () => {
    const store = await open();
    const id = await orphan(store, "123");
    const counted = await store.countUnusedImages(() => NOTHING);
    await store.releaseImages(use([id]), () => undefined);
    expect(await store.deleteUnusedImages(counted, () => undefined)).toBeUndefined();
    expect(await isStored(store, id)).toBe(true);
  });

  it("saves a message and sheets even when their images cannot be read", async () => {
    const store = await open();
    const odd = { ...userMessage("odd", 1), images: [{ id: 3 }, "x"], alternates: [null] };
    await store.putChat(chat("c", 1));
    await store.putMessage("c", odd as unknown as ChatMessage);
    await store.putSheets("key", [null] as unknown as ImageRef[]);
    expect(await store.listMessages("c")).toHaveLength(1);
    expect(await store.getSheets("key")).toHaveLength(1);
  });
});

describe("IndexedDB chat store image release", () => {
  it("asks again inside the transaction, and deletes nothing when told not to", async () => {
    const store = await openChatStore({ name: "again", factory: new IDBFactory() });
    const id = await saveImage(store);
    await store.releaseImages(use([id]), () => undefined);
    const counted = await store.countUnusedImages(() => NOTHING);
    expect(counted.images).toEqual([id]);
    const onlyAtFirst = () => {
      const answers = [NOTHING, undefined];
      return () => answers.shift();
    };
    await store.releaseImages(use([id]), onlyAtFirst());
    expect(await store.deleteUnusedImages(counted, onlyAtFirst())).toBeUndefined();
    expect(await isStored(store, id)).toBe(true);
  });

  it("opens no transaction when it is already refused", async () => {
    const store = await openChatStore({ name: "refused", factory: new IDBFactory() });
    const counted = await store.countUnusedImages(() => NOTHING);
    const begun = vi.spyOn(IDBDatabase.prototype, "transaction");
    await store.releaseImages(use(["x"]), () => undefined);
    await store.deleteUnusedImages(counted, () => undefined);
    expect(begun).not.toHaveBeenCalled();
    begun.mockRestore();
  });

  it("sees what another tab saved before it, and makes a later save wait", async () => {
    const tabs = { name: "test", factory: new IDBFactory() };
    const [here, there] = [await openChatStore(tabs), await openChatStore(tabs)];
    const id = await saveImage(here);
    await here.putChat(chat("c", 1));
    const message = tool("t", "call", [{ ...sheetRef, id }]);
    const saving = there.putMessage("c", message);
    await Promise.all([saving, here.releaseImages(use([id]), () => NOTHING)]);
    expect(await isStored(here, id)).toBe(true);
    await here.deleteMessages("c", ["t"]);
    const order: string[] = [];
    const releasing = here.releaseImages(use([id]), () => {
      order.push("asked");
      return NOTHING;
    });
    const later = there.putMessage("c", message).then(() => order.push("saved"));
    await Promise.all([releasing, later]);
    expect(order).toEqual(["asked", "asked", "saved"]);
  });

  it("makes what another tab reads meanwhile wait, so it never sees what is being deleted", async () => {
    const tabs = { name: "reads", factory: new IDBFactory() };
    const [here, there] = [await openChatStore(tabs), await openChatStore(tabs)];
    const id = await saveImage(here);
    const key = sheetCacheKey("video.mp4|100|1", { frameCount: 16 });
    await here.putSheets(key, [{ ...sheetRef, id }]);
    const counted = await here.countUnusedImages(() => NOTHING);
    const order: string[] = [];
    let read: Promise<unknown[]> = Promise.resolve([]);
    const seen = async <T>(reading: Promise<T>): Promise<T> => {
      const value = await reading;
      order.push("read");
      return value;
    };
    const deleting = here.deleteUnusedImages(counted, (when) => {
      order.push(when);
      if (when === "before") return NOTHING;
      // Asked for while the delete is under way, as by a tab that gave up waiting to join.
      read = Promise.all([
        seen(there.getImage(id)),
        seen(there.getSheets(key)),
        seen(there.listChats()),
        seen(there.listMessages("c")),
      ]);
      return NOTHING;
    });
    expect((await deleting)?.images).toEqual([id]);
    expect(await read).toEqual([undefined, undefined, [], []]);
    expect(order).toEqual(["before", "inside", "read", "read", "read", "read"]);
  });
});
