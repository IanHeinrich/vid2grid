import type {
  Chat,
  ChatMessage,
  ChatStore,
  Folder,
  ImageRef,
  ImageRelease,
  ImageUse,
  UnsavedUse,
  UnusedImages,
  VideoAudio,
  VideoCast,
  VideoTimeline,
} from "../types";
import { imageIdsIn, type ImageHolder } from "../imageIds";
import { planRelease, planSweep, type DeletePlan, type StoredUse } from "./imagePlan";

const DEFAULT_NAME = "vid2grid-chat";
// Raised to 6 with no schema change: older builds close on it, and they hold no lock to be seen by.
const VERSION = 6;

const CHATS = "chats";
const MESSAGES = "messages";
const IMAGES = "images";
const SHEET_CACHE = "sheetCache";
const VIDEO_HANDLES = "videoHandles";
const TIMELINES = "timelines";
const CAST = "cast";
const AUDIO = "audio";
const FOLDERS = "folders";

const BLOCKED_MESSAGE =
  "The chat database is open in an older version elsewhere. Close other vid2grid chat tabs and reload.";

const UPGRADED_MESSAGE =
  "A newer version of the app has opened the chat database in another tab. Reload this page.";

const BY_CHAT = "byChat";
const BY_MESSAGE = "byMessage";

interface MessageRecord {
  // Auto-incremented, so messages with equal createdAt list in insertion order.
  seq?: number;
  chatId: string;
  messageId: string;
  message: ChatMessage;
}

export interface ChatStoreOptions {
  name?: string;
  factory?: IDBFactory;
}

export async function openChatStore(options: ChatStoreOptions = {}): Promise<ChatStore> {
  const db = await openDatabase(options.factory ?? indexedDB, options.name ?? DEFAULT_NAME);
  return new IndexedDbChatStore(db);
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  const request = factory.open(name, VERSION);
  request.onupgradeneeded = (event) => {
    const db = request.result;
    if (event.oldVersion < 1) {
      db.createObjectStore(CHATS, { keyPath: "id" });
      const messages = db.createObjectStore(MESSAGES, { keyPath: "seq", autoIncrement: true });
      messages.createIndex(BY_CHAT, "chatId");
      messages.createIndex(BY_MESSAGE, ["chatId", "messageId"], { unique: true });
      db.createObjectStore(IMAGES);
      db.createObjectStore(SHEET_CACHE);
      db.createObjectStore(VIDEO_HANDLES);
    }
    if (event.oldVersion < 2) db.createObjectStore(TIMELINES, { keyPath: "fileKey" });
    if (event.oldVersion < 3) db.createObjectStore(CAST, { keyPath: "fileKey" });
    if (event.oldVersion < 4) db.createObjectStore(AUDIO, { keyPath: "fileKey" });
    if (event.oldVersion < 5) db.createObjectStore(FOLDERS, { keyPath: "id" });
  };
  return new Promise((resolve, reject) => {
    // Another tab holding an older version open would otherwise stall the upgrade forever.
    request.onblocked = () => reject(new Error(BLOCKED_MESSAGE));
    requestResult(request).then((db) => {
      db.onversionchange = () => db.close();
      resolve(db);
    }, reject);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted"));
  });
}

function byCreatedAt(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt - b.createdAt;
}

function newestFirst(a: Chat, b: Chat): number {
  return b.updatedAt - a.updatedAt;
}

function oldestFirst(a: Folder, b: Folder): number {
  return a.createdAt - b.createdAt;
}

type MessageOfChat = Pick<MessageRecord, "chatId" | "message">;

function videoKeysByChat(
  chats: readonly Chat[],
  records: readonly MessageOfChat[],
): Map<string, string[]> {
  const keys = new Map<string, Set<string>>();
  const add = (chatId: string, fileKey: string): void => {
    keys.set(chatId, (keys.get(chatId) ?? new Set<string>()).add(fileKey));
  };
  for (const chat of chats) if (chat.video) add(chat.id, chat.video.fileKey);
  for (const { chatId, message } of records) {
    if (message.role === "user" && message.video) add(chatId, message.video.fileKey);
  }
  return new Map(
    [...keys].map(([chatId, fileKeys]): [string, string[]] => [chatId, [...fileKeys]]),
  );
}

export function videoKeysOf(chat: Chat, messages: readonly ChatMessage[]): string[] {
  const records = messages.map((message) => ({ chatId: chat.id, message }));
  return videoKeysByChat([chat], records).get(chat.id) ?? [];
}

// Images this tab has saved that no saved message or cached sheet names yet, so a sweep leaves them.
class NewImages {
  private readonly ids = new Set<string>();

  add(id: string): void {
    this.ids.add(id);
  }

  settle(ids: Iterable<string>): void {
    for (const id of ids) this.ids.delete(id);
  }

  // Never throws, since what names them is saved by now.
  settleSaved(holder: ImageHolder): void {
    try {
      this.settle(imageIdsIn(holder));
    } catch {
      // They only stay spared by this tab's sweeps.
    }
  }

  with(unsaved: ImageUse): ImageUse {
    return { ...unsaved, images: new Set([...unsaved.images, ...this.ids]) };
  }
}

function totalSize(blobs: readonly (Blob | undefined)[]): number {
  return blobs.reduce((total, blob) => total + (blob?.size ?? 0), 0);
}

const NONE_UNUSED: UnusedImages = { images: [], sheets: [], bytes: 0 };
const IMAGE_USERS = [CHATS, MESSAGES, SHEET_CACHE, IMAGES];

async function readStoredUse(transaction: IDBTransaction): Promise<StoredUse> {
  const cache = transaction.objectStore(SHEET_CACHE);
  const [chats, records, keys, sheets] = await Promise.all([
    requestResult(transaction.objectStore(CHATS).getAll() as IDBRequest<Chat[]>),
    requestResult(transaction.objectStore(MESSAGES).getAll() as IDBRequest<MessageRecord[]>),
    requestResult(cache.getAllKeys() as IDBRequest<string[]>),
    requestResult(cache.getAll() as IDBRequest<ImageRef[][]>),
  ]);
  return {
    chats,
    messages: records.map((record) => record.message),
    sheets: keys.map((key, index) => [key, sheets[index]] as const),
  };
}

async function readSweep(
  transaction: IDBTransaction,
  unsaved: UnsavedUse,
  only?: DeletePlan,
): Promise<UnusedImages | undefined> {
  const images = transaction.objectStore(IMAGES);
  const [stored, ids] = await Promise.all([
    readStoredUse(transaction),
    requestResult(images.getAllKeys() as IDBRequest<string[]>),
  ]);
  const inUse = unsaved();
  if (!inUse) return undefined;
  const plan = planSweep(stored, ids, inUse, only);
  const blobs = await Promise.all(
    plan.images.map((id) => requestResult(images.get(id) as IDBRequest<Blob | undefined>)),
  );
  return { ...plan, bytes: totalSize(blobs) };
}

function applyPlan(transaction: IDBTransaction, plan: DeletePlan): void {
  const cache = transaction.objectStore(SHEET_CACHE);
  const images = transaction.objectStore(IMAGES);
  for (const key of plan.sheets) cache.delete(key);
  for (const id of plan.images) images.delete(id);
}

class IndexedDbChatStore implements ChatStore {
  private readonly newImages = new NewImages();

  private upgraded = false;

  constructor(private readonly db: IDBDatabase) {
    db.addEventListener("versionchange", () => {
      this.upgraded = true;
    });
  }

  async listChats(): Promise<Chat[]> {
    const chats = await this.read<Chat[]>(CHATS, (store) => store.getAll());
    return chats.sort(newestFirst);
  }

  getChat(id: string): Promise<Chat | undefined> {
    return this.read<Chat | undefined>(CHATS, (store) => store.get(id));
  }

  putChat(chat: Chat): Promise<void> {
    return this.write([CHATS], (transaction) => transaction.objectStore(CHATS).put(chat));
  }

  deleteChat(id: string): Promise<void> {
    return this.write([CHATS, MESSAGES, VIDEO_HANDLES], (transaction) => {
      transaction.objectStore(CHATS).delete(id);
      transaction.objectStore(VIDEO_HANDLES).delete(id);
      const messages = transaction.objectStore(MESSAGES);
      const keys = messages.index(BY_CHAT).getAllKeys(id);
      keys.onsuccess = () => keys.result.forEach((key) => messages.delete(key));
    });
  }

  async listVideoKeysByChat(): Promise<Map<string, string[]>> {
    const transaction = this.begin([CHATS, MESSAGES], "readonly");
    const [chats, records] = await Promise.all([
      requestResult(transaction.objectStore(CHATS).getAll() as IDBRequest<Chat[]>),
      requestResult(transaction.objectStore(MESSAGES).getAll() as IDBRequest<MessageRecord[]>),
    ]);
    return videoKeysByChat(chats, records);
  }

  async listFolders(): Promise<Folder[]> {
    const folders = await this.read<Folder[]>(FOLDERS, (store) => store.getAll());
    return folders.sort(oldestFirst);
  }

  putFolder(folder: Folder): Promise<void> {
    return this.write([FOLDERS], (transaction) => transaction.objectStore(FOLDERS).put(folder));
  }

  deleteFolder(id: string): Promise<void> {
    return this.write([FOLDERS], (transaction) => transaction.objectStore(FOLDERS).delete(id));
  }

  async listMessages(chatId: string): Promise<ChatMessage[]> {
    const records = await this.read<MessageRecord[]>(MESSAGES, (store) =>
      store.index(BY_CHAT).getAll(chatId),
    );
    return records.map((record) => record.message).sort(byCreatedAt);
  }

  async putMessage(chatId: string, message: ChatMessage): Promise<void> {
    await this.write([MESSAGES], (transaction) => {
      const messages = transaction.objectStore(MESSAGES);
      const existing = messages.index(BY_MESSAGE).getKey([chatId, message.id]);
      existing.onsuccess = () => {
        const seq = existing.result;
        const record: MessageRecord = {
          ...(typeof seq === "number" ? { seq } : {}),
          chatId,
          messageId: message.id,
          message,
        };
        messages.put(record);
      };
    });
    this.newImages.settleSaved({ messages: [message] });
  }

  deleteMessages(chatId: string, ids: readonly string[]): Promise<void> {
    return this.write([MESSAGES], (transaction) => {
      const messages = transaction.objectStore(MESSAGES);
      const byMessage = messages.index(BY_MESSAGE);
      for (const id of ids) {
        const key = byMessage.getKey([chatId, id]);
        key.onsuccess = () => {
          if (key.result !== undefined) messages.delete(key.result);
        };
      }
    });
  }

  getTimeline(fileKey: string): Promise<VideoTimeline | undefined> {
    return this.read<VideoTimeline | undefined>(TIMELINES, (store) => store.get(fileKey));
  }

  putTimeline(timeline: VideoTimeline): Promise<void> {
    return this.write([TIMELINES], (transaction) =>
      transaction.objectStore(TIMELINES).put(timeline),
    );
  }

  getCast(fileKey: string): Promise<VideoCast | undefined> {
    return this.read<VideoCast | undefined>(CAST, (store) => store.get(fileKey));
  }

  putCast(cast: VideoCast): Promise<void> {
    return this.write([CAST], (transaction) => transaction.objectStore(CAST).put(cast));
  }

  getAudio(fileKey: string): Promise<VideoAudio | undefined> {
    return this.read<VideoAudio | undefined>(AUDIO, (store) => store.get(fileKey));
  }

  putAudio(audio: VideoAudio): Promise<void> {
    return this.write([AUDIO], (transaction) => transaction.objectStore(AUDIO).put(audio));
  }

  async putImage(blob: Blob): Promise<string> {
    const id = crypto.randomUUID();
    this.newImages.add(id);
    await this.write([IMAGES], (transaction) => transaction.objectStore(IMAGES).put(blob, id));
    return id;
  }

  getImage(id: string): Promise<Blob | undefined> {
    return this.read<Blob | undefined>(IMAGES, (store) => store.get(id));
  }

  getSheets(key: string): Promise<ImageRef[] | undefined> {
    return this.read<ImageRef[] | undefined>(SHEET_CACHE, (store) => store.get(key));
  }

  async putSheets(key: string, refs: ImageRef[]): Promise<void> {
    await this.write([SHEET_CACHE], (transaction) =>
      transaction.objectStore(SHEET_CACHE).put(refs, key),
    );
    this.newImages.settleSaved({ refs });
  }

  // One transaction over every store that names an image, so no other tab can save a use in between.
  async releaseImages(dropped: ImageUse, unsaved: UnsavedUse): Promise<void> {
    this.newImages.settle(dropped.images);
    if (!unsaved()) return;
    await this.transact("readwrite", async (transaction) => {
      const stored = await readStoredUse(transaction);
      const inUse = unsaved();
      if (inUse) applyPlan(transaction, planRelease(stored, dropped, inUse));
    });
  }

  async countUnusedImages(unsaved: () => ImageUse): Promise<UnusedImages> {
    const unused = await this.transact("readonly", (transaction) =>
      readSweep(transaction, () => this.newImages.with(unsaved())),
    );
    return unused ?? NONE_UNUSED;
  }

  async deleteUnusedImages(
    counted: UnusedImages,
    unsaved: UnsavedUse,
  ): Promise<UnusedImages | undefined> {
    if (!unsaved()) return undefined;
    return this.transact("readwrite", async (transaction) => {
      const inUse = () => {
        const held = unsaved();
        return held && this.newImages.with(held);
      };
      const unused = await readSweep(transaction, inUse, counted);
      if (unused) applyPlan(transaction, unused);
      return unused;
    });
  }

  getVideoHandle(chatId: string): Promise<FileSystemFileHandle | undefined> {
    return this.read<FileSystemFileHandle | undefined>(VIDEO_HANDLES, (store) => store.get(chatId));
  }

  putVideoHandle(chatId: string, handle: FileSystemFileHandle): Promise<void> {
    return this.write([VIDEO_HANDLES], (transaction) =>
      transaction.objectStore(VIDEO_HANDLES).put(handle, chatId),
    );
  }

  deleteVideoHandle(chatId: string): Promise<void> {
    return this.write([VIDEO_HANDLES], (transaction) =>
      transaction.objectStore(VIDEO_HANDLES).delete(chatId),
    );
  }

  // A connection closed by a newer version's upgrade can begin nothing.
  private begin(storeNames: string[], mode: IDBTransactionMode): IDBTransaction {
    if (this.upgraded) throw new Error(UPGRADED_MESSAGE);
    return this.db.transaction(storeNames, mode);
  }

  private async read<T>(
    storeName: string,
    query: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const store = this.begin([storeName], "readonly").objectStore(storeName);
    return requestResult(query(store) as IDBRequest<T>);
  }

  private async write(
    storeNames: string[],
    apply: (transaction: IDBTransaction) => void,
  ): Promise<void> {
    const transaction = this.begin(storeNames, "readwrite");
    const done = transactionDone(transaction);
    apply(transaction);
    await done;
  }

  private async transact<T>(
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const transaction = this.begin(IMAGE_USERS, mode);
    const [result] = await Promise.all([work(transaction), transactionDone(transaction)]);
    return result;
  }
}

export function createMemoryStore(): ChatStore {
  const chats = new Map<string, Chat>();
  const folders = new Map<string, Folder>();
  const messages = new Map<string, Map<string, ChatMessage>>();
  const images = new Map<string, Blob>();
  const sheets = new Map<string, ImageRef[]>();
  const handles = new Map<string, FileSystemFileHandle>();
  const newImages = new NewImages();

  return {
    ...memoryVideoRecords(),
    ...memoryImageRelease({ chats, messages, images, sheets, newImages }),
    listChats: () => Promise.resolve([...chats.values()].map(copy).sort(newestFirst)),
    getChat: (id) => Promise.resolve(copyOptional(chats.get(id))),
    putChat: (chat) => resolved(() => chats.set(chat.id, copy(chat))),
    deleteChat: (id) =>
      resolved(() => {
        chats.delete(id);
        messages.delete(id);
        handles.delete(id);
      }),
    listVideoKeysByChat: () => Promise.resolve(memoryVideoKeys(chats, messages)),
    listFolders: () => Promise.resolve([...folders.values()].map(copy).sort(oldestFirst)),
    putFolder: (folder) => resolved(() => folders.set(folder.id, copy(folder))),
    deleteFolder: (id) => resolved(() => folders.delete(id)),
    listMessages: (chatId) =>
      Promise.resolve([...(messages.get(chatId)?.values() ?? [])].map(copy).sort(byCreatedAt)),
    putMessage: (chatId, message) =>
      resolved(() => {
        const chatMessages = messages.get(chatId) ?? new Map<string, ChatMessage>();
        chatMessages.set(message.id, copy(message));
        messages.set(chatId, chatMessages);
        newImages.settleSaved({ messages: [message] });
      }),
    deleteMessages: (chatId, ids) =>
      resolved(() => {
        const chatMessages = messages.get(chatId);
        for (const id of ids) chatMessages?.delete(id);
      }),
    putImage: (blob) => {
      const id = crypto.randomUUID();
      newImages.add(id);
      images.set(id, blob);
      return Promise.resolve(id);
    },
    getImage: (id) => Promise.resolve(images.get(id)),
    getSheets: (key) => Promise.resolve(copyOptional(sheets.get(key))),
    putSheets: (key, refs) =>
      resolved(() => {
        sheets.set(key, copy(refs));
        newImages.settleSaved({ refs });
      }),
    getVideoHandle: (chatId) => Promise.resolve(handles.get(chatId)),
    putVideoHandle: (chatId, handle) => resolved(() => handles.set(chatId, handle)),
    deleteVideoHandle: (chatId) => resolved(() => handles.delete(chatId)),
  };
}

type VideoRecords = Pick<
  ChatStore,
  "getTimeline" | "putTimeline" | "getCast" | "putCast" | "getAudio" | "putAudio"
>;

function memoryVideoRecords(): VideoRecords {
  const timelines = new Map<string, VideoTimeline>();
  const casts = new Map<string, VideoCast>();
  const audio = new Map<string, VideoAudio>();
  return {
    getTimeline: (fileKey) => Promise.resolve(copyOptional(timelines.get(fileKey))),
    putTimeline: (timeline) => resolved(() => timelines.set(timeline.fileKey, copy(timeline))),
    getCast: (fileKey) => Promise.resolve(copyOptional(casts.get(fileKey))),
    putCast: (cast) => resolved(() => casts.set(cast.fileKey, copy(cast))),
    getAudio: (fileKey) => Promise.resolve(copyOptional(audio.get(fileKey))),
    putAudio: (record) => resolved(() => audio.set(record.fileKey, copy(record))),
  };
}

interface MemoryImages {
  chats: ReadonlyMap<string, Chat>;
  messages: MemoryMessages;
  images: Map<string, Blob>;
  sheets: Map<string, ImageRef[]>;
  newImages: NewImages;
}

function memoryImageRelease({
  chats,
  messages,
  images,
  sheets,
  newImages,
}: MemoryImages): ImageRelease {
  const stored = (): StoredUse => ({
    chats: [...chats.values()],
    messages: memoryRecords(messages).map(({ message }) => message),
    sheets: [...sheets],
  });
  const sweep = (unsaved: ImageUse, only?: DeletePlan): UnusedImages => {
    const plan = planSweep(stored(), [...images.keys()], newImages.with(unsaved), only);
    return { ...plan, bytes: totalSize(plan.images.map((id) => images.get(id))) };
  };
  const apply = (plan: DeletePlan): void => {
    for (const key of plan.sheets) sheets.delete(key);
    for (const id of plan.images) images.delete(id);
  };
  return {
    releaseImages: (dropped, unsaved) =>
      settledBy(() => {
        newImages.settle(dropped.images);
        const inUse = unsaved();
        if (inUse) apply(planRelease(stored(), dropped, inUse));
      }),
    countUnusedImages: (unsaved) => settledBy(() => sweep(unsaved())),
    deleteUnusedImages: (counted, unsaved) =>
      settledBy(() => {
        const inUse = unsaved();
        if (!inUse) return undefined;
        const unused = sweep(inUse, counted);
        apply(unused);
        return unused;
      }),
  };
}

type MemoryMessages = ReadonlyMap<string, ReadonlyMap<string, ChatMessage>>;

function memoryRecords(messages: MemoryMessages): MessageOfChat[] {
  return [...messages].flatMap(([chatId, chatMessages]) =>
    [...chatMessages.values()].map((message) => ({ chatId, message })),
  );
}

function memoryVideoKeys(
  chats: ReadonlyMap<string, Chat>,
  messages: MemoryMessages,
): Map<string, string[]> {
  return videoKeysByChat([...chats.values()], memoryRecords(messages));
}

// As in IndexedDB, what throws rejects.
function settledBy<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => resolve(work()));
}

function resolved(apply: () => unknown): Promise<void> {
  apply();
  return Promise.resolve();
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function copyOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : copy(value);
}
