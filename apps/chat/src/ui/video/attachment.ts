import type { VideoInfo } from "@vid2grid/core";
import {
  isRunningIn,
  overviewFor,
  pendingFor,
  pendingHolder,
  pendingVideo,
  removePendingVideo,
  setLoadedVideo,
  setOverviewStatus,
  setPendingVideo,
  updateChat,
} from "../../state";
import { errorText } from "../../text";
import type { Chat, VideoAttachment } from "../../types";
import { fileKey, probeAttachment } from "../../video/render";
import {
  attachedVideo,
  isCurrent,
  isMissing,
  pendingFileOf,
  type LoadedFile,
  type VideoPanelContext,
} from "./context";
import { startOverview } from "./overviewPrep";
import { closePlayer, readFrameTimesOf, setUrl } from "./playback";

const AGAIN_TEXT = "Click Reattach again to choose the file.";
const VIDEO_PICKER_TYPES = [
  { description: "Video", accept: { "video/*": [".mp4", ".webm", ".mov", ".mkv", ".m4v"] } },
];

function isDomError(error: unknown, ...names: string[]): boolean {
  return error instanceof DOMException && names.includes(error.name);
}

function infoFrom(video: VideoAttachment): VideoInfo {
  return { durationSeconds: video.durationSeconds, width: video.width, height: video.height };
}

async function saveChat(
  ctx: VideoPanelContext,
  chatId: string,
  change: (chat: Chat) => Chat,
): Promise<void> {
  await updateChat(ctx.state, ctx.deps.store, chatId, change);
  ctx.deps.onChatChanged();
}

// False once the video a reattach was begun for has been removed or replaced.
function stillAttached(ctx: VideoPanelContext, chatId: string, fileKey: string): boolean {
  return attachedVideo(ctx, chatId)?.fileKey === fileKey;
}

export async function restore(ctx: VideoPanelContext): Promise<void> {
  setUrl(ctx, null);
  ctx.render();
  const chat = ctx.state.currentChat;
  if (!chat?.video) return;
  const cached = ctx.files.get(chat.id);
  if (cached) {
    load(ctx, chat.id, cached);
    return;
  }
  try {
    // A stored copy opens without any permission prompt, so it is tried before the saved handle.
    const copy = await ctx.deps.loadCopy(chat.video.fileKey);
    if (!stillAttached(ctx, chat.id, chat.video.fileKey)) return;
    if (copy && (await reattachedFromCopy(ctx, chat.id, copy))) return;
    // Read again: a changed copy whose save failed leaves its new key on the chat.
    const wanted = attachedVideo(ctx, chat.id);
    if (wanted?.name !== chat.video.name) return;
    const handle = await ctx.deps.store.getVideoHandle(chat.id);
    if (!stillAttached(ctx, chat.id, wanted.fileKey)) return;
    if (!handle || ctx.skipHandle.has(chat.id)) {
      showStillMissing(ctx, chat.id, `This browser kept no copy of ${chat.video.name}.`);
      return;
    }
    if ((await handle.queryPermission?.({ mode: "read" })) !== "granted") {
      const why = `The browser needs your permission to read ${chat.video.name} again.`;
      showStillMissing(ctx, chat.id, why);
      return;
    }
    const opened = await reattachFromHandle(ctx, chat.id, handle, wanted);
    if (!opened && isCurrent(ctx, chat.id)) {
      ctx.deps.status.show(`${chat.video.name} was moved or renamed. Use Reattach to find it.`);
    }
  } catch (error) {
    if (isCurrent(ctx, chat.id) && attachedVideo(ctx, chat.id)) {
      ctx.deps.status.show(`Could not reopen ${chat.video.name}: ${errorText(error)}`, "error");
    }
  }
}

function showStillMissing(ctx: VideoPanelContext, chatId: string, why: string): void {
  if (isCurrent(ctx, chatId) && isMissing(ctx)) {
    ctx.deps.status.show(`${why} Click Reattach on the video to open it.`);
  }
}

// A stored copy that cannot be opened is passed over, so the saved handle still gets its turn.
async function reattachedFromCopy(
  ctx: VideoPanelContext,
  chatId: string,
  copy: File,
): Promise<boolean> {
  try {
    await reattach(ctx, chatId, copy);
  } catch {
    return false;
  }
  return ctx.state.video?.chatId === chatId;
}

async function fileFromHandle(handle: FileSystemFileHandle): Promise<File | undefined> {
  try {
    return await handle.getFile();
  } catch (error) {
    if (isDomError(error, "NotFoundError", "NotReadableError")) return undefined;
    throw error;
  }
}

// False when the handle no longer leads to this chat's video, so the caller falls back to a picker.
// Once the chat has another video or none, there is nothing left to open.
async function reattachFromHandle(
  ctx: VideoPanelContext,
  chatId: string,
  handle: FileSystemFileHandle,
  video: VideoAttachment,
): Promise<boolean> {
  const file = await fileFromHandle(handle);
  if (!stillAttached(ctx, chatId, video.fileKey)) return true;
  if (!file || file.name !== video.name) {
    ctx.skipHandle.add(chatId);
    return false;
  }
  await reattach(ctx, chatId, file);
  return true;
}

export async function attach(
  ctx: VideoPanelContext,
  file: File,
  handle?: FileSystemFileHandle,
): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat) return;
  const key = fileKey(file);
  if (chat.video?.fileKey === key) {
    dropPending(ctx, chat.id);
    if (handle) await saveHandle(ctx, chat.id, handle);
    if (!stillAttached(ctx, chat.id, key)) return;
    load(ctx, chat.id, { file, info: infoFrom(chat.video) });
    return;
  }
  if (isRunningIn(ctx.state, chat.id)) {
    ctx.deps.status.show("Stop or wait for the reply before changing the video.", "error");
    return;
  }
  const same = pendingFileOf(ctx, chat.id);
  if (same?.video.fileKey === key) {
    ctx.pendingFiles.set(chat.id, { ...same, handle: handle ?? same.handle });
    return;
  }
  const probed = await probe(ctx, file);
  if (!probed || !ctx.state.chats.some((entry) => entry.id === chat.id)) return;
  dropPending(ctx, chat.id);
  ctx.pendingFiles.set(chat.id, { file, info: probed.info, video: probed.attachment, handle });
  setPendingVideo(ctx.state, chat.id, probed.attachment);
  ctx.sessionFiles.set(key, file);
  readFrameTimesOf(ctx, file);
  ctx.render();
  ctx.deps.onVideoChanged();
  startOverview(ctx, chat.id);
  ctx.deps.onAttached(file, probed.attachment);
}

function dropPending(ctx: VideoPanelContext, chatId: string): void {
  const dropped = removePendingVideo(ctx.state, chatId);
  ctx.pendingFiles.delete(chatId);
  void ctx.deps.images.release(pendingHolder(dropped));
}

// Removed pending videos are let go; the chat's own video was never touched.
export function dropStalePending(ctx: VideoPanelContext): void {
  for (const [chatId, pending] of ctx.pendingFiles) {
    if (pendingVideo(pendingFor(ctx.state, chatId))?.fileKey === pending.video.fileKey) continue;
    ctx.pendingFiles.delete(chatId);
  }
}

// Saved before memory changes, so a failed save leaves the chat and the message as they were.
export async function commit(
  ctx: VideoPanelContext,
  chatId: string,
  video: VideoAttachment,
): Promise<void> {
  const pending = ctx.pendingFiles.get(chatId);
  const latest = ctx.state.chats.find((chat) => chat.id === chatId);
  if (pending?.video.fileKey !== video.fileKey || !latest) return;
  const previous = latest.video;
  // Scene notes carry no video key, so notes about the previous video would read as this one's.
  const withVideo = (entry: Chat): Chat => ({
    ...entry,
    video,
    sceneLog: entry.video?.fileKey === video.fileKey ? entry.sceneLog : [],
  });
  await ctx.deps.store.putChat(withVideo(latest));
  if (pending.handle) await saveHandle(ctx, chatId, pending.handle);
  else await ctx.deps.store.deleteVideoHandle(chatId);
  // Applied again to the newest copy, so a change another writer saved meanwhile is kept.
  await updateChat(ctx.state, ctx.deps.store, chatId, withVideo);
  ctx.pendingFiles.delete(chatId);
  load(ctx, chatId, { file: pending.file, info: pending.info });
  ctx.deps.onChatChanged();
  ctx.deps.onCommitted(pending.file, video, previous);
}

// Called once the chat no longer names the videos. What is handed back lets putBack load the file.
export function detach(
  ctx: VideoPanelContext,
  chatId: string,
  keys: ReadonlySet<string>,
): LoadedFile | undefined {
  // An older video still being opened would otherwise start to play.
  ctx.seekToken += 1;
  const { older } = ctx.playing;
  if (older && keys.has(older.video.fileKey)) closePlayer(ctx);
  if (attachedVideo(ctx, chatId)) return undefined;
  const loaded = ctx.files.get(chatId);
  ctx.files.delete(chatId);
  if (overviewFor(ctx.state, chatId) === undefined) {
    setOverviewStatus(ctx.state, chatId, null);
    ctx.renders.delete(chatId);
  }
  if (ctx.state.video?.chatId === chatId) {
    setLoadedVideo(ctx.state, null);
    setUrl(ctx, null);
  }
  ctx.render();
  return loaded;
}

export async function putBack(
  ctx: VideoPanelContext,
  chatId: string,
  loaded: LoadedFile | undefined,
): Promise<void> {
  const video = attachedVideo(ctx, chatId);
  if (loaded) ctx.files.set(chatId, loaded);
  ctx.skipHandle.delete(chatId);
  // Dropped again meanwhile, it is the chat's own once more.
  if (video && pendingFileOf(ctx, chatId)?.video.fileKey === video.fileKey) {
    dropPending(ctx, chatId);
  }
  if (isCurrent(ctx, chatId)) await restore(ctx);
}

async function saveHandle(
  ctx: VideoPanelContext,
  chatId: string,
  handle: FileSystemFileHandle,
): Promise<void> {
  await ctx.deps.store.putVideoHandle(chatId, handle);
  ctx.skipHandle.delete(chatId);
}

async function reattach(ctx: VideoPanelContext, chatId: string, file: File): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat?.video || chat.id !== chatId) return;
  if (fileKey(file) === chat.video.fileKey) {
    load(ctx, chatId, { file, info: infoFrom(chat.video) });
    return;
  }
  const { fileKey: wanted } = chat.video;
  const probed = await probe(ctx, file);
  if (!probed || !isCurrent(ctx, chatId) || !stillAttached(ctx, chatId, wanted)) return;
  await saveChat(ctx, chatId, (entry) => ({ ...entry, video: probed.attachment }));
  if (!stillAttached(ctx, chatId, probed.attachment.fileKey)) return;
  load(ctx, chatId, { file, info: probed.info });
  ctx.deps.status.show(
    `${file.name} has changed since it was attached, so earlier sheets may not match it.`,
    "error",
  );
}

async function probe(
  ctx: VideoPanelContext,
  file: File,
): Promise<Awaited<ReturnType<typeof probeAttachment>> | undefined> {
  ctx.deps.status.show(`Reading ${file.name}…`);
  try {
    const probed = await (ctx.deps.probe ?? probeAttachment)(file);
    ctx.deps.status.clear();
    return probed;
  } catch (error) {
    ctx.deps.status.show(`Could not read ${file.name}: ${errorText(error)}`, "error");
    return undefined;
  }
}

export async function requestReattach(ctx: VideoPanelContext): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat?.video) return;
  try {
    if (await reattachWithPermission(ctx, chat.id, chat.video)) return;
    await pickVideo(ctx);
  } catch (error) {
    if (!stillAttached(ctx, chat.id, chat.video.fileKey)) return;
    // The permission prompt can use up the click, so the picker may refuse to open.
    if (isDomError(error, "SecurityError", "NotAllowedError")) {
      ctx.skipHandle.add(chat.id);
      ctx.deps.status.show(AGAIN_TEXT, "error");
    } else {
      ctx.deps.status.show(`Could not reattach the video: ${errorText(error)}`, "error");
    }
  }
}

async function reattachWithPermission(
  ctx: VideoPanelContext,
  chatId: string,
  video: VideoAttachment,
): Promise<boolean> {
  if (ctx.skipHandle.has(chatId)) return false;
  const handle = await ctx.deps.store.getVideoHandle(chatId);
  if (!handle) return !stillAttached(ctx, chatId, video.fileKey);
  const permission = (await handle.requestPermission?.({ mode: "read" })) ?? "granted";
  if (!stillAttached(ctx, chatId, video.fileKey)) return true;
  if (permission !== "granted") {
    ctx.skipHandle.add(chatId);
    ctx.deps.status.show(`Reading the saved file was not allowed. ${AGAIN_TEXT}`, "error");
    return true;
  }
  return reattachFromHandle(ctx, chatId, handle, video);
}

async function pickVideo(ctx: VideoPanelContext): Promise<void> {
  if (!window.showOpenFilePicker) {
    ctx.els.video.reattachInput.click();
    return;
  }
  let picked: FileSystemFileHandle | undefined;
  try {
    [picked] = await window.showOpenFilePicker({ types: VIDEO_PICKER_TYPES });
  } catch (error) {
    if (isDomError(error, "AbortError")) return;
    throw error;
  }
  if (picked) await attach(ctx, await picked.getFile(), picked);
}

function load(ctx: VideoPanelContext, chatId: string, loaded: LoadedFile): void {
  ctx.files.set(chatId, loaded);
  ctx.sessionFiles.set(fileKey(loaded.file), loaded.file);
  readFrameTimesOf(ctx, loaded.file);
  if (!isCurrent(ctx, chatId)) return;
  setLoadedVideo(ctx.state, { chatId, ...loaded });
  setUrl(ctx, loaded.file);
  ctx.render();
  ctx.deps.onVideoChanged();
}
