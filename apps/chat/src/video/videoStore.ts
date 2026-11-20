const VIDEO_DIRECTORY = "videos";
const INDEX_FILE = "index.json";
const FNV_PRIME = 0x01000193;
const FNV_OFFSETS = [0x811c9dc5, 0x050c5d1f];

export interface StoredVideoInfo {
  fileKey: string;
  name: string;
  sizeBytes: number;
  storedAt: number;
}

interface IndexEntry extends StoredVideoInfo {
  fileName: string;
  type: string;
  lastModified: number;
}

export function videoStorageSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage.getDirectory === "function"
  );
}

export async function saveVideoCopy(
  fileKey: string,
  file: File,
  onProgress?: (written: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!videoStorageSupported()) return;
  const directory = await videoDirectory();
  const index = await readIndex(directory);
  const existing = index.find((entry) => entry.fileKey === fileKey);
  if (existing !== undefined && (await storedSize(directory, existing)) === file.size) return;
  const fileName = existing?.fileName ?? uniqueFileName(fileKey, file.name, index);
  try {
    await writeFile(directory, fileName, file, onProgress, signal);
    signal?.throwIfAborted();
  } catch (error) {
    await removeFile(directory, fileName);
    throw error;
  }
  const entry: IndexEntry = {
    fileKey,
    fileName,
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
    sizeBytes: file.size,
    storedAt: Date.now(),
  };
  await updateIndex(directory, (entries) => [
    ...entries.filter((other) => other.fileKey !== fileKey),
    entry,
  ]);
}

export async function loadVideoCopy(fileKey: string): Promise<File | undefined> {
  if (!videoStorageSupported()) return undefined;
  const directory = await videoDirectory();
  const entry = (await readIndex(directory)).find((other) => other.fileKey === fileKey);
  if (entry === undefined) return undefined;
  const stored = await storedFile(directory, entry.fileName);
  if (stored === undefined || stored.size !== entry.sizeBytes) return undefined;
  // Name, size and lastModified make up fileKey(), so caches and timelines still match.
  return new File([stored], entry.name, { type: entry.type, lastModified: entry.lastModified });
}

export async function deleteVideoCopy(fileKey: string): Promise<void> {
  if (!videoStorageSupported()) return;
  const directory = await videoDirectory();
  const entry = (await readIndex(directory)).find((other) => other.fileKey === fileKey);
  if (entry === undefined) return;
  await removeFile(directory, entry.fileName);
  await updateIndex(directory, (entries) => entries.filter((other) => other.fileKey !== fileKey));
}

export async function listVideoCopies(): Promise<StoredVideoInfo[]> {
  if (!videoStorageSupported()) return [];
  const index = await readIndex(await videoDirectory());
  return index.map(({ fileKey, name, sizeBytes, storedAt }) => ({
    fileKey,
    name,
    sizeBytes,
    storedAt,
  }));
}

export async function storageEstimate(): Promise<{
  usageBytes?: number;
  quotaBytes?: number;
  persisted?: boolean;
}> {
  if (typeof navigator === "undefined" || !("storage" in navigator)) return {};
  const { storage } = navigator;
  const estimate = typeof storage.estimate === "function" ? await storage.estimate() : {};
  const persisted = typeof storage.persisted === "function" ? await storage.persisted() : undefined;
  return {
    ...(estimate.usage !== undefined && { usageBytes: estimate.usage }),
    ...(estimate.quota !== undefined && { quotaBytes: estimate.quota }),
    ...(persisted !== undefined && { persisted }),
  };
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("storage" in navigator)) return false;
  return typeof navigator.storage.persist === "function" ? navigator.storage.persist() : false;
}

async function videoDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(VIDEO_DIRECTORY, { create: true });
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  file: File,
  onProgress?: (written: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  const reader = file.stream().getReader();
  let written = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      written += value.byteLength;
      onProgress?.(written, file.size);
    }
    await writable.close();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

async function storedFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
): Promise<File | undefined> {
  try {
    return await (await directory.getFileHandle(fileName)).getFile();
  } catch {
    return undefined;
  }
}

async function storedSize(
  directory: FileSystemDirectoryHandle,
  entry: IndexEntry,
): Promise<number | undefined> {
  return (await storedFile(directory, entry.fileName))?.size;
}

async function removeFile(directory: FileSystemDirectoryHandle, fileName: string): Promise<void> {
  await directory.removeEntry(fileName).catch(() => undefined);
}

async function readIndex(directory: FileSystemDirectoryHandle): Promise<IndexEntry[]> {
  const file = await storedFile(directory, INDEX_FILE);
  if (file === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return Array.isArray(parsed) ? parsed.filter(isIndexEntry) : [];
  } catch {
    return [];
  }
}

// Saves and deletes run concurrently, so index rewrites take turns.
let indexQueue: Promise<unknown> = Promise.resolve();

function updateIndex(
  directory: FileSystemDirectoryHandle,
  change: (entries: IndexEntry[]) => IndexEntry[],
): Promise<void> {
  const next = indexQueue.then(async () => {
    const entries = change(await readIndex(directory));
    const writable = await (
      await directory.getFileHandle(INDEX_FILE, { create: true })
    ).createWritable();
    await writable.write(JSON.stringify(entries));
    await writable.close();
  });
  indexQueue = next.catch(() => undefined);
  return next;
}

function isIndexEntry(value: unknown): value is IndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["fileKey"] === "string" &&
    typeof entry["fileName"] === "string" &&
    typeof entry["name"] === "string" &&
    typeof entry["type"] === "string" &&
    typeof entry["lastModified"] === "number" &&
    typeof entry["sizeBytes"] === "number" &&
    typeof entry["storedAt"] === "number"
  );
}

function uniqueFileName(fileKey: string, name: string, index: readonly IndexEntry[]): string {
  const extension = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0].toLowerCase() ?? "";
  const taken = new Set(index.map((entry) => entry.fileName));
  const base = hashKey(fileKey);
  let candidate = `${base}${extension}`;
  for (let suffix = 1; taken.has(candidate); suffix++) candidate = `${base}-${suffix}${extension}`;
  return candidate;
}

function hashKey(key: string): string {
  return FNV_OFFSETS.map((offset) => {
    let hash = offset;
    for (let i = 0; i < key.length; i++) {
      hash = Math.imul(hash ^ key.charCodeAt(i), FNV_PRIME) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }).join("");
}
