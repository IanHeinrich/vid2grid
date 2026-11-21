import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setPendingVideo, type AppState } from "../src/state";
import type { ChatStore } from "../src/types";
import { formatBytes, initVideoCopies, type VideoStorage } from "../src/ui/videoCopies";
import { mountPage } from "./support/page";

let els: AppElements;
let state: AppState;
let store: ChatStore;
let storage: ReturnType<typeof fakeStorage>;
let confirm: ReturnType<typeof vi.fn>;

function fakeStorage() {
  let finish: () => void = () => undefined;
  let report: (written: number, total: number) => void = () => undefined;
  const fake = {
    supported: (): boolean => true,
    save: vi.fn(
      (
        _key: string,
        _file: File,
        onProgress?: (written: number, total: number) => void,
        signal?: AbortSignal,
      ) => {
        report = onProgress ?? report;
        return new Promise<void>((resolve, reject) => {
          finish = resolve;
          signal?.addEventListener("abort", () => reject(new Error("Aborted")));
        });
      },
    ),
    load: vi.fn((): Promise<File | undefined> => Promise.resolve(undefined)),
    remove: vi.fn(() => Promise.resolve()),
    list: vi.fn(() =>
      Promise.resolve([
        { fileKey: "k1", name: "beach.mp4", sizeBytes: 3 * 1024 ** 3, storedAt: 1 },
      ]),
    ),
    estimate: vi.fn(() =>
      Promise.resolve({ usageBytes: 3 * 1024 ** 3, quotaBytes: 100 * 1024 ** 3, persisted: true }),
    ),
    persist: vi.fn(() => Promise.resolve(true)),
  } satisfies VideoStorage;
  return { fake, finish: () => finish(), report: (w: number, t: number) => report(w, t) };
}

let status: { show: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };

function copies() {
  return initVideoCopies(els, state, {
    store,
    status,
    confirm,
    onProgress: vi.fn(),
    storage: storage.fake,
  });
}

function bigFile(bytes: number): File {
  const file = new File(["x"], "beach.mp4", { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

beforeEach(() => {
  els = mountPage();
  state = createAppState({ ...DEFAULT_SETTINGS, askAboveBytes: 1000 });
  store = createMemoryStore();
  storage = fakeStorage();
  confirm = vi.fn(() => true);
  status = { show: vi.fn(), clear: vi.fn() };
});

describe("formatBytes", () => {
  it("picks a readable unit", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});

describe("saving", () => {
  it("saves a copy in the background and reports progress", async () => {
    const kept = copies();
    kept.save(bigFile(500), "k1");
    expect(confirm).not.toHaveBeenCalled();
    expect(storage.fake.persist).toHaveBeenCalledTimes(1);
    storage.report(200, 500);
    expect(kept.status("k1")).toBe("Saving copy 40%");
    storage.finish();
    await vi.waitFor(() => expect(kept.status("k1")).toBe(""));
  });

  it("asks first above the size threshold and skips when declined", () => {
    confirm.mockReturnValue(false);
    copies().save(bigFile(5000), "k1");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Keep a"));
    expect(storage.fake.save).not.toHaveBeenCalled();
  });

  it("asks about a large file on drop and writes it on send without asking again", () => {
    const kept = copies();
    kept.approve(bigFile(5000), "k1");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(storage.fake.save).not.toHaveBeenCalled();
    kept.save(bigFile(5000), "k1");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(storage.fake.save).toHaveBeenCalledTimes(1);
  });

  it("writes nothing on send when the copy was declined on drop", () => {
    confirm.mockReturnValue(false);
    const kept = copies();
    kept.approve(bigFile(5000), "k1");
    kept.save(bigFile(5000), "k1");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(storage.fake.save).not.toHaveBeenCalled();
  });

  it("asks nothing on drop for a small file", () => {
    copies().approve(bigFile(10), "k1");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps nothing when copies are switched off", () => {
    state = createAppState({ ...DEFAULT_SETTINGS, keepVideoCopies: false });
    copies().save(bigFile(10), "k1");
    expect(storage.fake.save).not.toHaveBeenCalled();
  });

  it("says once when the browser cannot keep copies", () => {
    storage.fake.supported = () => false;
    const kept = copies();
    kept.save(bigFile(10), "k1");
    kept.save(bigFile(10), "k2");
    expect(status.show).toHaveBeenCalledTimes(1);
    expect(status.show).toHaveBeenCalledWith(
      "This browser cannot keep copies of videos, so attach the file again after a restart.",
    );
    expect(storage.fake.save).not.toHaveBeenCalled();
  });
});

describe("releasing", () => {
  it("deletes a copy only once no chat uses its video", async () => {
    const video = { name: "beach.mp4", fileKey: "k1", durationSeconds: 1, width: 1, height: 1 };
    await store.putChat({ ...blankChat("m", "branch", 1), video });
    const kept = copies();
    await kept.release("k1");
    expect(storage.fake.remove).not.toHaveBeenCalled();
    await store.deleteChat("branch");
    await kept.release("k1");
    expect(storage.fake.remove).toHaveBeenCalledWith("k1");
  });

  it("keeps a copy whose video is waiting to be sent in some chat", async () => {
    const video = { name: "beach.mp4", fileKey: "k1", durationSeconds: 1, width: 1, height: 1 };
    setPendingVideo(state, "other", video);
    await copies().release("k1");
    expect(storage.fake.remove).not.toHaveBeenCalled();
  });

  it("aborts a save still writing and waits for it before deleting", async () => {
    const kept = copies();
    kept.save(bigFile(500), "k1");
    const signal = storage.fake.save.mock.calls[0]?.[3];
    await kept.release("k1");
    expect(signal?.aborted).toBe(true);
    expect(storage.fake.remove).toHaveBeenCalledWith("k1");
    expect(kept.status("k1")).toBe("");
    expect(status.show).not.toHaveBeenCalled();
  });
});

describe("loading", () => {
  it("reports a failed load and returns nothing, so the caller can fall back", async () => {
    storage.fake.load.mockRejectedValueOnce(new Error("corrupt"));
    expect(await copies().load("k1")).toBeUndefined();
    expect(status.show).toHaveBeenCalledWith(expect.stringContaining("corrupt"), "error");
  });
});

describe("stored videos list", () => {
  it("lists copies with their size, users and storage usage, and removes one", async () => {
    const video = { name: "beach.mp4", fileKey: "k1", durationSeconds: 1, width: 1, height: 1 };
    await store.putChat({ ...blankChat("m", "chat", 1), title: "Beach day", video });
    await copies().renderList();
    const item = els.settingsDialog.storedVideoList.querySelector("li");
    expect(item?.textContent).toContain("beach.mp4 · 3.0 GB");
    expect(item?.textContent).toContain("Used by Beach day");
    expect(els.settingsDialog.storageUsage.textContent).toBe(
      "Using 3.0 GB of 100 GB. Storage is persistent.",
    );
    confirm.mockReturnValueOnce(false);
    item?.querySelector("button")?.click();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Beach day will need"));
    expect(storage.fake.remove).not.toHaveBeenCalled();
    item?.querySelector("button")?.click();
    await vi.waitFor(() => expect(storage.fake.remove).toHaveBeenCalledWith("k1"));
  });

  it("removes a copy no chat uses without asking", async () => {
    await copies().renderList();
    els.settingsDialog.storedVideoList.querySelector("button")?.click();
    await vi.waitFor(() => expect(storage.fake.remove).toHaveBeenCalledWith("k1"));
    expect(confirm).not.toHaveBeenCalled();
  });
});
