import type { Chat, Folder } from "../../types";

const DAY_MS = 24 * 60 * 60 * 1000;
const GROUP_LABELS = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
] as const;

export type ChatGroupLabel = (typeof GROUP_LABELS)[number];

export interface ChatGroup {
  label: ChatGroupLabel;
  chats: Chat[];
}

export interface FolderSection {
  folder: Folder;
  chats: Chat[];
  expanded: boolean;
}

export interface ChatSections {
  folders: FolderSection[];
  groups: ChatGroup[];
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function groupLabel(updatedAt: number, now: number): ChatGroupLabel {
  const today = startOfDay(now);
  if (updatedAt >= today) return "Today";
  // Rounded because a day that crosses a daylight saving change is not 24 hours long.
  const daysAgo = Math.round((today - startOfDay(updatedAt)) / DAY_MS);
  if (daysAgo <= 1) return "Yesterday";
  if (daysAgo <= 7) return "Previous 7 days";
  if (daysAgo <= 30) return "Previous 30 days";
  return "Older";
}

export function groupChats(chats: readonly Chat[], now: number): ChatGroup[] {
  const groups = new Map<ChatGroupLabel, Chat[]>(GROUP_LABELS.map((label) => [label, []]));
  for (const chat of chats) groups.get(groupLabel(chat.updatedAt, now))?.push(chat);
  return [...groups].flatMap(([label, grouped]) =>
    grouped.length === 0 ? [] : [{ label, chats: grouped }],
  );
}

export function matchesSearch(chat: Chat, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [chat.title, chat.video?.name ?? ""].some((text) => text.toLowerCase().includes(needle));
}

export function byFolderName(a: Folder, b: Folder): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.createdAt - b.createdAt
  );
}

// A chat whose folder is gone, say after a restore, shows with the unfiled chats.
export function sectionChats(
  chats: readonly Chat[],
  folders: readonly Folder[],
  query: string,
  now: number,
): ChatSections {
  const searching = query.trim() !== "";
  const matching = chats.filter((chat) => matchesSearch(chat, query));
  const known = new Set(folders.map((folder) => folder.id));
  const sections = [...folders].sort(byFolderName).map((folder) => ({
    folder,
    chats: matching.filter((chat) => chat.folderId === folder.id),
    expanded: searching || folder.collapsed !== true,
  }));
  return {
    folders: searching ? sections.filter((section) => section.chats.length > 0) : sections,
    groups: groupChats(
      matching.filter((chat) => chat.folderId === undefined || !known.has(chat.folderId)),
      now,
    ),
  };
}
