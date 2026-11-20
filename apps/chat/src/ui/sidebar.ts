import { chatToMarkdown } from "../chat/exportChat";
import type { AppElements, StatusLine } from "../dom";
import {
  blankChat,
  currentPending,
  defaultModelId,
  pendingFor,
  removeChat,
  replaceChat,
  updateChat,
  type AppState,
} from "../state";
import { errorText } from "../text";
import type { Chat, ChatMessage, ChatStore } from "../types";
import { iconButton, inlineEdit } from "./buttons";
import { downloadBlob, safeFilename } from "./download";
import { icon } from "./icons";
import type { Toast } from "./toast";

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

export interface Sidebar {
  render(): void;
  createChat(): Promise<Chat>;
}

export interface SidebarDeps {
  store: ChatStore;
  status: StatusLine;
  toast: Toast;
  onOpen(chatId: string): void;
  onDeletingCurrent(): void;
  onCurrentDeleted(): void;
  onDeleted(chat: Chat): void;
  // The undo window has passed, so what the chat alone held can be let go.
  onDeleteFinal(chat: Chat): void;
  onRenamed(): void;
  onOpenSettings(): void;
  onFocusComposer(): void;
  newId?: () => string;
  now?: () => number;
}

interface DeletedChat {
  chat: Chat;
  messages: ChatMessage[];
  handle: FileSystemFileHandle | undefined;
  wasCurrent: boolean;
}

interface SidebarContext {
  els: AppElements["sidebar"];
  state: AppState;
  deps: SidebarDeps;
  renamingId: string | null;
}

export function initSidebar(
  els: Pick<AppElements, "sidebar">,
  state: AppState,
  deps: SidebarDeps,
): Sidebar {
  const ctx: SidebarContext = { els: els.sidebar, state, deps, renamingId: null };
  const createChat = async (): Promise<Chat> => {
    const newId = deps.newId ?? (() => crypto.randomUUID());
    const chat = blankChat(defaultModelId(state), newId(), (deps.now ?? Date.now)());
    await deps.store.putChat(chat);
    replaceChat(state, chat);
    renderList(ctx);
    return chat;
  };
  els.sidebar.newChatButton.addEventListener("click", () => {
    startNewChat(ctx, createChat).catch((error: unknown) =>
      showError(ctx, "Could not create a chat", error),
    );
  });
  els.sidebar.openSettingsButton.addEventListener("click", () => deps.onOpenSettings());
  const { searchInput } = els.sidebar;
  searchInput.addEventListener("input", () => renderList(ctx));
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || searchInput.value === "") return;
    event.preventDefault();
    searchInput.value = "";
    renderList(ctx);
  });
  renderList(ctx);
  return { render: () => renderList(ctx), createChat };
}

function isBlank(chat: Chat): boolean {
  return chat.video === undefined && chat.settings.systemPrompt.trim() === "";
}

// An empty chat is reused rather than duplicated: the current one gets focus, another one opens.
async function startNewChat(ctx: SidebarContext, createChat: () => Promise<Chat>): Promise<void> {
  const { state, deps } = ctx;
  const current = state.currentChat;
  if (
    current &&
    isBlank(current) &&
    state.messages.length === 0 &&
    currentPending(state).length === 0
  ) {
    deps.onFocusComposer();
    return;
  }
  for (const chat of state.chats) {
    if (chat.id === current?.id || !isBlank(chat) || pendingFor(state, chat.id).length > 0)
      continue;
    if ((await deps.store.listMessages(chat.id)).length === 0) {
      deps.onOpen(chat.id);
      return;
    }
  }
  deps.onOpen((await createChat()).id);
}

function showError(ctx: SidebarContext, action: string, error: unknown): void {
  ctx.deps.status.show(`${action}: ${errorText(error)}`, "error");
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

// A background re-render would throw away the title being typed, so it waits for the rename.
function renderList(ctx: SidebarContext): void {
  if (ctx.renamingId !== null) return;
  const { chatList, searchInput } = ctx.els;
  const query = searchInput.value;
  const chats = ctx.state.chats.filter((chat) => matchesSearch(chat, query));
  if (chats.length === 0 && query.trim() !== "") {
    const none = document.createElement("li");
    none.className = "chat-list-empty muted small";
    none.textContent = "No chats match.";
    chatList.replaceChildren(none);
    return;
  }
  const now = (ctx.deps.now ?? Date.now)();
  chatList.replaceChildren(...groupChats(chats, now).map((group) => groupItem(ctx, group)));
}

function groupItem(ctx: SidebarContext, group: ChatGroup): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "chat-group";
  const title = document.createElement("span");
  title.className = "chat-group-title";
  title.textContent = group.label;
  const list = document.createElement("ul");
  list.className = "chat-group-list";
  list.setAttribute("aria-label", group.label);
  list.append(...group.chats.map((chat) => chatItem(ctx, chat)));
  item.append(title, list);
  return item;
}

function chatItem(ctx: SidebarContext, chat: Chat): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "chat-item";
  item.dataset["chatId"] = chat.id;
  const isCurrent = ctx.state.currentChat?.id === chat.id;
  item.classList.toggle("is-current", isCurrent);

  const open = document.createElement("button");
  open.type = "button";
  open.className = "chat-open";
  open.textContent = chat.title;
  open.title = chat.video ? `${chat.title}\nVideo: ${chat.video.name}` : chat.title;
  if (chat.video) open.prepend(videoMarker());
  if (isCurrent) open.setAttribute("aria-current", "true");
  open.addEventListener("click", () => ctx.deps.onOpen(chat.id));

  const rename = actionButton("chat-rename", "Rename", "✎", () =>
    startRename(ctx, item, open, chat),
  );
  const exportButton = actionButton(
    "chat-export",
    "Export as Markdown",
    icon("download", 14),
    () => {
      exportChat(ctx, chat).catch((error: unknown) =>
        ctx.deps.toast.show(`Could not export the chat: ${errorText(error)}`),
      );
    },
  );
  const remove = actionButton("chat-delete", "Delete", "×", () => {
    deleteChat(ctx, chat.id).catch((error: unknown) =>
      ctx.deps.toast.show(`Could not delete the chat: ${errorText(error)}`),
    );
  });

  const actions = document.createElement("div");
  actions.className = "chat-actions";
  actions.append(rename, exportButton, remove);
  item.append(open, actions);
  return item;
}

function videoMarker(): SVGSVGElement {
  const marker = icon("video", 14);
  marker.classList.add("chat-video-icon");
  return marker;
}

function actionButton(
  className: string,
  label: string,
  glyph: string | Node,
  onClick: () => void,
): HTMLButtonElement {
  return iconButton(`chat-action ${className}`, label, glyph, onClick);
}

async function exportChat(ctx: SidebarContext, chat: Chat): Promise<void> {
  const messages = await ctx.deps.store.listMessages(chat.id);
  const markdown = chatToMarkdown(chat, messages);
  downloadBlob(new Blob([markdown], { type: "text/markdown" }), `${safeFilename(chat.title)}.md`);
}

function startRename(
  ctx: SidebarContext,
  item: HTMLLIElement,
  open: HTMLButtonElement,
  chat: Chat,
): void {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "chat-rename-input";
  input.value = chat.title;
  input.setAttribute("aria-label", "Chat title");
  inlineEdit(input, (commit) => {
    ctx.renamingId = null;
    if (!commit) {
      renderList(ctx);
      return;
    }
    renameChat(ctx, chat, input.value).catch((error: unknown) => {
      renderList(ctx);
      showError(ctx, "Could not rename the chat", error);
    });
  });
  ctx.renamingId = chat.id;
  item.classList.add("is-renaming");
  open.replaceWith(input);
  input.focus();
  input.select();
}

async function renameChat(ctx: SidebarContext, chat: Chat, value: string): Promise<void> {
  const title = value.trim();
  const latest = ctx.state.chats.find((entry) => entry.id === chat.id);
  if (title === "" || latest === undefined || title === latest.title) {
    renderList(ctx);
    return;
  }
  await updateChat(ctx.state, ctx.deps.store, chat.id, (entry) => ({ ...entry, title }));
  renderList(ctx);
  ctx.deps.onRenamed();
}

async function deleteChat(ctx: SidebarContext, chatId: string): Promise<void> {
  const { state, deps } = ctx;
  const chat = state.chats.find((entry) => entry.id === chatId);
  if (!chat) return;
  const wasCurrent = state.currentChat?.id === chat.id;
  if (wasCurrent) deps.onDeletingCurrent();
  // Removed from the state first, so a stopping turn sees the chat is gone and stops writing.
  removeChat(state, chat.id);
  renderList(ctx);
  let deleted: DeletedChat;
  try {
    const [messages, handle] = await Promise.all([
      deps.store.listMessages(chat.id),
      deps.store.getVideoHandle(chat.id),
    ]);
    deleted = { chat, messages, handle, wasCurrent };
    await deps.store.deleteChat(chat.id);
  } catch (error) {
    replaceChat(state, chat);
    renderList(ctx);
    if (wasCurrent) deps.onOpen(chat.id);
    throw error;
  }
  deps.onDeleted(chat);
  if (wasCurrent) deps.onCurrentDeleted();
  deps.toast.show(`Deleted "${chat.title}"`, {
    label: "Undo",
    run: () => {
      restoreChat(ctx, deleted).catch((error: unknown) => {
        deps.toast.show(`Could not restore the chat: ${errorText(error)}`);
        deps.onDeleteFinal(chat);
      });
    },
    expired: () => deps.onDeleteFinal(chat),
  });
}

async function restoreChat(ctx: SidebarContext, deleted: DeletedChat): Promise<void> {
  const { chat, messages, handle, wasCurrent } = deleted;
  await ctx.deps.store.putChat(chat);
  for (const message of messages) await ctx.deps.store.putMessage(chat.id, message);
  if (handle) await ctx.deps.store.putVideoHandle(chat.id, handle);
  replaceChat(ctx.state, chat);
  renderList(ctx);
  if (wasCurrent) ctx.deps.onOpen(chat.id);
}
