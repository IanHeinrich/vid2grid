import { blankChat } from "../../chat/chats";
import { chatToMarkdown } from "../../chat/exportChat";
import { defaultModelId } from "../../chat/models";
import { videoKeysOf } from "../../chat/store";
import type { AppElements } from "../../dom";
import type { ImageHolder } from "../../imageIds";
import {
  currentPending,
  pendingFor,
  pendingHolder,
  removeChat,
  replaceChat,
  updateChat,
  type AppState,
} from "../../state";
import { errorText, plural } from "../../text";
import type { Chat, ChatMessage, ChatStore, Folder } from "../../types";
import { iconButton, inlineEdit } from "../shared/buttons";
import { byFolderName, sectionChats, type ChatGroup, type FolderSection } from "./chatSections";
import { downloadBlob, safeFilename } from "../shared/download";
import { icon } from "../shared/icons";
import { attachMenu } from "../shared/menu";
import type { StatusLine } from "../shared/status";
import type { HeldImages, ImageCleanup } from "../../app/imageCleanup";
import { offerUndo } from "../../app/undo";
import type { Toast } from "../shared/toast";

const NEW_FOLDER_NAME = "New folder";
const DRAG_TYPE = "application/x-vid2grid-chat";
const MOVE_OPTION = ".chat-move-option";

export interface Sidebar {
  render(): void;
  createChat(): Promise<Chat>;
}

export interface SidebarDeps {
  store: ChatStore;
  status: StatusLine;
  toast: Toast;
  images: Pick<ImageCleanup, "hold" | "release">;
  onOpen(chatId: string): void;
  onDeletingCurrent(): void;
  onCurrentDeleted(): void;
  onDeleted(chat: Chat): void;
  // The undo window has passed, so what the chat alone held can be let go.
  onDeleteFinal(videoKeys: string[]): void;
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
  // Dropped with the chat and not brought back with it.
  pending: ImageHolder;
}

interface SidebarContext {
  els: AppElements["sidebar"];
  state: AppState;
  deps: SidebarDeps;
  renamingId: string | null;
  folders: Folder[];
  // Bumped by every local folder change, so a store read that began before it is dropped.
  foldersVersion: number;
  draggingId: string | null;
  closeMoveMenu: (() => void) | null;
}

interface RenameTarget {
  id: string;
  value: string;
  label: string;
  row: HTMLElement;
  shown: HTMLElement;
  failure: string;
  save(value: string): Promise<void>;
}

export function initSidebar(
  els: Pick<AppElements, "sidebar">,
  state: AppState,
  deps: SidebarDeps,
): Sidebar {
  const ctx: SidebarContext = {
    els: els.sidebar,
    state,
    deps,
    renamingId: null,
    folders: [],
    foldersVersion: 0,
    draggingId: null,
    closeMoveMenu: null,
  };
  const createChat = async (): Promise<Chat> => {
    const chat = blankChat(defaultModelId(state), newId(ctx), now(ctx));
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
  els.sidebar.newFolderButton.addEventListener("click", () => {
    createFolder(ctx).catch((error: unknown) => showError(ctx, "Could not create a folder", error));
  });
  els.sidebar.openSettingsButton.addEventListener("click", () => deps.onOpenSettings());
  listenForSearch(ctx);
  acceptDrops(ctx, els.sidebar.chatList, undefined);
  const render = () => {
    renderList(ctx);
    syncFolders(ctx);
  };
  render();
  return { render, createChat };
}

function listenForSearch(ctx: SidebarContext): void {
  const { searchInput } = ctx.els;
  searchInput.addEventListener("input", () => renderList(ctx));
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || searchInput.value === "") return;
    event.preventDefault();
    searchInput.value = "";
    renderList(ctx);
  });
}

function newId(ctx: SidebarContext): string {
  return (ctx.deps.newId ?? (() => crypto.randomUUID()))();
}

function now(ctx: SidebarContext): number {
  return (ctx.deps.now ?? Date.now)();
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

// A background re-render would throw away the title being typed, so it waits for the rename.
function renderList(ctx: SidebarContext): void {
  if (ctx.renamingId !== null) return;
  ctx.closeMoveMenu?.();
  const { chatList, searchInput } = ctx.els;
  const query = searchInput.value;
  const { folders, groups } = sectionChats(ctx.state.chats, ctx.folders, query, now(ctx));
  if (folders.length === 0 && groups.length === 0 && query.trim() !== "") {
    const none = document.createElement("li");
    none.className = "chat-list-empty muted small";
    none.textContent = "No chats match.";
    chatList.replaceChildren(none);
    return;
  }
  chatList.replaceChildren(
    ...folders.map((section) => folderItem(ctx, section, query.trim() !== "")),
    ...groups.map((group) => groupItem(ctx, group)),
  );
}

function syncFolders(ctx: SidebarContext): void {
  const version = ctx.foldersVersion;
  ctx.deps.store.listFolders().then(
    (folders) => {
      if (version !== ctx.foldersVersion) return;
      if (JSON.stringify(folders) === JSON.stringify(ctx.folders)) return;
      ctx.folders = folders;
      renderList(ctx);
    },
    (error: unknown) => showError(ctx, "Could not load the folders", error),
  );
}

function setFolders(ctx: SidebarContext, folders: Folder[]): void {
  ctx.folders = folders;
  ctx.foldersVersion += 1;
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

function folderItem(
  ctx: SidebarContext,
  { folder, chats, expanded }: FolderSection,
  searching: boolean,
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "chat-folder";
  item.dataset["folderId"] = folder.id;
  item.classList.toggle("is-collapsed", !expanded);
  const list = document.createElement("ul");
  list.className = "chat-group-list chat-folder-list";
  list.id = `chat-folder-${folder.id}`;
  list.setAttribute("aria-label", folder.name);
  list.hidden = !expanded;
  list.append(...(chats.length > 0 ? chats.map((chat) => chatItem(ctx, chat)) : [emptyFolder()]));
  const header = folderHeader(ctx, folder, chats.length, expanded, searching);
  header.querySelector(".chat-folder-toggle")?.setAttribute("aria-controls", list.id);
  item.append(header, list);
  acceptDrops(ctx, item, folder.id);
  return item;
}

function folderHeader(
  ctx: SidebarContext,
  folder: Folder,
  count: number,
  expanded: boolean,
  searching: boolean,
): HTMLDivElement {
  const header = document.createElement("div");
  header.className = "chat-folder-header";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "chat-folder-toggle";
  toggle.title = `${folder.name} (${plural(count, "chat")})`;
  toggle.setAttribute("aria-expanded", String(expanded));
  // Search shows every match, so collapsing waits until the search is cleared.
  toggle.disabled = searching;
  const name = document.createElement("span");
  name.className = "chat-folder-name";
  name.textContent = folder.name;
  const tally = document.createElement("span");
  tally.className = "chat-folder-count";
  tally.textContent = String(count);
  toggle.append(icon("chevron", 14), name, tally);
  toggle.addEventListener("click", () => {
    toggleFolder(ctx, folder.id).catch((error: unknown) =>
      showError(ctx, "Could not save the folder", error),
    );
  });
  const rename = actionButton("folder-rename", "Rename folder", "✎", () =>
    startFolderRename(ctx, header, folder),
  );
  const remove = actionButton("folder-delete", "Delete folder", "×", () => {
    deleteFolder(ctx, folder.id).catch((error: unknown) =>
      ctx.deps.toast.show(`Could not delete the folder: ${errorText(error)}`),
    );
  });
  const actions = document.createElement("div");
  actions.className = "chat-actions";
  actions.append(rename, remove);
  header.append(toggle, actions);
  return header;
}

function emptyFolder(): HTMLLIElement {
  const empty = document.createElement("li");
  empty.className = "chat-folder-empty muted small";
  empty.textContent = "No chats in this folder.";
  return empty;
}

function chatItem(ctx: SidebarContext, chat: Chat): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "chat-item";
  item.dataset["chatId"] = chat.id;
  item.draggable = true;
  item.addEventListener("dragstart", (event) => startDrag(ctx, chat.id, event));
  item.addEventListener("dragend", () => endDrag(ctx));
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
    startRename(ctx, {
      id: chat.id,
      value: chat.title,
      label: "Chat title",
      row: item,
      shown: open,
      failure: "Could not rename the chat",
      save: (value) => renameChat(ctx, chat, value),
    }),
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
  actions.append(rename, ...(ctx.folders.length > 0 ? [moveControl(ctx, chat)] : []));
  actions.append(exportButton, remove);
  item.append(open, actions);
  return item;
}

function moveControl(ctx: SidebarContext, chat: Chat): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "chat-move";
  const button = actionButton(
    "chat-move-button",
    "Move to folder",
    icon("folder", 14),
    () => undefined,
  );
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  wrap.append(button);
  const menu = attachMenu({
    control: wrap,
    button,
    list: () => moveMenu(ctx, chat),
    items: MOVE_OPTION,
    onPick: (option) => {
      const folderId = option.dataset["folderId"];
      moveChat(ctx, chat.id, folderId === "" ? undefined : folderId)
        .then(() => focusChat(ctx, chat.id))
        .catch((error: unknown) =>
          ctx.deps.toast.show(`Could not move the chat: ${errorText(error)}`),
        );
    },
    onToggle: (open) => {
      ctx.closeMoveMenu = open ? () => menu.close() : null;
    },
  });
  return wrap;
}

function moveMenu(ctx: SidebarContext, chat: Chat): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "chat-move-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Move to folder");
  const known = ctx.folders.some((folder) => folder.id === chat.folderId);
  const current = known ? chat.folderId : undefined;
  const choices: [string | undefined, string][] = [
    [undefined, "No folder"],
    ...[...ctx.folders]
      .sort(byFolderName)
      .map((folder): [string, string] => [folder.id, folder.name]),
  ];
  for (const [folderId, label] of choices) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "chat-move-option";
    option.dataset["folderId"] = folderId ?? "";
    option.setAttribute("role", "menuitemradio");
    option.setAttribute("aria-checked", String(folderId === current));
    option.textContent = label;
    menu.append(option);
  }
  return menu;
}

function focusChat(ctx: SidebarContext, chatId: string): void {
  ctx.els.chatList
    .querySelector<HTMLButtonElement>(`[data-chat-id="${chatId}"] .chat-open`)
    ?.focus();
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

function startRename(ctx: SidebarContext, target: RenameTarget): void {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "chat-rename-input";
  input.value = target.value;
  input.setAttribute("aria-label", target.label);
  inlineEdit(input, (commit) => {
    ctx.renamingId = null;
    if (!commit) {
      renderList(ctx);
      return;
    }
    target.save(input.value).catch((error: unknown) => {
      renderList(ctx);
      showError(ctx, target.failure, error);
    });
  });
  ctx.renamingId = target.id;
  target.row.classList.add("is-renaming");
  // Text in a draggable row cannot be selected with the mouse.
  target.row.draggable = false;
  target.shown.replaceWith(input);
  input.focus();
  input.select();
}

function startFolderRename(ctx: SidebarContext, header: HTMLElement, folder: Folder): void {
  const toggle = header.querySelector<HTMLElement>(".chat-folder-toggle");
  if (!toggle) return;
  startRename(ctx, {
    id: folder.id,
    value: folder.name,
    label: "Folder name",
    row: header,
    shown: toggle,
    failure: "Could not rename the folder",
    save: (value) => renameFolder(ctx, folder.id, value),
  });
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
  const pending = pendingHolder(pendingFor(state, chat.id));
  // Removed from the state first, so a stopping turn sees the chat is gone and stops writing.
  removeChat(state, chat.id);
  renderList(ctx);
  let deleted: DeletedChat;
  let held: HeldImages | undefined;
  try {
    const [messages, handle] = await Promise.all([
      deps.store.listMessages(chat.id),
      deps.store.getVideoHandle(chat.id),
    ]);
    deleted = { chat, messages, handle, wasCurrent, pending };
    // Held before anything is deleted, so the images are never without a use while Undo is open.
    held = deps.images.hold({ messages, videoKeys: videoKeysOf(chat, messages) });
    await deps.store.deleteChat(chat.id);
  } catch (error) {
    held?.letGo();
    replaceChat(state, chat);
    renderList(ctx);
    if (wasCurrent) deps.onOpen(chat.id);
    throw error;
  }
  deps.onDeleted(chat);
  if (wasCurrent) deps.onCurrentDeleted();
  offerChatUndo(ctx, deleted, held);
}

function offerChatUndo(ctx: SidebarContext, deleted: DeletedChat, held: HeldImages): void {
  const { deps } = ctx;
  const { chat, messages, pending } = deleted;
  const final = () => {
    deps.onDeleteFinal(videoKeysOf(chat, messages));
    held.final();
    void deps.images.release(pending);
  };
  offerUndo(deps.toast, `Deleted "${chat.title}"`, {
    undo: async () => {
      await restoreChat(ctx, deleted);
      held.letGo();
      void deps.images.release(pending);
    },
    expired: final,
    failed: (error) => {
      deps.toast.show(`Could not restore the chat: ${errorText(error)}`);
      final();
    },
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

function withFolder(chat: Chat, folderId: string | undefined): Chat {
  const moved = { ...chat };
  delete moved.folderId;
  return folderId === undefined ? moved : { ...moved, folderId };
}

async function moveChat(
  ctx: SidebarContext,
  chatId: string,
  folderId: string | undefined,
): Promise<void> {
  const chat = ctx.state.chats.find((entry) => entry.id === chatId);
  if (!chat || chat.folderId === folderId) return;
  await updateChat(ctx.state, ctx.deps.store, chatId, (entry) => withFolder(entry, folderId));
  renderList(ctx);
}

// Shown at once; a failed save rereads the store so the list matches what was kept.
async function saveFolder(ctx: SidebarContext, folder: Folder): Promise<void> {
  setFolders(ctx, [...ctx.folders.filter((entry) => entry.id !== folder.id), folder]);
  renderList(ctx);
  try {
    await ctx.deps.store.putFolder(folder);
  } catch (error) {
    syncFolders(ctx);
    throw error;
  }
}

async function createFolder(ctx: SidebarContext): Promise<void> {
  const folder: Folder = { id: newId(ctx), name: NEW_FOLDER_NAME, createdAt: now(ctx) };
  // A search would hide the new, empty folder.
  ctx.els.searchInput.value = "";
  await saveFolder(ctx, folder);
  const header = ctx.els.chatList.querySelector<HTMLElement>(
    `[data-folder-id="${folder.id}"] .chat-folder-header`,
  );
  if (header) startFolderRename(ctx, header, folder);
}

async function toggleFolder(ctx: SidebarContext, folderId: string): Promise<void> {
  const folder = ctx.folders.find((entry) => entry.id === folderId);
  if (folder) await saveFolder(ctx, { ...folder, collapsed: folder.collapsed !== true });
}

async function renameFolder(ctx: SidebarContext, folderId: string, value: string): Promise<void> {
  const name = value.trim();
  const folder = ctx.folders.find((entry) => entry.id === folderId);
  if (name === "" || folder === undefined || name === folder.name) {
    renderList(ctx);
    return;
  }
  await saveFolder(ctx, { ...folder, name });
}

// Chats move out before the folder goes, so a failure part way can put them all back.
async function deleteFolder(ctx: SidebarContext, folderId: string): Promise<void> {
  const { state, deps } = ctx;
  const folder = ctx.folders.find((entry) => entry.id === folderId);
  if (!folder) return;
  const filedIds = state.chats.filter((chat) => chat.folderId === folderId).map((chat) => chat.id);
  try {
    for (const id of filedIds) await moveChat(ctx, id, undefined);
    await deps.store.deleteFolder(folderId);
  } catch (error) {
    // Best effort: the delete's own error is the one worth showing.
    await refile(ctx, filedIds, folderId).catch(() => undefined);
    throw error;
  }
  setFolders(
    ctx,
    ctx.folders.filter((entry) => entry.id !== folderId),
  );
  renderList(ctx);
  offerUndo(deps.toast, `Deleted folder "${folder.name}"`, {
    undo: () => restoreFolder(ctx, folder, filedIds),
    failed: (error) => deps.toast.show(`Could not restore the folder: ${errorText(error)}`),
  });
}

// Only chats still in no folder go back, so a chat filed elsewhere since stays put.
async function refile(
  ctx: SidebarContext,
  chatIds: readonly string[],
  folderId: string,
): Promise<void> {
  const unfiled = ctx.state.chats.filter(
    (chat) => chatIds.includes(chat.id) && chat.folderId === undefined,
  );
  for (const chat of unfiled) await moveChat(ctx, chat.id, folderId);
}

async function restoreFolder(
  ctx: SidebarContext,
  folder: Folder,
  movedIds: readonly string[],
): Promise<void> {
  await saveFolder(ctx, folder);
  await refile(ctx, movedIds, folder.id);
}

function isChatDrag(ctx: SidebarContext, event: DragEvent): boolean {
  return ctx.draggingId !== null && (event.dataTransfer?.types.includes(DRAG_TYPE) ?? true);
}

function startDrag(ctx: SidebarContext, chatId: string, event: DragEvent): void {
  ctx.draggingId = chatId;
  if (event.dataTransfer) {
    event.dataTransfer.setData(DRAG_TYPE, chatId);
    event.dataTransfer.effectAllowed = "move";
  }
  ctx.els.chatList.classList.add("is-dragging");
}

function endDrag(ctx: SidebarContext): void {
  ctx.draggingId = null;
  ctx.els.chatList.classList.remove("is-dragging");
  markDropTarget(ctx, null);
}

function markDropTarget(ctx: SidebarContext, target: HTMLElement | null): void {
  const { chatList } = ctx.els;
  for (const marked of [chatList, ...chatList.querySelectorAll(".is-drop-target")]) {
    if (marked !== target) marked.classList.remove("is-drop-target");
  }
  target?.classList.add("is-drop-target");
}

// With folderId undefined the target is the unfiled list, which takes a chat out of its folder.
function acceptDrops(ctx: SidebarContext, target: HTMLElement, folderId: string | undefined): void {
  target.addEventListener("dragover", (event) => {
    if (!isChatDrag(ctx, event)) return;
    event.stopPropagation();
    const chat = ctx.state.chats.find((entry) => entry.id === ctx.draggingId);
    const moves = chat !== undefined && chat.folderId !== folderId;
    markDropTarget(ctx, moves ? target : null);
    if (!moves) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  });
  target.addEventListener("dragleave", (event) => {
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    target.classList.remove("is-drop-target");
  });
  target.addEventListener("drop", (event) => {
    const chatId = ctx.draggingId;
    if (chatId === null || !isChatDrag(ctx, event)) return;
    event.preventDefault();
    event.stopPropagation();
    endDrag(ctx);
    moveChat(ctx, chatId, folderId).catch((error: unknown) =>
      ctx.deps.toast.show(`Could not move the chat: ${errorText(error)}`),
    );
  });
}
