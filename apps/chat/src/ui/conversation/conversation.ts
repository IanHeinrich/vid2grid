import type { TurnEvent } from "../../chat/agentLoop";
import type { AppElements } from "../../dom";
import { formatTimestamp } from "../../time";
import type { ChatMessage, VideoAttachment } from "../../types";
import { answerOf, describeCall, waitingStatus, type RequestStart } from "./activity";
import { smallButton } from "../shared/buttons";
import {
  dispose,
  upsertStep,
  videoAbout,
  type ConversationContext,
  type ConversationDeps,
  type TurnView,
} from "./context";
import { applyPendingFocus } from "./focus";
import { initLightbox, type LightboxDeps, type LightboxItem } from "./lightbox";
import { renderReadyCard, setReady } from "./readyCard";
import { closeCompare, stopChecks } from "./replyControls";
import { togglePinFromLightbox } from "./thumbnails";
import { createTurn, renderActivity, renderAnswer, renderTurn, streamingStep } from "./turnView";
import { currentDraft, editLast, renderUser, reopenEditor } from "./userMessage";
import { aspectOf, renderVideoSlot } from "./videoSlot";

export type { ConversationDeps } from "./context";

const STICK_THRESHOLD_PX = 48;
const THINKING = "Thinking…";

export interface Conversation {
  reset(messages: readonly ChatMessage[]): void;
  show(message: ChatMessage): void;
  apply(event: TurnEvent): void;
  showError(text: string): void;
  endTurn(): void;
  clearErrors(): void;
  setRunning(running: boolean): void;
  refreshVideos(): void;
  // The attached video whose overview is ready and not yet sent, or undefined to hide the card.
  setReady(video: VideoAttachment | undefined): void;
  editLast(): boolean;
  stopChecks(): void;
  isChecking(): boolean;
}

// A sheet from an older video seeks and sizes by that video.
function lightboxDeps(ctx: () => ConversationContext, deps: ConversationDeps): LightboxDeps {
  const about = (item: LightboxItem) => videoAbout(ctx(), item.messageId);
  const current = (item: LightboxItem) => about(item)?.fileKey === deps.videoView().video?.fileKey;
  return {
    store: deps.store,
    onTogglePin: (item) => togglePinFromLightbox(ctx(), item),
    onSeek: (seconds, item) => {
      if (current(item)) deps.onCue(seconds);
      else deps.onSeek(seconds, about(item));
    },
    onAsk: (seconds) => deps.onPrefill(`About [${formatTimestamp(seconds)}]: `),
    sourceAspect: (item) => aspectOf(about(item)) ?? aspectOf(deps.videoView().video),
  };
}

export function initConversation(
  els: Pick<AppElements, "conversation" | "lightbox" | "templates">,
  deps: ConversationDeps,
): Conversation {
  const ctx: ConversationContext = {
    els: els.conversation,
    templates: els.templates,
    deps,
    lightbox: initLightbox(
      els,
      lightboxDeps(() => ctx, deps),
    ),
    readyVideo: undefined,
    readyNote: false,
    readySuggestions: els.conversation.readyCard.querySelector<HTMLElement>(".ready-suggestions"),
    readyNoteEl: els.conversation.readyCard.querySelector<HTMLElement>(".ready-note"),
    activityOpen: new Map(),
    turns: [],
    turnOf: new Map(),
    messages: new Map(),
    videoSlots: new Map(),
    editor: null,
    pendingFocus: null,
    stickToBottom: true,
    waiting: null,
    checks: new Map(),
    compare: null,
    thinking: false,
    showMessage: (message) => showMessage(ctx, message),
    renderAnswer: (turn) => renderAnswer(ctx, turn),
    afterChange: () => afterChange(ctx),
  };
  listen(ctx);
  return {
    reset: (messages) => reset(ctx, messages),
    show: (message) => {
      showMessage(ctx, message);
      afterChange(ctx);
    },
    apply: (event) => applyEvent(ctx, event),
    showError: (text) => showError(ctx, text),
    endTurn: () => endTurn(ctx),
    clearErrors: () => clearErrors(ctx),
    setRunning: (running) => setRunning(ctx, running),
    refreshVideos: () => {
      ctx.videoSlots.forEach((slot) => renderVideoSlot(ctx, slot));
      afterChange(ctx);
    },
    setReady: (video) => setReady(ctx, video),
    editLast: () => editLast(ctx),
    stopChecks: () => stopChecks(ctx),
    isChecking: () => ctx.checks.size > 0,
  };
}
function listen(ctx: ConversationContext): void {
  const { scroller, readyStarters } = ctx.els;
  scroller.addEventListener("scroll", () => {
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    ctx.stickToBottom = distance < STICK_THRESHOLD_PX;
  });
  for (const starter of readyStarters.querySelectorAll("button")) {
    starter.addEventListener("click", () => ctx.deps.onPrefill(starter.textContent.trim()));
  }
}

function announce(ctx: ConversationContext, text: string): void {
  ctx.els.announcer.textContent = text;
}

function showError(ctx: ConversationContext, text: string): void {
  stopWaiting(ctx);
  const line = document.createElement("li");
  line.className = "error-line";
  line.setAttribute("role", "alert");
  const message = document.createElement("span");
  message.textContent = text;
  const retry = smallButton("error-retry", "Retry", () => ctx.deps.onReplay());
  line.append(message, retry);
  ctx.els.list.append(line);
  afterChange(ctx);
}

function clearErrors(ctx: ConversationContext): void {
  ctx.els.list.querySelectorAll(".error-line").forEach((line) => line.remove());
}

function reset(ctx: ConversationContext, messages: readonly ChatMessage[]): void {
  const draft = currentDraft(ctx);
  stopWaiting(ctx);
  stopChecks(ctx);
  closeCompare(ctx);
  ctx.lightbox.close();
  for (const turn of ctx.turns) {
    if (turn.userEntry) dispose(turn.userEntry);
    dispose(turn.activity.images);
  }
  ctx.turns = [];
  ctx.turnOf.clear();
  ctx.messages.clear();
  ctx.videoSlots.clear();
  ctx.editor = null;
  ctx.els.list.replaceChildren();
  messages.forEach((message) => showMessage(ctx, message));
  // Only this chat's turns keep a remembered state, so another chat's never carry over.
  for (const key of ctx.activityOpen.keys()) {
    if (!ctx.messages.has(key)) ctx.activityOpen.delete(key);
  }
  if (draft) reopenEditor(ctx, draft);
  ctx.stickToBottom = true;
  afterChange(ctx);
}

// A locked button, such as a swipe arrow at the end of the replies, stays disabled either way.
function setRunning(ctx: ConversationContext, running: boolean): void {
  ctx.els.list.classList.toggle("is-running", running);
  if (running) closeCompare(ctx);
  const buttons = ctx.els.list.querySelectorAll<HTMLButtonElement>(
    ".message-action:not(.copy-action):not([data-locked]), .editor-save",
  );
  for (const button of buttons) button.disabled = running;
}

function endTurn(ctx: ConversationContext): void {
  stopWaiting(ctx);
  announce(ctx, "Reply finished.");
  const latest = ctx.turns[ctx.turns.length - 1];
  for (const turn of ctx.turns) {
    if (turn !== latest && turn.live === null && turn.streamingId === null) continue;
    turn.live = null;
    turn.streamingId = null;
    turn.pendingCalls = [];
    renderTurn(ctx, turn);
  }
  afterChange(ctx);
}

function lastTurn(ctx: ConversationContext): TurnView {
  return ctx.turns[ctx.turns.length - 1] ?? createTurn(ctx, undefined, undefined);
}

function startWaiting(ctx: ConversationContext, event: RequestStart): void {
  stopWaiting(ctx);
  const turn = lastTurn(ctx);
  const startedAt = Date.now();
  const show = () => {
    turn.live = waitingStatus(event, Math.floor((Date.now() - startedAt) / 1000));
    renderActivity(ctx, turn);
  };
  show();
  ctx.waiting = { turn, timer: setInterval(show, 1000) };
}

function stopWaiting(ctx: ConversationContext): void {
  if (ctx.waiting) clearInterval(ctx.waiting.timer);
  ctx.waiting = null;
}
function applyEvent(ctx: ConversationContext, event: TurnEvent): void {
  if (event.type !== "requestStart" && event.type !== "note") stopWaiting(ctx);
  switch (event.type) {
    case "assistantStart": {
      const turn = ctx.turnOf.get(event.message.id) ?? turnForNewStep(ctx, event.message.id);
      turn.streamingId = event.message.id;
      turn.live = THINKING;
      showMessage(ctx, event.message);
      break;
    }
    case "assistantDelta": {
      const turn = ctx.turnOf.get(event.message.id) ?? lastTurn(ctx);
      turn.live = event.message.text === "" ? THINKING : null;
      upsertStep(ctx, turn, event.message);
      renderTurn(ctx, turn, event.message);
      afterStreamedChange(ctx);
      return;
    }
    case "assistantDone": {
      const turn = ctx.turnOf.get(event.message.id) ?? lastTurn(ctx);
      turn.streamingId = null;
      turn.live = null;
      showMessage(ctx, event.message);
      break;
    }
    case "toolStart": {
      const turn = lastTurn(ctx);
      turn.pendingCalls.push(event.call);
      turn.live = describeCall(event.call);
      renderTurn(ctx, turn);
      break;
    }
    case "toolDone": {
      const turn = ctx.turnOf.get(event.message.id) ?? lastTurn(ctx);
      turn.pendingCalls = turn.pendingCalls.filter((call) => call.id !== event.message.toolCallId);
      const stillRunning = turn.pendingCalls[turn.pendingCalls.length - 1];
      turn.live = stillRunning ? describeCall(stillRunning) : THINKING;
      showMessage(ctx, event.message);
      break;
    }
    case "requestStart":
      if (event.round === 1) announce(ctx, "Waiting for the reply.");
      startWaiting(ctx, event);
      break;
    case "note":
      return;
  }
  afterChange(ctx);
}

function afterChange(ctx: ConversationContext): void {
  renderCoverage(ctx);
  afterStreamedChange(ctx);
}

// Coverage only moves when a step or the turn finishes, so streamed text leaves it alone.
function afterStreamedChange(ctx: ConversationContext): void {
  const video = ctx.readyVideo;
  renderReadyCard(ctx);
  ctx.els.empty.hidden =
    ctx.els.list.childElementCount > 0 ||
    video !== undefined ||
    ctx.deps.videoView().video !== undefined;
  if (ctx.stickToBottom) ctx.els.scroller.scrollTop = ctx.els.scroller.scrollHeight;
  applyPendingFocus(ctx);
  reportThinking(ctx);
}

// Thinking means the latest round streams reasoning and has written no answer or call yet.
// A retry after a cut carries the old reasoning, so it never counts as thinking.
function reportThinking(ctx: ConversationContext): void {
  const turn = ctx.turns[ctx.turns.length - 1];
  const step = turn && turn.live !== null ? streamingStep(turn) : undefined;
  const thinking =
    step !== undefined &&
    step.reasoningCutShort !== true &&
    (step.reasoning ?? "") !== "" &&
    step.text === "" &&
    step.toolCalls.length === 0;
  if (thinking === ctx.thinking) return;
  ctx.thinking = thinking;
  ctx.deps.onThinkingChanged?.(thinking);
}

function renderCoverage(ctx: ConversationContext): void {
  const messages = [...ctx.messages.values()];
  const duration = ctx.deps.videoView().video?.durationSeconds;
  ctx.videoSlots.forEach((slot) => slot.coverage?.update(messages, duration));
  ctx.deps.onMessagesChanged();
}

function showMessage(ctx: ConversationContext, message: ChatMessage): void {
  ctx.messages.set(message.id, message);
  if (message.role === "user") {
    const turn = ctx.turnOf.get(message.id) ?? createTurn(ctx, message, undefined);
    turn.user = message;
    renderUser(ctx, turn);
    return;
  }
  const turn = ctx.turnOf.get(message.id) ?? turnForNewStep(ctx, message.id);
  upsertStep(ctx, turn, message);
  renderTurn(ctx, turn);
}

// A finished reply closes its turn, so a reply with no user message before it starts its own.
function turnForNewStep(ctx: ConversationContext, stepId: string): TurnView {
  const last = ctx.turns[ctx.turns.length - 1];
  if (last && !(answerOf(last.steps) && last.streamingId === null)) return last;
  return createTurn(ctx, undefined, stepId);
}
