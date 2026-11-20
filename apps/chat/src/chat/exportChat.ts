import { formatSpan, formatTimestamp, sceneLogLines } from "../time";
import type {
  AssistantMessage,
  Chat,
  ChatMessage,
  ChatStore,
  ImageRef,
  ToolCall,
  ToolMessage,
  UserMessage,
  VideoCast,
  VideoTimeline,
} from "../types";
import { blobToDataUrl } from "./dataUrl";
import { imagesOf } from "./history";

export const BACKUP_FORMAT = "vid2grid-chat-backup";
export const BACKUP_VERSION = 1;
const VALID_ROLES = new Set(["user", "assistant", "tool"]);

export function chatToMarkdown(chat: Chat, messages: readonly ChatMessage[]): string {
  const sections = [`# ${chat.title}`, headerLines(chat)];
  const prompt = chat.settings.systemPrompt.trim();
  if (prompt !== "") sections.push(prompt.replace(/^/gm, "> "));
  let replies: AssistantMessage[] = [];
  const flush = () => {
    const section = assistantSection(replies, chat.settings.characterName ?? "Assistant");
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

function imageCaption({ source }: ImageRef): string {
  return source.kind === "sheet"
    ? `${source.name} from ${source.call}, ${formatSpan(source.startSeconds, source.endSeconds)}`
    : source.name;
}

function assistantSection(replies: readonly AssistantMessage[], name: string): string | undefined {
  const tools = toolSummary(replies.flatMap((reply) => reply.toolCalls));
  const texts = replies.map((reply) => reply.text.trim()).filter((text) => text !== "");
  if (tools === undefined && texts.length === 0) return undefined;
  return [`## ${name}`, ...(tools === undefined ? [] : [`_${tools}_`]), ...texts].join("\n\n");
}

function toolSummary(calls: readonly ToolCall[]): string | undefined {
  const looks: string[] = [];
  const others: string[] = [];
  let notes = 0;
  for (const call of calls) {
    const args = parsedArguments(call);
    if (call.name === "note") notes += 1;
    else if (call.name === "look") looks.push(lookSpan(args));
    else if (call.name === "frames") others.push(framesLabel(args));
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

function imageRefsOf(message: ChatMessage): readonly ImageRef[] {
  const alternates = message.role === "user" ? (message.alternates ?? []) : [];
  return [...imagesOf(message), ...alternates.flatMap((alt) => alt.messages.flatMap(imageRefsOf))];
}

async function imagesFor(store: ChatStore, chats: readonly BackupChat[]): Promise<BackupImage[]> {
  const ids = new Set(
    chats.flatMap(({ messages }) => messages.flatMap(imageRefsOf).map((ref) => ref.id)),
  );
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
  const existing = new Set((await store.listChats()).map((chat) => chat.id));
  let messageCount = 0;
  for (const { chat, messages } of backup.chats) {
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

function remapRefs(refs: readonly ImageRef[], imageIds: ReadonlyMap<string, string>): ImageRef[] {
  return refs.map((ref) => ({ ...ref, id: imageIds.get(ref.id) ?? ref.id }));
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

function parseBackup(text: string): Pick<Backup, "chats" | "timelines" | "casts" | "images"> {
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
  const { chats, timelines, casts, images } = parsed;
  if (!Array.isArray(chats) || !chats.every(isBackupChat)) throw malformed("a chat is damaged");
  if (!Array.isArray(timelines) || !timelines.every(isTimeline)) {
    throw malformed("a video timeline is damaged");
  }
  if (casts !== undefined && (!Array.isArray(casts) || !casts.every(isCast))) {
    throw malformed("a video cast is damaged");
  }
  if (!Array.isArray(images) || !images.every(isBackupImage)) {
    throw malformed("an image is damaged");
  }
  return { chats, timelines, images, ...(casts !== undefined && { casts }) };
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

function isBackupImage(value: unknown): value is BackupImage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.base64 === "string"
  );
}
