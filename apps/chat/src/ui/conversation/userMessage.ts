import { messageThoroughness } from "../../chat/thoroughness";
import type { AssistantMessage, UserMessage } from "../../types";
import { editKeys, pinToggle, smallButton } from "../shared/buttons";
import { answerOf } from "./activity";
import { imageCaption } from "./captions";
import {
  dispose,
  messageElement,
  newEntry,
  seekHandler,
  textOptions,
  type ConversationContext,
  type Draft,
  type Entry,
  type TurnView,
} from "./context";
import { focusWithin } from "./focus";
import { renderMarkdownInto } from "./markdown";
import { branchButton, copyButton, deleteButton, editButton } from "./replyControls";
import { thumbnail, togglePin } from "./thumbnails";
import { removedVideoLine, videoSlotFor } from "./videoSlot";

const EMPTY_REPLY_HINT = "A reply needs some text. Cancel keeps the old one.";
const THOROUGHNESS_TAGS = { thorough: "Thorough", exhaustive: "Exhaustive" } as const;

export function renderUser(ctx: ConversationContext, turn: TurnView): void {
  const message = turn.user;
  const previous = turn.userEntry;
  if (!message || !previous) return;
  if (ctx.editor?.id === message.id) {
    refreshVideo(ctx, previous.el, message);
    return;
  }
  dispose(previous);
  const entry = message.continuation
    ? continuationMarker(ctx, message)
    : userElement(ctx, message, () => renderUser(ctx, turn));
  previous.el.replaceWith(entry.el);
  turn.userEntry = entry;
}

function continuationMarker(ctx: ConversationContext, message: UserMessage): Entry {
  const entry = newEntry("li", "message continuation-marker");
  const label = document.createElement("span");
  label.textContent = "↻ Kept going";
  entry.el.append(label, deleteButton(ctx, message));
  return entry;
}

function messageTag(className: string, text: string): HTMLSpanElement {
  const tag = document.createElement("span");
  tag.className = className;
  tag.textContent = text;
  return tag;
}

function userElement(ctx: ConversationContext, message: UserMessage, rerender: () => void): Entry {
  const entry = newEntry("li", "message user");
  ctx.videoSlots.delete(message.id);
  const thoroughness = messageThoroughness(message);
  if (thoroughness !== "normal") {
    entry.el.append(messageTag("deep-tag", THOROUGHNESS_TAGS[thoroughness]));
  }
  if (message.reasoningEffort !== undefined) {
    entry.el.append(messageTag("effort-tag", `Reasoning: ${message.reasoningEffort}`));
  }
  if (message.audio) {
    const tag = messageTag("audio-tag", "Audio");
    tag.title = "The model could read what is heard in the video";
    entry.el.append(tag);
  }
  const video = videoPart(ctx, message);
  if (video) entry.el.append(video);
  if (message.text !== "") {
    const text = document.createElement("div");
    text.className = "message-text";
    renderMarkdownInto(
      text,
      message.text,
      textOptions(ctx, message.id, seekHandler(ctx, message.id)),
    );
    entry.el.append(text);
  }
  if (message.images.length > 0) entry.el.append(userThumbs(ctx, entry, message));
  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(
    copyButton(ctx, message),
    editButton(ctx, () => startEdit(ctx, message, entry.el, rerender)),
    branchButton(ctx, message),
    deleteButton(ctx, message),
  );
  entry.el.append(actions);
  return entry;
}

function videoPart(ctx: ConversationContext, message: UserMessage): HTMLElement | undefined {
  if (message.video) return videoSlotFor(ctx, message.id, message.video);
  return message.removedVideo && removedVideoLine(message.removedVideo);
}

// All of an edited message that changes under its editor. A slot that stays keeps playing.
function refreshVideo(ctx: ConversationContext, el: HTMLElement, message: UserMessage): void {
  const slot = ctx.videoSlots.get(message.id);
  if (slot && slot.video.fileKey === message.video?.fileKey) return;
  ctx.videoSlots.delete(message.id);
  const part = videoPart(ctx, message);
  if (part) el.querySelector(".inline-video")?.replaceWith(part);
}

function userThumbs(ctx: ConversationContext, entry: Entry, message: UserMessage): HTMLElement {
  const thumbs = document.createElement("ul");
  thumbs.className = "thumbs";
  message.images.forEach((ref, index) => {
    const item = document.createElement("li");
    item.className = "thumb";
    const caption = document.createElement("span");
    caption.className = "thumb-label";
    caption.textContent = imageCaption(ref);
    const pin = pinToggle(ref.pinned, () => togglePin(ctx, message, index));
    item.append(thumbnail(ctx, entry, ref, message.id, index), caption, pin);
    thumbs.append(item);
  });
  return thumbs;
}

export function currentDraft(ctx: ConversationContext): Draft | null {
  const { editor } = ctx;
  if (!editor) return null;
  return {
    id: editor.id,
    text: editor.input.value,
    focused: document.activeElement === editor.input,
  };
}

// A re-render rebuilds every message, so an open editor is put back with what was typed in it.
export function reopenEditor(ctx: ConversationContext, draft: Draft): void {
  const message = ctx.messages.get(draft.id);
  const turn = ctx.turnOf.get(draft.id);
  if (!message || !turn || message.role === "tool") return;
  if (message.role === "user" && turn.userEntry && !message.continuation) {
    startEdit(ctx, message, turn.userEntry.el, () => renderUser(ctx, turn), draft);
  } else if (message.role === "assistant" && answerOf(turn.steps)?.id === message.id) {
    startEdit(ctx, message, turn.answer.el, () => ctx.renderAnswer(turn), draft);
  }
}

// Those that cannot open yet wait for the open editor to close or for their chat to be shown.
export function reopenUnsaved(ctx: ConversationContext, focused: boolean): void {
  for (const [id, text] of ctx.unsavedEdits) {
    if (ctx.editor) return;
    reopenEditor(ctx, { id, text, focused });
  }
}

function keepUnsaved(ctx: ConversationContext, id: string, text: string): void {
  ctx.unsavedEdits.set(id, text);
  ctx.pendingFocus = null;
  reopenUnsaved(ctx, true);
}

export function editLast(ctx: ConversationContext): boolean {
  if (ctx.deps.isRunning() || ctx.editor) return false;
  for (const turn of [...ctx.turns].reverse()) {
    const message = turn.user;
    if (!message || message.continuation || !turn.userEntry) continue;
    startEdit(ctx, message, turn.userEntry.el, () => renderUser(ctx, turn));
    return true;
  }
  return false;
}

export function startEdit(
  ctx: ConversationContext,
  message: UserMessage | AssistantMessage,
  el: HTMLElement,
  rerender: () => void,
  draft?: Draft,
): void {
  if (ctx.editor !== null || (!draft && ctx.deps.isRunning())) return;
  el.classList.add("is-editing");
  const editor = document.createElement("div");
  editor.className = "message-editor";
  const textarea = document.createElement("textarea");
  textarea.value = draft?.text ?? message.text;
  textarea.rows = Math.min(12, Math.max(2, textarea.value.split("\n").length));
  textarea.setAttribute("aria-label", "Edit message");
  ctx.editor = { id: message.id, input: textarea };
  const problem = document.createElement("p");
  problem.className = "message-editor-problem";
  problem.setAttribute("role", "alert");
  problem.hidden = true;
  const finish = (text: string | null) => {
    ctx.editor = null;
    ctx.unsavedEdits.delete(message.id);
    el.classList.remove("is-editing");
    editor.remove();
    if (text !== null && text !== message.text) {
      ctx.pendingFocus = { kind: "message", id: message.id };
      // The message may have changed under the editor, as when its video was removed.
      const latest = ctx.messages.get(message.id);
      ctx.deps.onEdit(latest && latest.role !== "tool" ? latest : message, text, () =>
        keepUnsaved(ctx, message.id, text),
      );
    } else {
      rerender();
      focusWithin(ctx, messageElement(ctx, message.id));
    }
    reopenUnsaved(ctx, false);
  };
  const save = smallButton("button primary editor-save", "Save", () => {
    const text = textarea.value.trim();
    if (text === "" && message.role === "assistant") {
      problem.textContent = EMPTY_REPLY_HINT;
      problem.hidden = false;
      textarea.focus();
      return;
    }
    finish(text);
  });
  save.disabled = ctx.deps.isRunning();
  const cancel = smallButton("button ghost", "Cancel", () => finish(null));
  editKeys(textarea, { cancel: () => finish(null) });
  const buttons = document.createElement("div");
  buttons.className = "message-editor-actions";
  buttons.append(cancel, save);
  editor.append(textarea, problem, buttons);
  el.append(editor);
  if (!draft || draft.focused) textarea.focus();
}
