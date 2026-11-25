import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankChat } from "../src/chat/chats";
import { exportBackup, type Backup } from "../src/chat/exportChat";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import type { ChatStore } from "../src/types";
import { idleImages } from "./support/images";
import { initBackup } from "../src/ui/settings/backup";
import { mountPage } from "./support/page";

const NOW = Date.UTC(2026, 10, 19);
const IMAGE_BYTES = 1.5 * 1024 ** 2;

let els: AppElements;
let store: ChatStore;
let toast: { show: ReturnType<typeof vi.fn> };
let download: ReturnType<typeof vi.fn<(blob: Blob, filename: string) => void>>;
let images: ReturnType<typeof idleImages>;
let onRestored: ReturnType<typeof vi.fn<() => Promise<void>>>;

// jsdom's Blob has no text(); a browser File does, and so does the Blob a Response makes.
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(blob);
  });
}

async function seedChat(): Promise<void> {
  const imageId = await store.putImage(
    new Blob([new Uint8Array(IMAGE_BYTES)], { type: "image/jpeg" }),
  );
  await store.putChat(blankChat("m", "c1", 1));
  await store.putMessage("c1", {
    id: "u1",
    createdAt: 1,
    role: "user",
    text: "What is this?",
    images: [{ id: imageId, pinned: false, source: { kind: "upload", name: "big.jpg" } }],
  });
}

async function downloaded(): Promise<{ backup: Backup; filename: string; size: number }> {
  els.backup.downloadButton.click();
  await vi.waitFor(() => expect(download).toHaveBeenCalled());
  const [blob, filename] = download.mock.calls[0] ?? [];
  if (!blob || filename === undefined) throw new Error("Nothing downloaded");
  return { backup: JSON.parse(await readText(blob)) as Backup, filename, size: blob.size };
}

function chooseRestoreFile(file: Blob): void {
  Object.defineProperty(els.backup.restoreInput, "files", { value: [file], configurable: true });
  els.backup.restoreInput.dispatchEvent(new Event("change"));
}

beforeEach(async () => {
  els = mountPage();
  store = createMemoryStore();
  toast = { show: vi.fn() };
  download = vi.fn<(blob: Blob, filename: string) => void>();
  onRestored = vi.fn(() => Promise.resolve());
  images = idleImages();
  initBackup(els, { store, images, toast, download, onRestored, now: () => NOW });
  await seedChat();
});

describe("downloading a backup", () => {
  it("includes images when asked and reports the size in megabytes", async () => {
    els.backup.includeImagesInput.checked = true;
    const { backup, filename, size } = await downloaded();
    expect(filename).toBe("vid2grid-chat-backup-2026-11-19.json");
    expect(backup.images).toHaveLength(1);
    expect(els.backup.status.textContent).toBe(
      `Backup downloaded, about ${(size / 1024 ** 2).toFixed(1)} MB.`,
    );
    expect(els.backup.downloadButton.disabled).toBe(false);
  });

  it("includes the larger copy kept for zooming", async () => {
    const originalId = await store.putImage(
      new Blob([new Uint8Array(IMAGE_BYTES)], { type: "image/jpeg" }),
    );
    await store.putMessage("c1", {
      id: "u2",
      createdAt: 2,
      role: "user",
      text: "Zoomable",
      images: [
        {
          id: "no-blob",
          pinned: false,
          source: { kind: "upload", name: "huge.jpg", originalId },
        },
      ],
    });
    els.backup.includeImagesInput.checked = true;
    const { backup } = await downloaded();
    expect(backup.images.map((image) => image.id)).toContain(originalId);
  });

  it("leaves images out when unticked and reports the size in kilobytes", async () => {
    els.backup.includeImagesInput.checked = false;
    const { backup, size } = await downloaded();
    expect(backup.images).toEqual([]);
    expect(backup.chats).toHaveLength(1);
    expect(els.backup.status.textContent).toBe(
      `Backup downloaded, about ${Math.max(1, Math.round(size / 1024))} KB.`,
    );
  });
});

describe("restoring a backup", () => {
  it("shows what was restored and reloads the chat list", async () => {
    const backup = await exportBackup(store, { includeImages: false });
    chooseRestoreFile(await new Response(await readText(backup)).blob());
    await vi.waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(toast.show).toHaveBeenCalledWith(
      "Restored 1 chat, 1 message, 0 images and 0 timelines.",
    );
    expect(onRestored).toHaveBeenCalledOnce();
    expect(await store.listChats()).toHaveLength(2);
  });

  it("holds what the backup refers to from before the first write until after the last", async () => {
    const video = { name: "a.mp4", fileKey: "a", durationSeconds: 1, width: 1, height: 1 };
    await store.putChat({ ...blankChat("m", "c2", 1), video });
    const backup = await exportBackup(store, { includeImages: true });
    const order: string[] = [];
    images.hold.mockImplementation(() => {
      order.push("hold");
      return { letGo: () => order.push("let go"), final: vi.fn() };
    });
    for (const name of ["putImage", "putChat", "putMessage"] as const) {
      const put = store[name].bind(store) as (...args: unknown[]) => Promise<never>;
      store[name] = (...args: unknown[]) => {
        order.push(name);
        return put(...args);
      };
    }
    chooseRestoreFile(await new Response(await readText(backup)).blob());
    await vi.waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(order).toEqual(["hold", "putImage", "putChat", "putMessage", "putChat", "let go"]);
    const [held] = images.hold.mock.calls[0] ?? [];
    expect(held?.messages).toMatchObject([{ id: "u1" }]);
    expect(held?.videoKeys).toEqual(["a"]);
  });

  it("lets go when a write fails, and says what failed", async () => {
    const letGo = vi.fn();
    images.hold.mockReturnValue({ letGo, final: vi.fn() });
    const backup = await exportBackup(store, { includeImages: false });
    store.putMessage = () => Promise.reject(new Error("Disk full"));
    chooseRestoreFile(await new Response(await readText(backup)).blob());
    await vi.waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(toast.show).toHaveBeenCalledWith("Could not restore the backup: Disk full");
    expect(letGo).toHaveBeenCalledTimes(1);
  });

  it("shows an error toast for a file that is not a backup", async () => {
    chooseRestoreFile(await new Response("{oops").blob());
    await vi.waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(toast.show).toHaveBeenCalledWith(
      "Could not restore the backup: This file is not a valid vid2grid chat backup: it is not JSON.",
    );
    expect(onRestored).not.toHaveBeenCalled();
  });
});
