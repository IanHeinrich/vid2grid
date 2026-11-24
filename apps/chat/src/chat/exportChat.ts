import { blobToDataUrl } from "../dataUrl";
import { formatSpan, formatTimestamp } from "../time";
import type {
  AssistantMessage,
  Chat,
  ChatMessage,
  ChatStore,
  Folder,
  ImageRef,
  ImageSource,
  ToolCall,
  ToolMessage,
  UserMessage,
  ZoomTarget,
  VideoCast,
  VideoTimeline,
} from "../types";
import { imageIdsIn } from "../imageIds";
import { sceneLogLines } from "./prompts";

export const BACKUP_FORMAT = "vid2grid-chat-backup";
export const BACKUP_VERSION = 1;
const VALID_ROLES = new Set(["user", "assistant", "tool"]);

export function chatToMarkdown(chat: Chat, messages: readonly ChatMessage[]): string {
  const sections = [`# ${chat.title}`, headerLines(chat)];
  const prompt = chat.settings.systemPrompt.trim();
  if (prompt !== "") sections.push(prompt.replace(/^/gm, "> "));
  const zooms = zoomTargetsByCall(messages);
  let replies: AssistantMessage[] = [];
  const flush = () => {
    const section = assistantSection(replies, chat.settings.characterName ?? "Assistant", zooms);
    if (section !== undefined) sections.push(section);
    replies = [];
  };
  for (const message of messages) {
    if (message.role === "assistant") replies.push(message);
    if (message.role !== "user") continue;
    flush();
    sections.push(userSection(message, chat.settings.userName ?? "User"));
  }
  flush();
  if (chat.sceneLog.length > 0) {
    const notes = sceneLogLines(chat.sceneLog).map((line) => `- ${line}`);
    sections.push(["## Scene log", ...notes].join("\n"));
  }
  return `${sections.join("\n\n")}\n`;
}

function headerLines({ settings, video }: Chat): string {
  const lines = [`- Model: ${settings.modelId}`];
  if (video) lines.push(`- Video: ${video.name} (${formatTimestamp(video.durationSeconds)})`);
  return lines.join("\n");
}

function userSection(message: UserMessage, name: string): string {
  const lines = [`## ${name}`];
  if (message.text.trim() !== "") lines.push(message.text.trim());
  for (const image of message.images) lines.push(`[image: ${imageCaption(image)}]`);
  return lines.join("\n\n");
}

function zoomOf(target: ZoomTarget): string {
  return target.kind === "moment" ? formatTimestamp(target.seconds, true) : target.name;
}

function imageCaption({ source }: ImageRef): string {
  if (source.kind === "zoom") return `zoom of ${zoomOf(source.target)}`;
  return source.kind === "sheet"
    ? `${source.name} from ${source.call}, ${formatSpan(source.startSeconds, source.endSeconds)}`
    : source.name;
}

// What a zoom call looked at is on the picture it returned, not in its arguments.
function zoomTargetsByCall(messages: readonly ChatMessage[]): Map<string, ZoomTarget> {
  const targets = new Map<string, ZoomTarget>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const { source } of message.images) {
      if (source.kind === "zoom") targets.set(message.toolCallId, source.target);
    }
  }
  return targets;
}

function zoomLabel(target: ZoomTarget | undefined): string {
  if (target === undefined) return "zoom call";
  return target.kind === "moment"
    ? `Zoomed in at ${zoomOf(target)}`
    : `Zoomed in on ${zoomOf(target)}`;
}

function assistantSection(
  replies: readonly AssistantMessage[],
  name: string,
  zooms: ReadonlyMap<string, ZoomTarget>,
): string | undefined {
  const tools = toolSummary(
    replies.flatMap((reply) => reply.toolCalls),
    zooms,
  );
  const texts = replies.flatMap((reply) => {
    const text = reply.text.trim();
    if (text === "") return [];
    return [reply.toolCalls.length > 0 ? `_Before looking:_ ${text}` : text];
  });
  if (tools === undefined && texts.length === 0) return undefined;
  return [`## ${name}`, ...(tools === undefined ? [] : [`_${tools}_`]), ...texts].join("\n\n");
}

function toolSummary(
  calls: readonly ToolCall[],
  zooms: ReadonlyMap<string, ZoomTarget>,
): string | undefined {
  const looks: string[] = [];
  const others: string[] = [];
  let notes = 0;
  for (const call of calls) {
    const args = parsedArguments(call);
    if (call.name === "note") notes += 1;
    else if (call.name === "look") looks.push(lookSpan(args));
    else if (call.name === "frames") others.push(framesLabel(args));
    else if (call.name === "zoom") others.push(zoomLabel(zooms.get(call.id)));
    else others.push(`${call.name} call`);
  }
  const parts = [
    ...(looks.length > 0 ? [`Looked at ${looks.join(", ")}`] : []),
    ...others,
    ...(notes > 0 ? [`${notes} note${notes === 1 ? "" : "s"}`] : []),
  ];
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function parsedArguments(call: ToolCall): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(call.arguments);
    return typeof parsed === "object" && parsed !== null ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function lookSpan({ start, end }: Record<string, unknown>): string {
  if (typeof start !== "number" || typeof end !== "number") return "the video";
  return formatSpan(start, end);
}

function framesLabel({ times }: Record<string, unknown>): string {
  const moments = Array.isArray(times)
    ? times.filter((t): t is number => typeof t === "number")
    : [];
  return moments.length > 0
    ? `${moments.map((t) => formatTimestamp(t)).join(", ")} frames`
    : "frames";
}

interface BackupImage {
  id: string;
  type: string;
  base64: string;
}

interface BackupChat {
  chat: Chat;
  messages: ChatMessage[];
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  chats: BackupChat[];
  timelines: VideoTimeline[];
  // Absent in backups written before casts were included.
  casts?: VideoCast[];
  // Absent in backups written before folders existed.
  folders?: Folder[];
  images: BackupImage[];
}

export interface ExportOptions {
  includeImages?: boolean;
  now?: number;
}

export async function exportBackup(store: ChatStore, options: ExportOptions = {}): Promise<Blob> {
  const chats = await Promise.all(
    (await store.listChats()).map(async (chat) => ({
      chat,
      messages: await store.listMessages(chat.id),
    })),
  );
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: options.now ?? Date.now(),
    chats,
    timelines: await perVideo(chats, (key) => store.getTimeline(key)),
    casts: await perVideo(chats, (key) => store.getCast(key)),
    folders: await store.listFolders(),
    images: options.includeImages === false ? [] : await imagesFor(store, chats),
  };
  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

// A chat that swapped videos still names its earlier ones on the user messages that attached them.
function videoFileKeys(chats: readonly BackupChat[]): Set<string> {
  return new Set(
    chats.flatMap(({ chat, messages }) => [
      ...(chat.video ? [chat.video.fileKey] : []),
      ...messages.flatMap((message) =>
        message.role === "user" && message.video ? [message.video.fileKey] : [],
      ),
    ]),
  );
}

async function perVideo<T>(
  chats: readonly BackupChat[],
  get: (fileKey: string) => Promise<T | undefined>,
): Promise<T[]> {
  const found = await Promise.all([...videoFileKeys(chats)].map(get));
  return found.filter((entry) => entry !== undefined);
}

async function imagesFor(store: ChatStore, chats: readonly BackupChat[]): Promise<BackupImage[]> {
  const ids = imageIdsIn({ messages: chats.flatMap(({ messages }) => messages) });
  const images = await Promise.all(
    [...ids].map(async (id): Promise<BackupImage | undefined> => {
      const blob = await store.getImage(id);
      return blob === undefined ? undefined : { id, type: blob.type, base64: await toBase64(blob) };
    }),
  );
  return images.filter((image) => image !== undefined);
}

async function toBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function fromBase64({ base64, type }: BackupImage): Blob {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type });
}

function decodeImages(images: readonly BackupImage[]): Map<string, Blob> {
  try {
    return new Map(images.map((image) => [image.id, fromBase64(image)]));
  } catch {
    throw malformed("an image is damaged");
  }
}

export interface ImportCounts {
  chats: number;
  messages: number;
  images: number;
  timelines: number;
  casts: number;
}

export interface ImportOptions {
  newId?: () => string;
}

export async function importBackup(
  store: ChatStore,
  file: Blob,
  options: ImportOptions = {},
): Promise<ImportCounts> {
  const backup = parseBackup(await file.text());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const blobs = decodeImages(backup.images);
  const imageIds = new Map<string, string>();
  for (const [id, blob] of blobs) imageIds.set(id, await store.putImage(blob));
  const folderIds = await importFolders(store, backup.folders ?? []);
  const existing = new Set((await store.listChats()).map((chat) => chat.id));
  let messageCount = 0;
  for (const backupChat of backup.chats) {
    const { messages } = backupChat;
    const chat = keepKnownFolder(backupChat.chat, folderIds);
    const clash = existing.has(chat.id);
    const imported = clash ? { ...chat, id: newId(), title: `${chat.title} (imported)` } : chat;
    existing.add(imported.id);
    await store.putChat(imported);
    for (const message of messages) {
      await store.putMessage(imported.id, remapImages(message, imageIds));
      messageCount += 1;
    }
  }
  return {
    chats: backup.chats.length,
    messages: messageCount,
    images: imageIds.size,
    timelines: await putMissing(
      backup.timelines,
      (key) => store.getTimeline(key),
      (timeline) => store.putTimeline(timeline),
    ),
    casts: await putMissing(
      backup.casts ?? [],
      (key) => store.getCast(key),
      (cast) => store.putCast(cast),
    ),
  };
}

// A folder already in the store keeps its name and collapsed state, as with timelines and casts.
async function importFolders(store: ChatStore, folders: readonly Folder[]): Promise<Set<string>> {
  const known = new Set((await store.listFolders()).map((folder) => folder.id));
  for (const folder of folders) {
    if (known.has(folder.id)) continue;
    await store.putFolder(folder);
    known.add(folder.id);
  }
  return known;
}

function keepKnownFolder(chat: Chat, folderIds: ReadonlySet<string>): Chat {
  if (chat.folderId === undefined || folderIds.has(chat.folderId)) return chat;
  const unfiled = { ...chat };
  delete unfiled.folderId;
  return unfiled;
}

// The store's own copy may be newer than the backup's, so an existing one is kept.
async function putMissing<T extends { fileKey: string }>(
  entries: readonly T[],
  get: (fileKey: string) => Promise<T | undefined>,
  put: (entry: T) => Promise<void>,
): Promise<number> {
  let count = 0;
  for (const entry of entries) {
    if ((await get(entry.fileKey)) !== undefined) continue;
    await put(entry);
    count += 1;
  }
  return count;
}

// An id whose blob the backup does not hold is kept, since this browser may still hold it.
function remapSource(source: ImageSource, imageIds: ReadonlyMap<string, string>): ImageSource {
  if (source.kind === "upload") {
    const { originalId } = source;
    if (originalId === undefined) return source;
    return { ...source, originalId: imageIds.get(originalId) ?? originalId };
  }
  if (source.kind === "zoom" && source.target.kind === "image") {
    const { target } = source;
    return { ...source, target: { ...target, id: imageIds.get(target.id) ?? target.id } };
  }
  return source;
}

function remapRefs(refs: readonly ImageRef[], imageIds: ReadonlyMap<string, string>): ImageRef[] {
  return refs.map((ref) => ({
    ...ref,
    id: imageIds.get(ref.id) ?? ref.id,
    source: remapSource(ref.source, imageIds),
  }));
}

function remapReply(
  message: AssistantMessage | ToolMessage,
  imageIds: ReadonlyMap<string, string>,
): AssistantMessage | ToolMessage {
  return message.role === "tool"
    ? { ...message, images: remapRefs(message.images, imageIds) }
    : message;
}

function remapImages(message: ChatMessage, imageIds: ReadonlyMap<string, string>): ChatMessage {
  if (message.role !== "user") return remapReply(message, imageIds);
  const { alternates } = message;
  return {
    ...message,
    images: remapRefs(message.images, imageIds),
    ...(alternates !== undefined && {
      alternates: alternates.map((alt) => ({
        ...alt,
        messages: alt.messages.map((reply) => remapReply(reply, imageIds)),
      })),
    }),
  };
}

function malformed(problem: string): Error {
  return new Error(`This file is not a valid vid2grid chat backup: ${problem}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBackup(
  text: string,
): Pick<Backup, "chats" | "timelines" | "casts" | "folders" | "images"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw malformed("it is not JSON");
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT) {
    throw malformed("the format is missing");
  }
  if (parsed.version !== BACKUP_VERSION) {
    throw new Error(
      `This backup is version ${String(parsed.version)}, but this app reads version ${BACKUP_VERSION}.`,
    );
  }
  const { chats, timelines, casts, folders, images } = parsed;
  if (!Array.isArray(chats) || !chats.every(isBackupChat)) throw malformed("a chat is damaged");
  if (!Array.isArray(timelines) || !timelines.every(isTimeline)) {
    throw malformed("a video timeline is damaged");
  }
  if (casts !== undefined && (!Array.isArray(casts) || !casts.every(isCast))) {
    throw malformed("a video cast is damaged");
  }
  if (folders !== undefined && (!Array.isArray(folders) || !folders.every(isFolder))) {
    throw malformed("a folder is damaged");
  }
  if (!Array.isArray(images) || !images.every(isBackupImage)) {
    throw malformed("an image is damaged");
  }
  return {
    chats,
    timelines,
    images,
    ...(casts !== undefined && { casts }),
    ...(folders !== undefined && { folders }),
  };
}

function isBackupChat(value: unknown): value is BackupChat {
  if (!isRecord(value) || !isRecord(value.chat) || !Array.isArray(value.messages)) return false;
  const { id, title, settings, sceneLog } = value.chat;
  return (
    typeof id === "string" &&
    typeof title === "string" &&
    isRecord(settings) &&
    Array.isArray(sceneLog) &&
    value.messages.every(isMessage)
  );
}

function isMessage(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.role !== "string" ||
    typeof value.createdAt !== "number"
  ) {
    return false;
  }
  if (!VALID_ROLES.has(value.role)) return false;
  return value.role === "assistant" || (Array.isArray(value.images) && value.images.every(isRef));
}

function isRef(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && isRecord(value.source);
}

function isTimeline(value: unknown): value is VideoTimeline {
  return isRecord(value) && typeof value.fileKey === "string" && Array.isArray(value.entries);
}

function isCast(value: unknown): value is VideoCast {
  return isRecord(value) && typeof value.fileKey === "string" && Array.isArray(value.cards);
}

function isFolder(value: unknown): value is Folder {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "number"
  );
}

function isBackupImage(value: unknown): value is BackupImage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.base64 === "string"
  );
}
