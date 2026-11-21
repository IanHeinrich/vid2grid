import type { VideoAttachment } from "../../types";
import type { ConversationContext } from "./context";

const READY_NOTE_KEY = "vid2grid-chat-ready-note-seen";

export function setReady(ctx: ConversationContext, video: VideoAttachment | undefined): void {
  if (ctx.readyVideo === video) return;
  if (video && video.fileKey !== ctx.readyVideo?.fileKey) ctx.readyNote = takeReadyNote(ctx);
  ctx.readyVideo = video;
  ctx.afterChange();
}

// The note is shown once ever, so it is marked seen as soon as a ready card takes it.
function takeReadyNote(ctx: ConversationContext): boolean {
  const storage = ctx.deps.storage ?? localStorage;
  if (storage.getItem(READY_NOTE_KEY) === "seen") return false;
  storage.setItem(READY_NOTE_KEY, "seen");
  return true;
}

export function renderReadyCard(ctx: ConversationContext): void {
  const ready = ctx.readyVideo !== undefined;
  const starters = ready && ctx.messages.size === 0;
  const note = ready && ctx.readyNote;
  if (ctx.readySuggestions) ctx.readySuggestions.hidden = !starters;
  if (ctx.readyNoteEl) ctx.readyNoteEl.hidden = !note;
  ctx.els.readyCard.hidden = !starters && !note;
}
