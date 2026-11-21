import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fileKey } from "../src/video/render";
import {
  deleteVideoCopy,
  listVideoCopies,
  loadVideoCopy,
  requestPersistentStorage,
  saveVideoCopy,
  storageEstimate,
  videoStorageSupported,
} from "../src/video/videoStore";

type Chunk = string | BufferSource | Blob;

class FakeWritable {
  static beforeClose: () => void = () => undefined;
  private readonly pending: Chunk[] = [];

  constructor(
    private readonly onClose: (chunks: Chunk[]) => void,
    private readonly beforeWrite: () => void,
  ) {}

  write(chunk: Chunk): Promise<void> {
    this.beforeWrite();
    this.pending.push(chunk);
    return Promise.resolve();
  }

  close(): Promise<void> {
    FakeWritable.beforeClose();
    this.onClose(this.pending);
    return Promise.resolve();
  }

  abort(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeFileHandle {
  chunks: Chunk[] = [];
  beforeWrite: () => void = () => undefined;

  constructor(readonly name: string) {}

  getFile(): Promise<File> {
    return Promise.resolve(new File(this.chunks, this.name, { lastModified: 999 }));
  }

  createWritable(): Promise<FakeWritable> {
    const commit = (chunks: Chunk[]) => {
      this.chunks = [...chunks];
    };
    return Promise.resolve(new FakeWritable(commit, () => this.beforeWrite()));
  }
}

class FakeDirectory {
  readonly files = new Map<string, FakeFileHandle>();
  readonly directories = new Map<string, FakeDirectory>();
  failVideoWrites?: Error;

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
    const existing = this.directories.get(name);
    if (existing !== undefined) return Promise.resolve(existing);
    if (options?.create !== true) return Promise.reject(notFound(name));
    const created = new FakeDirectory();
    this.directories.set(name, created);
    return Promise.resolve(created);
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const existing = this.files.get(name);
    if (existing !== undefined) return Promise.resolve(existing);
    if (options?.create !== true) return Promise.reject(notFound(name));
    const created = new FakeFileHandle(name);
    const failure = this.failVideoWrites;
    if (failure !== undefined && name !== "index.json") {
      created.beforeWrite = () => {
        throw failure;
      };
    }
    this.files.set(name, created);
    return Promise.resolve(created);
  }

  removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) return Promise.reject(notFound(name));
    return Promise.resolve();
  }
}

function notFound(name: string): DOMException {
  return new DOMException(`${name} not found`, "NotFoundError");
}

let root: FakeDirectory;

function installStorage(storage: object | undefined): void {
  Object.defineProperty(navigator, "storage", { value: storage, configurable: true });
}

function videos(): FakeDirectory {
  const directory = root.directories.get("videos");
  if (directory === undefined) throw new Error("No videos directory");
  return directory;
}

function videoFileNames(): string[] {
  return [...videos().files.keys()].filter((name) => name !== "index.json");
}

function clip(name = "Holiday Clip.MP4", bytes = 3000): File {
  return new File([new Uint8Array(bytes).fill(7)], name, { type: "video/mp4", lastModified: 1234 });
}

// jsdom's File has no stream() or text(); Node's matches the browser here.
beforeAll(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  root = new FakeDirectory();
  installStorage({
    getDirectory: () => Promise.resolve(root),
    estimate: () => Promise.resolve({ usage: 5000, quota: 100000 }),
    persisted: () => Promise.resolve(false),
    persist: () => Promise.resolve(true),
  });
});

afterEach(() => {
  FakeWritable.beforeClose = () => undefined;
  installStorage(undefined);
  Reflect.deleteProperty(navigator, "storage");
});

describe("saveVideoCopy and loadVideoCopy", () => {
  it("round-trips the name, size, type, lastModified and so the fileKey", async () => {
    const original = clip();
    await saveVideoCopy(fileKey(original), original);
    const loaded = await loadVideoCopy(fileKey(original));
    expect(loaded?.name).toBe("Holiday Clip.MP4");
    expect(loaded?.size).toBe(3000);
    expect(loaded?.type).toBe("video/mp4");
    expect(loaded?.lastModified).toBe(1234);
    expect(loaded === undefined ? "" : fileKey(loaded)).toBe(fileKey(original));
    expect(new Uint8Array((await loaded?.arrayBuffer()) ?? new ArrayBuffer(0))[0]).toBe(7);
  });

  it("stores the copy under a hashed name with the original extension", async () => {
    await saveVideoCopy("clip|1|2", clip());
    expect(videoFileNames()).toHaveLength(1);
    expect(videoFileNames()[0]).toMatch(/^[0-9a-f]{16}\.mp4$/);
  });

  it("reports progress up to the file size", async () => {
    const onProgress = vi.fn<(written: number, total: number) => void>();
    await saveVideoCopy("clip|1|2", clip(), onProgress);
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.at(-1)).toEqual([3000, 3000]);
  });

  it("returns undefined for a key that was never saved", async () => {
    expect(await loadVideoCopy("missing|1|2")).toBeUndefined();
  });

  it("skips rewriting a copy that is already complete", async () => {
    await saveVideoCopy("clip|1|2", clip());
    const onProgress = vi.fn<(written: number, total: number) => void>();
    await saveVideoCopy("clip|1|2", clip(), onProgress);
    expect(onProgress).not.toHaveBeenCalled();
    expect(await listVideoCopies()).toHaveLength(1);
  });
});

describe("saveVideoCopy failures", () => {
  it("removes the partial file and records nothing when aborted", async () => {
    const controller = new AbortController();
    const save = saveVideoCopy("clip|1|2", clip(), () => controller.abort(), controller.signal);
    await expect(save).rejects.toMatchObject({ name: "AbortError" });
    expect(videoFileNames()).toEqual([]);
    expect(await listVideoCopies()).toEqual([]);
    expect(await loadVideoCopy("clip|1|2")).toBeUndefined();
  });

  it("removes the finished file and records nothing when aborted while closing", async () => {
    const controller = new AbortController();
    FakeWritable.beforeClose = () => controller.abort();
    const save = saveVideoCopy("clip|1|2", clip(), undefined, controller.signal);
    await expect(save).rejects.toMatchObject({ name: "AbortError" });
    expect(videoFileNames()).toEqual([]);
    expect(await listVideoCopies()).toEqual([]);
  });

  it("does nothing when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(saveVideoCopy("clip|1|2", clip(), undefined, controller.signal)).rejects.toThrow();
    expect(videoFileNames()).toEqual([]);
  });

  it("removes the partial file when a write fails", async () => {
    await saveVideoCopy("other|1|2", clip("other.mp4", 5));
    videos().failVideoWrites = new Error("Quota exceeded");
    await expect(saveVideoCopy("clip|1|2", clip())).rejects.toThrow("Quota exceeded");
    expect(videoFileNames()).toHaveLength(1);
    expect((await listVideoCopies()).map((copy) => copy.fileKey)).toEqual(["other|1|2"]);
  });
});

describe("deleteVideoCopy and listVideoCopies", () => {
  it("lists every copy and deletes one", async () => {
    vi.spyOn(Date, "now").mockReturnValue(500);
    await saveVideoCopy("a|1|2", clip("a.mp4", 10));
    await saveVideoCopy("b|1|2", clip("b.webm", 20));
    vi.restoreAllMocks();
    expect(await listVideoCopies()).toEqual([
      { fileKey: "a|1|2", name: "a.mp4", sizeBytes: 10, storedAt: 500 },
      { fileKey: "b|1|2", name: "b.webm", sizeBytes: 20, storedAt: 500 },
    ]);
    await deleteVideoCopy("a|1|2");
    expect((await listVideoCopies()).map((copy) => copy.fileKey)).toEqual(["b|1|2"]);
    expect(videoFileNames()).toHaveLength(1);
    expect(await loadVideoCopy("a|1|2")).toBeUndefined();
  });

  it("ignores deleting a key that was never saved", async () => {
    await expect(deleteVideoCopy("missing|1|2")).resolves.toBeUndefined();
  });

  it("keeps saves started together in the index", async () => {
    await Promise.all([
      saveVideoCopy("a|1|2", clip("a.mp4", 10)),
      saveVideoCopy("b|1|2", clip("b.mp4", 20)),
    ]);
    expect((await listVideoCopies()).map((copy) => copy.fileKey).sort()).toEqual([
      "a|1|2",
      "b|1|2",
    ]);
  });
});

describe("storage estimate and persistence", () => {
  it("maps the estimate and the persisted flag", async () => {
    expect(await storageEstimate()).toEqual({
      usageBytes: 5000,
      quotaBytes: 100000,
      persisted: false,
    });
  });

  it("asks for persistent storage", async () => {
    expect(await requestPersistentStorage()).toBe(true);
  });
});

describe("without OPFS", () => {
  beforeEach(() => {
    installStorage(undefined);
    Reflect.deleteProperty(navigator, "storage");
  });

  it("reports unsupported and makes every call a safe no-op", async () => {
    expect(videoStorageSupported()).toBe(false);
    await expect(saveVideoCopy("clip|1|2", clip())).resolves.toBeUndefined();
    expect(await loadVideoCopy("clip|1|2")).toBeUndefined();
    await expect(deleteVideoCopy("clip|1|2")).resolves.toBeUndefined();
    expect(await listVideoCopies()).toEqual([]);
    expect(await storageEstimate()).toEqual({});
    expect(await requestPersistentStorage()).toBe(false);
  });

  it("reports unsupported when storage lacks getDirectory", () => {
    installStorage({ estimate: () => Promise.resolve({}) });
    expect(videoStorageSupported()).toBe(false);
  });
});
