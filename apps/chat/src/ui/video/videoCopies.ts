import type { AppElements } from "../../dom";
import { pendingVideo, type AppState } from "../../state";
import { errorText } from "../../text";
import type { ChatStore } from "../../types";
import {
  deleteVideoCopy,
  listVideoCopies,
  loadVideoCopy,
  requestPersistentStorage,
  saveVideoCopy,
  storageEstimate,
  videoStorageSupported,
  type StoredVideoInfo,
} from "../../video/videoStore";
import type { StatusLine } from "../shared/status";

export interface VideoStorage {
  supported(): boolean;
  save(
    fileKey: string,
    file: File,
    onProgress?: (written: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  load(fileKey: string): Promise<File | undefined>;
  remove(fileKey: string): Promise<void>;
  list(): Promise<StoredVideoInfo[]>;
  estimate(): Promise<{ usageBytes?: number; quotaBytes?: number; persisted?: boolean }>;
  persist(): Promise<boolean>;
}

const browserStorage: VideoStorage = {
  supported: videoStorageSupported,
  save: (fileKey, file, onProgress, signal) => saveVideoCopy(fileKey, file, onProgress, signal),
  load: loadVideoCopy,
  remove: deleteVideoCopy,
  list: listVideoCopies,
  estimate: storageEstimate,
  persist: requestPersistentStorage,
};

export interface VideoCopies {
  // Asks about a large file when it is dropped, so sending it never waits on the question.
  approve(file: File, fileKey: string): void;
  save(file: File, fileKey: string): void;
  load(fileKey: string): Promise<File | undefined>;
  release(fileKey: string): Promise<void>;
  status(fileKey: string | undefined): string;
  renderList(): Promise<void>;
}

export interface VideoCopiesDeps {
  store: ChatStore;
  status: StatusLine;
  confirm(message: string): boolean;
  onProgress(): void;
  storage?: VideoStorage;
}

interface Write {
  controller: AbortController;
  done: Promise<void>;
}

interface CopiesContext {
  els: AppElements["settingsDialog"];
  state: AppState;
  deps: VideoCopiesDeps;
  storage: VideoStorage;
  saving: Map<string, number>;
  writes: Map<string, Write>;
  askedForPersistence: boolean;
  toldUnsupported: boolean;
  answers: Map<string, boolean>;
}

export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit] ?? ""}`;
}

export function initVideoCopies(
  els: Pick<AppElements, "settingsDialog">,
  state: AppState,
  deps: VideoCopiesDeps,
): VideoCopies {
  const ctx: CopiesContext = {
    els: els.settingsDialog,
    state,
    deps,
    storage: deps.storage ?? browserStorage,
    saving: new Map(),
    writes: new Map(),
    askedForPersistence: false,
    toldUnsupported: false,
    answers: new Map(),
  };
  return {
    approve: (file, fileKey) => approve(ctx, file, fileKey),
    save: (file, fileKey) => save(ctx, file, fileKey),
    load: (fileKey) => load(ctx, fileKey),
    release: (fileKey) => release(ctx, fileKey),
    status: (fileKey) => {
      const percent = fileKey === undefined ? undefined : ctx.saving.get(fileKey);
      return percent === undefined ? "" : `Saving copy ${percent}%`;
    },
    renderList: () => renderList(ctx),
  };
}

const UNSUPPORTED_TEXT =
  "This browser cannot keep copies of videos, so attach the file again after a restart.";

function keepQuestion(file: File): string {
  return `Keep a ${formatBytes(file.size)} copy of ${file.name} in this browser, so it opens again after a restart?`;
}

function approve(ctx: CopiesContext, file: File, fileKey: string): void {
  const { settings } = ctx.state;
  if (!settings.keepVideoCopies || !ctx.storage.supported() || ctx.answers.has(fileKey)) return;
  if (file.size <= settings.askAboveBytes) return;
  ctx.answers.set(fileKey, ctx.deps.confirm(keepQuestion(file)));
}

function save(ctx: CopiesContext, file: File, fileKey: string): void {
  const { settings } = ctx.state;
  if (!settings.keepVideoCopies || ctx.saving.has(fileKey)) return;
  if (!ctx.storage.supported()) {
    if (!ctx.toldUnsupported) ctx.deps.status.show(UNSUPPORTED_TEXT);
    ctx.toldUnsupported = true;
    return;
  }
  const answer = ctx.answers.get(fileKey);
  if (answer === false) return;
  const large = file.size > settings.askAboveBytes;
  if (answer === undefined && large && !ctx.deps.confirm(keepQuestion(file))) return;
  if (!ctx.askedForPersistence) {
    ctx.askedForPersistence = true;
    void ctx.storage.persist().catch(() => false);
  }
  ctx.saving.set(fileKey, 0);
  ctx.deps.onProgress();
  const controller = new AbortController();
  const done = ctx.storage
    .save(
      fileKey,
      file,
      (written, total) => {
        ctx.saving.set(fileKey, total > 0 ? Math.floor((written / total) * 100) : 0);
        ctx.deps.onProgress();
      },
      controller.signal,
    )
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      ctx.deps.status.show(`Could not keep a copy of ${file.name}: ${errorText(error)}`, "error");
    })
    .finally(() => {
      ctx.saving.delete(fileKey);
      ctx.writes.delete(fileKey);
      ctx.deps.onProgress();
    });
  ctx.writes.set(fileKey, { controller, done });
}

async function load(ctx: CopiesContext, fileKey: string): Promise<File | undefined> {
  if (!ctx.storage.supported()) return undefined;
  try {
    return await ctx.storage.load(fileKey);
  } catch (error) {
    // Undefined lets the caller fall back to the saved file handle, then to reattaching.
    ctx.deps.status.show(`Could not open the stored copy: ${errorText(error)}`, "error");
    return undefined;
  }
}

async function release(ctx: CopiesContext, fileKey: string): Promise<void> {
  if (!ctx.storage.supported()) return;
  const pending = [...ctx.state.pending.values()].map(pendingVideo);
  if (pending.some((video) => video?.fileKey === fileKey)) return;
  const chats = await ctx.deps.store.listChats();
  if (chats.some((chat) => chat.video?.fileKey === fileKey)) return;
  await stopWriting(ctx, fileKey);
  await ctx.storage.remove(fileKey);
}

async function stopWriting(ctx: CopiesContext, fileKey: string): Promise<void> {
  const write = ctx.writes.get(fileKey);
  if (!write) return;
  write.controller.abort();
  await write.done;
}

async function renderList(ctx: CopiesContext): Promise<void> {
  const { storedVideoList, storageUsage } = ctx.els;
  if (!ctx.storage.supported()) {
    storageUsage.textContent = "This browser cannot keep copies of videos.";
    storedVideoList.replaceChildren();
    return;
  }
  const [copies, estimate, chats] = await Promise.all([
    ctx.storage.list(),
    ctx.storage.estimate(),
    ctx.deps.store.listChats(),
  ]);
  const used = estimate.usageBytes === undefined ? "" : formatBytes(estimate.usageBytes);
  const quota = estimate.quotaBytes === undefined ? "" : ` of ${formatBytes(estimate.quotaBytes)}`;
  const persisted =
    estimate.persisted === undefined
      ? ""
      : estimate.persisted
        ? " Storage is persistent."
        : " The browser may clear this storage when space runs low.";
  storageUsage.textContent = `${copies.length === 0 ? "No stored videos." : `Using ${used}${quota}.`}${persisted}`;
  storedVideoList.replaceChildren(
    ...copies.map((copy) => {
      const users = chats
        .filter((chat) => chat.video?.fileKey === copy.fileKey)
        .map((chat) => chat.title);
      return storedItem(ctx, copy, users);
    }),
  );
}

function storedItem(ctx: CopiesContext, copy: StoredVideoInfo, users: string[]): HTMLLIElement {
  const item = document.createElement("li");
  const name = document.createElement("span");
  name.className = "stored-video-name";
  name.textContent = `${copy.name} · ${formatBytes(copy.sizeBytes)}`;
  const usedBy = document.createElement("span");
  usedBy.className = "muted small";
  usedBy.textContent = users.length > 0 ? `Used by ${users.join(", ")}` : "Not used by any chat";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button ghost";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    const ask = `Remove the stored copy of ${copy.name}? ${users.join(", ")} will need the video file attached again before the model can watch it.`;
    if (users.length > 0 && !ctx.deps.confirm(ask)) return;
    stopWriting(ctx, copy.fileKey)
      .then(() => ctx.storage.remove(copy.fileKey))
      .then(() => renderList(ctx))
      .catch((error: unknown) => {
        ctx.deps.status.show(`Could not remove ${copy.name}: ${errorText(error)}`, "error");
      });
  });
  item.append(name, usedBy, remove);
  return item;
}
