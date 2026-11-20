import type {
  Chat,
  ChatMessage,
  ChatStore,
  ImageRef,
  VideoAudio,
  VideoCast,
  VideoTimeline,
} from "../types";

const DEFAULT_NAME = "vid2grid-chat";
const VERSION = 4;

const CHATS = "chats";
const MESSAGES = "messages";
const IMAGES = "images";
const SHEET_CACHE = "sheetCache";
const VIDEO_HANDLES = "videoHandles";
const TIMELINES = "timelines";
const CAST = "cast";
const AUDIO = "audio";

const BLOCKED_MESSAGE =
  "The chat database is open in an older version elsewhere. Close other vid2grid chat tabs and reload.";

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

class IndexedDbChatStore implements ChatStore {
  constructor(private readonly db: IDBDatabase) {}

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

  async listMessages(chatId: string): Promise<ChatMessage[]> {
    const records = await this.read<MessageRecord[]>(MESSAGES, (store) =>
      store.index(BY_CHAT).getAll(chatId),
    );
    return records.map((record) => record.message).sort(byCreatedAt);
  }

  putMessage(chatId: string, message: ChatMessage): Promise<void> {
    return this.write([MESSAGES], (transaction) => {
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
    await this.write([IMAGES], (transaction) => transaction.objectStore(IMAGES).put(blob, id));
    return id;
  }

  getImage(id: string): Promise<Blob | undefined> {
    return this.read<Blob | undefined>(IMAGES, (store) => store.get(id));
  }

  getSheets(key: string): Promise<ImageRef[] | undefined> {
    return this.read<ImageRef[] | undefined>(SHEET_CACHE, (store) => store.get(key));
  }

  putSheets(key: string, refs: ImageRef[]): Promise<void> {
    return this.write([SHEET_CACHE], (transaction) =>
      transaction.objectStore(SHEET_CACHE).put(refs, key),
    );
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

  private read<T>(storeName: string, query: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const store = this.db.transaction(storeName, "readonly").objectStore(storeName);
    return requestResult(query(store) as IDBRequest<T>);
  }

  private write(storeNames: string[], apply: (transaction: IDBTransaction) => void): Promise<void> {
    const transaction = this.db.transaction(storeNames, "readwrite");
    const done = transactionDone(transaction);
    apply(transaction);
    return done;
  }
}

export function createMemoryStore(): ChatStore {
  const chats = new Map<string, Chat>();
  const messages = new Map<string, Map<string, ChatMessage>>();
  const images = new Map<string, Blob>();
  const sheets = new Map<string, ImageRef[]>();
  const handles = new Map<string, FileSystemFileHandle>();
  const timelines = new Map<string, VideoTimeline>();
  const casts = new Map<string, VideoCast>();
  const audio = new Map<string, VideoAudio>();

  return {
    listChats: () => Promise.resolve([...chats.values()].map(copy).sort(newestFirst)),
    getChat: (id) => Promise.resolve(copyOptional(chats.get(id))),
    putChat: (chat) => resolved(() => chats.set(chat.id, copy(chat))),
    deleteChat: (id) =>
      resolved(() => {
        chats.delete(id);
        messages.delete(id);
        handles.delete(id);
      }),
    listMessages: (chatId) =>
      Promise.resolve([...(messages.get(chatId)?.values() ?? [])].map(copy).sort(byCreatedAt)),
    putMessage: (chatId, message) =>
      resolved(() => {
        const chatMessages = messages.get(chatId) ?? new Map<string, ChatMessage>();
        chatMessages.set(message.id, copy(message));
        messages.set(chatId, chatMessages);
      }),
    deleteMessages: (chatId, ids) =>
      resolved(() => {
        const chatMessages = messages.get(chatId);
        for (const id of ids) chatMessages?.delete(id);
      }),
    getTimeline: (fileKey) => Promise.resolve(copyOptional(timelines.get(fileKey))),
    putTimeline: (timeline) => resolved(() => timelines.set(timeline.fileKey, copy(timeline))),
    getCast: (fileKey) => Promise.resolve(copyOptional(casts.get(fileKey))),
    putCast: (cast) => resolved(() => casts.set(cast.fileKey, copy(cast))),
    getAudio: (fileKey) => Promise.resolve(copyOptional(audio.get(fileKey))),
    putAudio: (record) => resolved(() => audio.set(record.fileKey, copy(record))),
    putImage: (blob) => {
      const id = crypto.randomUUID();
      images.set(id, blob);
      return Promise.resolve(id);
    },
    getImage: (id) => Promise.resolve(images.get(id)),
    getSheets: (key) => Promise.resolve(copyOptional(sheets.get(key))),
    putSheets: (key, refs) => resolved(() => sheets.set(key, copy(refs))),
    getVideoHandle: (chatId) => Promise.resolve(handles.get(chatId)),
    putVideoHandle: (chatId, handle) => resolved(() => handles.set(chatId, handle)),
    deleteVideoHandle: (chatId) => resolved(() => handles.delete(chatId)),
  };
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
