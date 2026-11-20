import { beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { exportBackup, type Backup } from "../src/chat/exportChat";
import { createMemoryStore } from "../src/chat/store";
import { queryElements, type AppElements } from "../src/dom";
import { blankChat } from "../src/state";
import type { ChatStore } from "../src/types";
import { initBackup } from "../src/ui/backup";

const NOW = Date.UTC(2026, 10, 19);
const IMAGE_BYTES = 1.5 * 1024 ** 2;

let els: AppElements;
let store: ChatStore;
let toast: { show: ReturnType<typeof vi.fn> };
let download: ReturnType<typeof vi.fn<(blob: Blob, filename: string) => void>>;
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
  document.body.innerHTML = indexHtml;
  els = queryElements();
  store = createMemoryStore();
  toast = { show: vi.fn() };
  download = vi.fn<(blob: Blob, filename: string) => void>();
  onRestored = vi.fn(() => Promise.resolve());
  initBackup(els, { store, toast, download, onRestored, now: () => NOW });
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

  it("shows an error toast for a file that is not a backup", async () => {
    chooseRestoreFile(await new Response("{oops").blob());
    await vi.waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(toast.show).toHaveBeenCalledWith(
      "Could not restore the backup: This file is not a valid vid2grid chat backup: it is not JSON.",
    );
    expect(onRestored).not.toHaveBeenCalled();
  });
});
