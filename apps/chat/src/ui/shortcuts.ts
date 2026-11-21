import type { AppElements } from "../dom";
import type { ChatDrawer, KnowledgeDrawer } from "./chatDrawer";

export interface ShortcutDeps {
  isRunning(): boolean;
  stop(): void;
  // False when there is no message to edit, so the key keeps its usual meaning.
  editLastMessage(): boolean;
  chatDrawer: Pick<ChatDrawer, "open">;
  knowledge: Pick<KnowledgeDrawer, "open">;
}

type ShortcutElements = Pick<AppElements, "composer" | "sidebar" | "chatSettings" | "shortcuts">;

interface ShortcutContext {
  els: ShortcutElements;
  deps: ShortcutDeps;
  toggle: HTMLButtonElement;
  popover: HTMLElement;
}

export function initShortcuts(els: ShortcutElements, deps: ShortcutDeps): () => void {
  const listening = new AbortController();
  const { signal } = listening;
  const ctx: ShortcutContext = { els, deps, ...els.shortcuts };
  ctx.toggle.addEventListener("click", () => setPopover(ctx, ctx.popover.hidden), { signal });
  const closeOutside = (event: MouseEvent) => {
    const target = event.target;
    if (ctx.popover.hidden || !(target instanceof Node)) return;
    if (!ctx.popover.contains(target) && !ctx.toggle.contains(target)) setPopover(ctx, false);
  };
  document.addEventListener("click", closeOutside, { signal });
  const input = els.composer.messageInput;
  input.addEventListener("keydown", (event) => onComposerKey(ctx, event), { signal });
  document.addEventListener("keydown", (event) => onKey(ctx, event), { signal });
  return () => listening.abort();
}

function setPopover(ctx: ShortcutContext, open: boolean): void {
  ctx.popover.hidden = !open;
  ctx.toggle.setAttribute("aria-expanded", String(open));
}

function onComposerKey(ctx: ShortcutContext, event: KeyboardEvent): void {
  const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
  if (event.key !== "ArrowUp" || !plain || ctx.els.composer.messageInput.value !== "") return;
  if (ctx.deps.editLastMessage()) event.preventDefault();
}

// Dialogs, the lightbox and the model picker handle Escape themselves.
function somethingOpen(): boolean {
  return document.querySelector("dialog[open], .model-panel:not([hidden])") !== null;
}

// The page behind a modal dialog is inert, so its shortcuts wait until the dialog closes.
function modalOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

function onKey(ctx: ShortcutContext, event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === "Escape") {
    if (!ctx.popover.hidden) {
      setPopover(ctx, false);
      ctx.toggle.focus();
    } else if (ctx.deps.isRunning() && !somethingOpen()) {
      event.preventDefault();
      ctx.deps.stop();
    }
  } else if (modalOpen()) {
    return;
  } else if (ctrl && event.altKey && event.code === "KeyN") {
    event.preventDefault();
    newChat(ctx);
  } else if (ctrl && event.altKey && event.code === "KeyK") {
    event.preventDefault();
    ctx.deps.knowledge.open();
  } else if (ctrl && !event.altKey && event.key === ",") {
    event.preventDefault();
    openChatSettings(ctx);
  }
}

// Fields save on blur, so a field left focused would commit its edit after the chat changed.
function newChat(ctx: ShortcutContext): void {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) focused.blur();
  ctx.els.sidebar.newChatButton.click();
  if (focused instanceof HTMLElement) focused.focus();
}

function openChatSettings(ctx: ShortcutContext): void {
  ctx.deps.chatDrawer.open("persona");
  ctx.els.chatSettings.systemPromptInput.focus();
}
