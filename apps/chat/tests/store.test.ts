import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createMemoryStore, openChatStore } from "../src/chat/store";
import type {
  AssistantMessage,
  Chat,
  ChatMessage,
  ChatStore,
  Folder,
  ImageRef,
  UserMessage,
  VideoAudio,
  VideoCast,
  VideoTimeline,
} from "../src/types";

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

const stores: [string, () => Promise<ChatStore>][] = [
  ["IndexedDB", () => openChatStore({ name: "test", factory: new IDBFactory() })],
  ["memory", () => Promise.resolve(createMemoryStore())],
];

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
    await store.putMessage("a", userMessage("first", 10, "draft"));
    await store.putMessage("a", userMessage("second", 10));
    await store.putMessage("a", userMessage("first", 10, "final"));
    const messages = await store.listMessages("a");
    expect(messages.map((m) => m.id)).toEqual(["first", "second"]);
    expect(messages[0]).toMatchObject({ text: "final" });
  });

  it("deletes only the named messages of one chat", async () => {
    const store = await open();
    await store.putMessage("a", userMessage("keep", 1));
    await store.putMessage("a", userMessage("drop-1", 2));
    await store.putMessage("a", userMessage("drop-2", 3));
    await store.putMessage("b", userMessage("drop-1", 1));
    await store.deleteMessages("a", ["drop-1", "drop-2", "missing"]);
    expect((await store.listMessages("a")).map((m) => m.id)).toEqual(["keep"]);
    expect((await store.listMessages("b")).map((m) => m.id)).toEqual(["drop-1"]);
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
      const request = factory.open("newer", 6);
      request.onblocked = () => reject(new Error("blocked"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("open failed"));
    });
    expect(newer.version).toBe(6);
    newer.close();
  });
});
