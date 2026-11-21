import type { TurnEvent } from "../chat/agentLoop";
import { currentReplyIndex, replyCount } from "../chat/alternates";
import { messageThoroughness } from "../chat/thoroughness";
import { replyUsageText } from "../chat/tokenEstimate";
import { extractTimedClaims } from "../chat/verify";
import type { AppElements } from "../dom";
import { formatTimestamp } from "../time";
import type {
  AssistantMessage,
  ChatMessage,
  ImageRef,
  ImageStore,
  ModelInfo,
  ToolCall,
  UserMessage,
  VideoAttachment,
} from "../types";
import {
  activitySummary,
  answerOf,
  describeCall,
  hasActivity,
  prefacesOf,
  renderActivityBody,
  streamingBodyKey,
  updateStreamingReasoning,
  waitingStatus,
  type RequestStart,
  type TurnStep,
} from "./activity";
import { iconButton, pinToggle, smallButton } from "./buttons";
import { imageCaption } from "./captions";
import { createCoverageStrip, type CoverageStrip } from "./coverageStrip";
import { icon, type IconName } from "./icons";
import { initLightbox, type Lightbox, type LightboxDeps, type LightboxItem } from "./lightbox";
import { renderMarkdownInto, type MarkdownOptions } from "./markdown";
import { videoForMessage } from "./messageVideo";
import { createModelPicker, type ModelPicker } from "./modelPicker";
import type { PickerSettings } from "./pickerModel";
import { renderReceipt } from "./receipt";
import { renderCheckProgress, renderVerification } from "./verifyPanel";
import { videoSummary } from "./video/overviewText";
import type { VideoView } from "./videoPanel";

const STICK_THRESHOLD_PX = 48;
const THINKING = "Thinking…";
const PREFACE_LABEL = "Before looking";
const EMPTY_REPLY_HINT = "A reply needs some text. Cancel keeps the old one.";
const READY_NOTE_KEY = "vid2grid-chat-ready-note-seen";
const CUT_SHORT_NOTICE =
  "The model's thinking was cut short, so it answered from what it had worked out so far.";
const THOROUGHNESS_TAGS = { thorough: "Thorough", exhaustive: "Exhaustive" } as const;

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

export interface ConversationDeps {
  store: ImageStore;
  // The video is the one the message was about, which may no longer be the chat's current video.
  onSeek(seconds: number, video?: VideoAttachment): void;
  onCue(seconds: number): void;
  onMessageChanged(message: ChatMessage): void;
  onEdit(message: UserMessage | AssistantMessage, text: string): void;
  onReplay(): void;
  onKeepGoing(): void;
  onBranch(message: ChatMessage): void;
  onDelete(message: ChatMessage): void;
  onCopy(message: ChatMessage): void;
  isRunning(): boolean;
  videoView(): VideoView;
  onPopOut(seconds: number): void;
  onReattach(): void;
  showThinking(): boolean;
  onPrefill(text: string): void;
  focusComposer(): void;
  models(): readonly ModelInfo[];
  chatModelId(): string | undefined;
  pickerSettings: PickerSettings;
  onSwitchReply(user: UserMessage, index: number): void;
  onCompare(model: ModelInfo): void;
  onVerify(message: AssistantMessage, signal: AbortSignal): Promise<AssistantMessage | undefined>;
  onMessagesChanged(): void;
  onThinkingChanged?: (thinking: boolean) => void;
  storage?: Storage;
}

interface Entry {
  el: HTMLElement;
  urls: string[];
  disposed: boolean;
}

interface VideoSlot {
  el: HTMLElement;
  video: VideoAttachment;
  shown: string;
  coverage: CoverageStrip | undefined;
}

interface ActivityView {
  el: HTMLLIElement;
  details: HTMLDetailsElement;
  summary: HTMLElement;
  body: HTMLElement;
  images: Entry;
  // The steps changed since the body was last built.
  dirty: boolean;
  renderedLive: boolean;
  streamKey: string | undefined;
}

interface AnswerView {
  el: HTMLLIElement;
  prefaces: HTMLElement;
  // What the prefaces were last built from, so a streamed token below them leaves them alone.
  prefacesKey: string | undefined;
  text: HTMLElement;
  notice: HTMLElement;
  checks: HTMLElement;
  actions: HTMLElement;
  receipt: HTMLElement;
}

interface TurnView {
  key: string;
  user: UserMessage | undefined;
  userEntry: Entry | undefined;
  steps: TurnStep[];
  activity: ActivityView;
  answer: AnswerView;
  live: string | null;
  streamingId: string | null;
  // Calls started and not yet done; a listen call can still run after a later call finishes.
  pendingCalls: ToolCall[];
}

interface Waiting {
  turn: TurnView;
  timer: ReturnType<typeof setInterval>;
}

interface Editor {
  id: string;
  input: HTMLTextAreaElement;
}

interface Draft {
  id: string;
  text: string;
  focused: boolean;
}

type FocusTarget = { kind: "message"; id: string } | { kind: "position"; index: number };

interface ComparePopover {
  el: HTMLElement;
  picker: ModelPicker;
  onOutside: (event: Event) => void;
}

interface ConversationContext {
  els: AppElements["conversation"];
  templates: AppElements["templates"];
  deps: ConversationDeps;
  lightbox: Lightbox;
  readyVideo: VideoAttachment | undefined;
  readyNote: boolean;
  readySuggestions: HTMLElement | null;
  readyNoteEl: HTMLElement | null;
  // Activity rows the reader opened or closed, by turn, so a re-render keeps them that way.
  activityOpen: Map<string, boolean>;
  turns: TurnView[];
  turnOf: Map<string, TurnView>;
  messages: Map<string, ChatMessage>;
  videoSlots: Map<string, VideoSlot>;
  editor: Editor | null;
  pendingFocus: FocusTarget | null;
  stickToBottom: boolean;
  waiting: Waiting | null;
  checks: Map<string, AbortController>;
  compare: ComparePopover | null;
  thinking: boolean;
}

function aspectOf(video: VideoAttachment | undefined): number | undefined {
  return video && video.width > 0 && video.height > 0 ? video.width / video.height : undefined;
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

function setReady(ctx: ConversationContext, video: VideoAttachment | undefined): void {
  if (ctx.readyVideo === video) return;
  if (video && video.fileKey !== ctx.readyVideo?.fileKey) ctx.readyNote = takeReadyNote(ctx);
  ctx.readyVideo = video;
  afterChange(ctx);
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

function currentDraft(ctx: ConversationContext): Draft | null {
  const { editor } = ctx;
  if (!editor) return null;
  return {
    id: editor.id,
    text: editor.input.value,
    focused: document.activeElement === editor.input,
  };
}

// A re-render rebuilds every message, so an open editor is put back with what was typed in it.
function reopenEditor(ctx: ConversationContext, draft: Draft): void {
  const message = ctx.messages.get(draft.id);
  const turn = ctx.turnOf.get(draft.id);
  if (!message || !turn || message.role === "tool") return;
  if (message.role === "user" && turn.userEntry && !message.continuation) {
    startEdit(ctx, message, turn.userEntry.el, () => renderUser(ctx, turn), draft);
  } else if (message.role === "assistant" && answerOf(turn.steps)?.id === message.id) {
    startEdit(ctx, message, turn.answer.el, () => renderAnswer(ctx, turn), draft);
  }
}

function editLast(ctx: ConversationContext): boolean {
  if (ctx.deps.isRunning() || ctx.editor) return false;
  for (const turn of [...ctx.turns].reverse()) {
    const message = turn.user;
    if (!message || message.continuation || !turn.userEntry) continue;
    startEdit(ctx, message, turn.userEntry.el, () => renderUser(ctx, turn));
    return true;
  }
  return false;
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
      break;
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

// The note is shown once ever, so it is marked seen as soon as a ready card takes it.
function takeReadyNote(ctx: ConversationContext): boolean {
  const storage = ctx.deps.storage ?? localStorage;
  if (storage.getItem(READY_NOTE_KEY) === "seen") return false;
  storage.setItem(READY_NOTE_KEY, "seen");
  return true;
}

function renderReadyCard(ctx: ConversationContext): void {
  const ready = ctx.readyVideo !== undefined;
  const starters = ready && ctx.messages.size === 0;
  const note = ready && ctx.readyNote;
  if (ctx.readySuggestions) ctx.readySuggestions.hidden = !starters;
  if (ctx.readyNoteEl) ctx.readyNoteEl.hidden = !note;
  ctx.els.readyCard.hidden = !starters && !note;
}

function afterChange(ctx: ConversationContext): void {
  const video = ctx.readyVideo;
  renderReadyCard(ctx);
  ctx.els.empty.hidden =
    ctx.els.list.childElementCount > 0 ||
    video !== undefined ||
    ctx.deps.videoView().video !== undefined;
  if (ctx.stickToBottom) ctx.els.scroller.scrollTop = ctx.els.scroller.scrollHeight;
  renderCoverage(ctx);
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

function applyPendingFocus(ctx: ConversationContext): void {
  const target = ctx.pendingFocus;
  if (!target) return;
  ctx.pendingFocus = null;
  if (target.kind === "message") {
    focusWithin(ctx, messageElement(ctx, target.id));
    return;
  }
  const shown = [...ctx.els.list.querySelectorAll<HTMLElement>(".message:not([hidden])")];
  focusWithin(ctx, shown[target.index] ?? shown[shown.length - 1]);
}

function messageElement(ctx: ConversationContext, id: string): HTMLElement | undefined {
  const turn = ctx.turnOf.get(id);
  if (!turn) return undefined;
  return turn.user?.id === id ? turn.userEntry?.el : turn.answer.el;
}

function focusWithin(ctx: ConversationContext, el: HTMLElement | undefined): void {
  const button =
    el?.querySelector<HTMLButtonElement>(".edit-action:not(:disabled)") ??
    el?.querySelector<HTMLButtonElement>(".message-action:not(:disabled)");
  if (button) button.focus();
  else ctx.deps.focusComposer();
}

function messagePosition(ctx: ConversationContext, el: Element | null): number {
  const shown = [...ctx.els.list.querySelectorAll(".message:not([hidden])")];
  return Math.max(
    0,
    shown.findIndex((entry) => entry === el),
  );
}

function dispose(entry: Entry): void {
  entry.disposed = true;
  entry.urls.forEach((url) => URL.revokeObjectURL(url));
  entry.urls = [];
}

function newEntry(tag: string, className: string): Entry {
  const el = document.createElement(tag);
  el.className = className;
  return { el, urls: [], disposed: false };
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

function upsertStep(ctx: ConversationContext, turn: TurnView, step: TurnStep): void {
  ctx.messages.set(step.id, step);
  ctx.turnOf.set(step.id, turn);
  const index = turn.steps.findIndex((entry) => entry.id === step.id);
  if (index === -1) turn.steps.push(step);
  else turn.steps[index] = step;
  turn.activity.dirty = true;
}

// A turn is keyed by its user message, or by its first step when a reply opens the chat.
function createTurn(
  ctx: ConversationContext,
  user: UserMessage | undefined,
  firstStepId: string | undefined,
): TurnView {
  const turn: TurnView = {
    key: user?.id ?? firstStepId ?? `lead-${ctx.turns.length}`,
    user,
    userEntry: undefined,
    steps: [],
    activity: activityView(),
    answer: answerView(),
    live: null,
    streamingId: null,
    pendingCalls: [],
  };
  const previous = ctx.turns[ctx.turns.length - 1];
  ctx.turns.push(turn);
  // The previous reply is no longer the latest, so it loses Replay and Keep going.
  if (previous) renderAnswer(ctx, previous);
  if (user) {
    ctx.turnOf.set(user.id, turn);
    turn.userEntry = newEntry("li", "message user");
    ctx.els.list.append(turn.userEntry.el);
  }
  const { details, summary } = turn.activity;
  details.open = ctx.activityOpen.get(turn.key) ?? ctx.deps.showThinking();
  // A click on the summary is the reader's choice; the toggle event also fires for code.
  summary.addEventListener("click", () => ctx.activityOpen.set(turn.key, !details.open));
  details.addEventListener("toggle", () => {
    if (details.open && needsRebuild(turn)) renderActivityContent(ctx, turn);
  });
  ctx.els.list.append(turn.activity.el, turn.answer.el);
  renderAnswer(ctx, turn);
  return turn;
}

function activityView(): ActivityView {
  const el = document.createElement("li");
  el.className = "activity";
  el.hidden = true;
  const details = document.createElement("details");
  details.className = "activity-details";
  const summary = document.createElement("summary");
  summary.className = "activity-summary";
  const body = document.createElement("div");
  body.className = "activity-body";
  details.append(summary, body);
  el.append(details);
  return {
    el,
    details,
    summary,
    body,
    images: newEntry("div", ""),
    dirty: true,
    renderedLive: false,
    streamKey: undefined,
  };
}

function answerView(): AnswerView {
  const el = document.createElement("li");
  el.className = "message assistant";
  el.hidden = true;
  const prefaces = document.createElement("div");
  prefaces.className = "reply-prefaces";
  const text = document.createElement("div");
  text.className = "message-text";
  const notice = document.createElement("p");
  notice.className = "reply-notice";
  notice.textContent = CUT_SHORT_NOTICE;
  notice.hidden = true;
  const checks = document.createElement("div");
  checks.className = "reply-checks";
  const actions = document.createElement("div");
  actions.className = "message-actions";
  const receipt = document.createElement("div");
  receipt.className = "reply-footer";
  el.append(prefaces, text, notice, checks, actions, receipt);
  return { el, prefaces, prefacesKey: undefined, text, notice, checks, actions, receipt };
}

function renderTurn(ctx: ConversationContext, turn: TurnView, streamed?: AssistantMessage): void {
  renderAnswer(ctx, turn);
  renderActivity(ctx, turn, streamed);
}

function videoAbout(
  ctx: ConversationContext,
  messageId: string | undefined,
): VideoAttachment | undefined {
  return videoForMessage(ctx.messages.values(), messageId, ctx.deps.videoView().video);
}

function seekHandler(ctx: ConversationContext, messageId: string): (seconds: number) => void {
  return (seconds) => ctx.deps.onSeek(seconds, videoAbout(ctx, messageId));
}

function turnSeekHandler(ctx: ConversationContext, turn: TurnView): (seconds: number) => void {
  return (seconds) => ctx.deps.onSeek(seconds, videoAbout(ctx, turn.user?.id ?? turn.steps[0]?.id));
}

// Times past the end of the video the message is about stay plain text; a zero length is unknown.
function textOptions(
  ctx: ConversationContext,
  messageId: string | undefined,
  onSeek: (seconds: number) => void,
): MarkdownOptions {
  const duration = videoAbout(ctx, messageId)?.durationSeconds;
  return { onSeek, ...(duration === undefined || duration <= 0 ? {} : { maxSeconds: duration }) };
}

function turnTextOptions(ctx: ConversationContext, turn: TurnView): MarkdownOptions {
  return textOptions(ctx, turn.user?.id ?? turn.steps[0]?.id, turnSeekHandler(ctx, turn));
}

function isLatest(ctx: ConversationContext, turn: TurnView): boolean {
  return turn === ctx.turns[ctx.turns.length - 1];
}

function replayButton(
  ctx: ConversationContext,
  label = "Replay: get a new reply",
): HTMLButtonElement {
  const replay = () => ctx.deps.onReplay();
  return actionButton(ctx, label, replay, "replay-action icon-action", "replay");
}

// The latest turn always offers a way to run again: Replay for a cut-off reply, Retry for none.
function rerunMode(ctx: ConversationContext, turn: TurnView): "replay" | "retry" | null {
  if (!isLatest(ctx, turn) || ctx.deps.isRunning() || turn.live !== null) return null;
  const answer = answerOf(turn.steps);
  if ((answer && answer.text !== "") || !turn.user) return null;
  return turn.steps.length > 0 ? "replay" : "retry";
}

function underway(ctx: ConversationContext, turn: TurnView): boolean {
  return (
    turn.live !== null || turn.streamingId !== null || (isLatest(ctx, turn) && ctx.deps.isRunning())
  );
}

function prefaceBlock(text: string, options: MarkdownOptions): HTMLElement {
  const block = document.createElement("div");
  block.className = "reply-preface";
  const label = document.createElement("span");
  label.className = "reply-preface-label";
  label.textContent = PREFACE_LABEL;
  const body = document.createElement("div");
  body.className = "reply-preface-text";
  renderMarkdownInto(body, text, options);
  block.append(label, body);
  return block;
}

function renderPrefaces(
  ctx: ConversationContext,
  turn: TurnView,
  prefaces: readonly AssistantMessage[],
): void {
  const view = turn.answer;
  const options = turnTextOptions(ctx, turn);
  const key = JSON.stringify([
    options.maxSeconds ?? null,
    prefaces.map((step) => [step.id, step.text]),
  ]);
  if (key === view.prefacesKey) return;
  view.prefacesKey = key;
  view.prefaces.replaceChildren(...prefaces.map((step) => prefaceBlock(step.text, options)));
}

// A round streams as the answer; once it calls tools its text becomes a preface in the same spot.
function renderAnswer(ctx: ConversationContext, turn: TurnView): void {
  const answer = answerOf(turn.steps);
  const prefaces = prefacesOf(turn.steps);
  const view = turn.answer;
  const streaming = answer !== undefined && turn.streamingId === answer.id;
  const rerun = rerunMode(ctx, turn);
  view.el.hidden =
    rerun === null && prefaces.length === 0 && (!answer || (answer.text === "" && !streaming));
  view.el.classList.toggle("is-streaming", streaming);
  view.el.classList.toggle("is-retry", rerun === "retry");
  renderPrefaces(ctx, turn, prefaces);
  if (answer && ctx.editor?.id === answer.id) return;
  renderMarkdownInto(view.text, answer?.text ?? "", turnTextOptions(ctx, turn));
  view.notice.hidden = answer?.reasoningCutShort !== true;
  const unanswered = !answer || answer.text === "";
  if (streaming || unanswered) {
    view.checks.replaceChildren();
    view.receipt.replaceChildren();
  }
  if (streaming || (unanswered && underway(ctx, turn))) {
    view.actions.replaceChildren();
    return;
  }
  const lead = replyLead(ctx, turn);
  if (unanswered) {
    view.actions.replaceChildren(
      ...lead,
      ...(rerun === "retry" ? [replayButton(ctx, "Retry")] : rerun ? [replayButton(ctx)] : []),
    );
    return;
  }
  const buttons = [
    ...lead,
    copyButton(ctx, answer),
    editButton(ctx, () => startEdit(ctx, answer, view.el, () => renderAnswer(ctx, turn))),
    branchButton(ctx, answer),
    deleteButton(ctx, answer),
  ];
  if (!ctx.checks.has(answer.id) && extractTimedClaims(answer.text).length > 0) {
    buttons.push(verifyButton(ctx, answer));
  }
  if (isLatest(ctx, turn) && turn.user) {
    buttons.push(replayButton(ctx), compareButton(ctx, turn));
    if (answer.stoppedAtRoundLimit) {
      buttons.push(actionButton(ctx, "Keep going", () => ctx.deps.onKeepGoing(), "keep-going"));
    }
  }
  view.actions.replaceChildren(...buttons);
  renderChecks(ctx, turn, answer);
  renderReplyReceipt(ctx, turn, answer);
}

function modelName(ctx: ConversationContext, id: string): string {
  return ctx.deps.models().find((model) => model.id === id)?.name ?? id;
}

// The swipe arrows on the latest reply, and the model's name when it is not the chat's.
function replyLead(ctx: ConversationContext, turn: TurnView): HTMLElement[] {
  const { user } = turn;
  if (!user) return [];
  const lead: HTMLElement[] = [];
  if (isLatest(ctx, turn) && replyCount(user) > 1) lead.push(swipeControl(ctx, user));
  const modelId = user.replyModelId;
  if (modelId !== undefined && modelId !== ctx.deps.chatModelId()) {
    const tag = document.createElement("span");
    tag.className = "reply-model";
    tag.textContent = modelName(ctx, modelId);
    tag.title = `Written by ${tag.textContent}`;
    lead.push(tag);
  }
  return lead;
}

function swipeControl(ctx: ConversationContext, user: UserMessage): HTMLElement {
  const count = replyCount(user);
  const index = currentReplyIndex(user);
  const el = document.createElement("span");
  el.className = "reply-swipe";
  const position = document.createElement("span");
  position.className = "reply-swipe-position";
  position.textContent = `${index + 1} / ${count}`;
  position.setAttribute("aria-label", `Reply ${index + 1} of ${count}`);
  el.append(
    swipeButton(ctx, user, index - 1, "Previous reply", "previous"),
    position,
    swipeButton(ctx, user, index + 1, "Next reply", "next"),
  );
  return el;
}

function swipeButton(
  ctx: ConversationContext,
  user: UserMessage,
  target: number,
  label: string,
  iconName: IconName,
): HTMLButtonElement {
  const button = actionButton(
    ctx,
    label,
    () => ctx.deps.onSwitchReply(user, target),
    "swipe-action",
    iconName,
  );
  if (target < 0 || target >= replyCount(user)) {
    button.disabled = true;
    button.dataset.locked = "";
  }
  return button;
}

function verifyButton(ctx: ConversationContext, answer: AssistantMessage): HTMLButtonElement {
  const check = () => startCheck(ctx, answer);
  return actionButton(ctx, "Check timestamps", check, "verify-action icon-action", "verify");
}

function compareButton(ctx: ConversationContext, turn: TurnView): HTMLButtonElement {
  const compare = () => openCompare(ctx, turn);
  const label = "Compare with another model…";
  return actionButton(ctx, label, compare, "compare-action icon-action", "compare");
}

function renderChecks(ctx: ConversationContext, turn: TurnView, answer: AssistantMessage): void {
  const view = turn.answer;
  const controller = ctx.checks.get(answer.id);
  if (controller) {
    const stop = () => stopCheck(ctx, answer.id, controller);
    view.checks.replaceChildren(renderCheckProgress(extractTimedClaims(answer.text).length, stop));
  } else if (answer.verification) {
    view.checks.replaceChildren(
      renderVerification(answer.verification, turnSeekHandler(ctx, turn)),
    );
  } else {
    view.checks.replaceChildren();
  }
}

function renderReplyReceipt(
  ctx: ConversationContext,
  turn: TurnView,
  answer: AssistantMessage,
): void {
  const { receipt } = answer;
  if (!receipt) {
    turn.answer.receipt.replaceChildren();
    return;
  }
  const modelId = turn.user?.replyModelId ?? ctx.deps.chatModelId();
  const pricing = ctx.deps.models().find((model) => model.id === modelId)?.pricing;
  const checking = ctx.checks.has(answer.id);
  turn.answer.receipt.replaceChildren(
    renderReceipt(receipt, turn.steps, pricing, {
      onSeek: turnSeekHandler(ctx, turn),
      running: ctx.deps.isRunning(),
      ...(checking ? {} : { onCheck: () => startCheck(ctx, answer) }),
    }),
  );
}

function startCheck(ctx: ConversationContext, answer: AssistantMessage): void {
  if (ctx.checks.has(answer.id)) return;
  const controller = new AbortController();
  ctx.checks.set(answer.id, controller);
  const turn = ctx.turnOf.get(answer.id);
  if (turn) renderAnswer(ctx, turn);
  ctx.deps
    .onVerify(answer, controller.signal)
    .then((updated) => finishCheck(ctx, answer.id, controller, updated))
    .catch(() => finishCheck(ctx, answer.id, controller, undefined));
}

function stopCheck(ctx: ConversationContext, id: string, controller: AbortController): void {
  controller.abort();
  finishCheck(ctx, id, controller, undefined);
}

function stopChecks(ctx: ConversationContext): void {
  for (const [id, controller] of [...ctx.checks]) stopCheck(ctx, id, controller);
}

// Stop finishes at once; the stopped check's own ending then finds a newer state and leaves it.
function finishCheck(
  ctx: ConversationContext,
  id: string,
  controller: AbortController,
  updated: AssistantMessage | undefined,
): void {
  if (ctx.checks.get(id) !== controller) return;
  ctx.checks.delete(id);
  const turn = ctx.turnOf.get(id);
  if (!turn) return;
  if (updated) upsertStep(ctx, turn, updated);
  renderAnswer(ctx, turn);
  afterChange(ctx);
}

function openCompare(ctx: ConversationContext, turn: TurnView): void {
  closeCompare(ctx);
  if (ctx.deps.isRunning()) return;
  const el = document.createElement("div");
  el.className = "compare-popover";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Compare with another model");
  const label = document.createElement("span");
  label.className = "compare-popover-label";
  label.textContent = "Compare with";
  const mount = document.createElement("div");
  mount.className = "compare-popover-picker";
  el.append(label, mount);
  turn.answer.actions.after(el);
  const picker = createModelPicker(
    { mount, ...ctx.templates },
    {
      models: () => ctx.deps.models(),
      current: () => turn.user?.replyModelId ?? ctx.deps.chatModelId(),
      onPick: (id) => pickCompare(ctx, id),
      settings: ctx.deps.pickerSettings,
    },
  );
  const onOutside = (event: Event) => {
    if (!(event.target instanceof Node && el.contains(event.target))) closeCompare(ctx);
  };
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeCompare(ctx);
  });
  document.addEventListener("pointerdown", onOutside, true);
  ctx.compare = { el, picker, onOutside };
  mount.querySelector<HTMLButtonElement>(".model-trigger")?.click();
}

function pickCompare(ctx: ConversationContext, id: string): void {
  const model = ctx.deps.models().find((entry) => entry.id === id);
  closeCompare(ctx);
  if (model) ctx.deps.onCompare(model);
}

function closeCompare(ctx: ConversationContext): void {
  const popover = ctx.compare;
  if (!popover) return;
  ctx.compare = null;
  popover.picker.close();
  document.removeEventListener("pointerdown", popover.onOutside, true);
  popover.el.remove();
}

function actionButton(
  ctx: ConversationContext,
  label: string,
  onClick: () => void,
  extraClass = "",
  iconName?: IconName,
): HTMLButtonElement {
  const className = `message-action ${extraClass}`.trim();
  const button = iconName
    ? iconButton(className, label, icon(iconName), onClick)
    : smallButton(className, label, onClick);
  button.disabled = ctx.deps.isRunning();
  return button;
}

// Copying changes nothing, so unlike the other actions it stays enabled while a turn runs.
function copyButton(ctx: ConversationContext, message: ChatMessage): HTMLButtonElement {
  const copy = () => ctx.deps.onCopy(message);
  const button = actionButton(ctx, "Copy message", copy, "copy-action icon-action", "copy");
  button.disabled = false;
  return button;
}

function editButton(ctx: ConversationContext, onClick: () => void): HTMLButtonElement {
  return actionButton(ctx, "Edit message", onClick, "edit-action icon-action", "pencil");
}

function branchButton(ctx: ConversationContext, message: ChatMessage): HTMLButtonElement {
  const branch = () => ctx.deps.onBranch(message);
  return actionButton(
    ctx,
    "Branch: new chat from here",
    branch,
    "branch-action icon-action",
    "branch",
  );
}

function deleteButton(ctx: ConversationContext, message: ChatMessage): HTMLButtonElement {
  const remove = () => {
    ctx.pendingFocus = {
      kind: "position",
      index: messagePosition(ctx, button.closest(".message")),
    };
    ctx.deps.onDelete(message);
  };
  const button = actionButton(ctx, "Delete message", remove, "delete-action icon-action", "trash");
  return button;
}

function renderActivity(
  ctx: ConversationContext,
  turn: TurnView,
  streamed?: AssistantMessage,
): void {
  const view = turn.activity;
  const visible = turn.live !== null || hasActivity(turn.steps);
  view.el.hidden = !visible;
  if (!visible) return;
  const tokens = replyUsageText(turn.steps);
  view.summary.textContent =
    turn.live ?? `${activitySummary(turn.steps)}${tokens === "" ? "" : ` · ${tokens}`}`;
  view.el.classList.toggle("is-live", turn.live !== null);
  if (!view.details.open) return;
  if (streamed && grewInPlace(turn, streamed)) return;
  if (needsRebuild(turn)) renderActivityContent(ctx, turn);
}

function needsRebuild(turn: TurnView): boolean {
  const view = turn.activity;
  return view.dirty || view.renderedLive !== (turn.live !== null);
}

// A streamed token that only grows reasoning, or the text below the row, leaves the body as is.
function grewInPlace(turn: TurnView, streamed: AssistantMessage): boolean {
  const view = turn.activity;
  if (view.renderedLive !== (turn.live !== null)) return false;
  if (view.streamKey !== streamingBodyKey(streamed)) return false;
  const grown = (streamed.reasoning ?? "") === "" || updateStreamingReasoning(view.body, streamed);
  if (grown) view.dirty = false;
  return grown;
}

function streamingStep(turn: TurnView): AssistantMessage | undefined {
  const step = turn.steps.find((entry) => entry.id === turn.streamingId);
  return step?.role === "assistant" ? step : undefined;
}

function renderActivityContent(ctx: ConversationContext, turn: TurnView): void {
  const view = turn.activity;
  dispose(view.images);
  const images = newEntry("div", "");
  view.images = images;
  const seek = turnSeekHandler(ctx, turn);
  renderActivityBody(view.body, turn.steps, {
    live: turn.live !== null,
    thumbnail: (ref, messageId, index) => thumbnail(ctx, images, ref, messageId, index),
    seek,
  });
  view.dirty = false;
  view.renderedLive = turn.live !== null;
  const streaming = streamingStep(turn);
  view.streamKey = streaming && streamingBodyKey(streaming);
}

function renderUser(ctx: ConversationContext, turn: TurnView): void {
  const message = turn.user;
  const previous = turn.userEntry;
  if (!message || !previous || ctx.editor?.id === message.id) return;
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
  if (message.video) entry.el.append(videoSlotFor(ctx, message.id, message.video));
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

function startEdit(
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
    el.classList.remove("is-editing");
    editor.remove();
    if (text !== null && text !== message.text) {
      ctx.pendingFocus = { kind: "message", id: message.id };
      ctx.deps.onEdit(message, text);
      return;
    }
    rerender();
    focusWithin(ctx, messageElement(ctx, message.id));
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
  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    finish(null);
  });
  const buttons = document.createElement("div");
  buttons.className = "message-editor-actions";
  buttons.append(cancel, save);
  editor.append(textarea, problem, buttons);
  el.append(editor);
  if (!draft || draft.focused) textarea.focus();
}

function videoSlotFor(
  ctx: ConversationContext,
  messageId: string,
  video: VideoAttachment,
): HTMLElement {
  const slot: VideoSlot = {
    el: document.createElement("div"),
    video,
    shown: "",
    coverage: undefined,
  };
  slot.el.className = "inline-video";
  ctx.videoSlots.set(messageId, slot);
  renderVideoSlot(ctx, slot);
  return slot.el;
}

function videoCaption(text: string): HTMLElement {
  const caption = document.createElement("span");
  caption.className = "inline-video-caption";
  caption.textContent = text;
  return caption;
}

// Rebuilt only when what it shows changes, so a refresh does not stop an inline video mid-play.
function renderVideoSlot(ctx: ConversationContext, slot: VideoSlot): void {
  const view = ctx.deps.videoView();
  const replaced = view.video?.fileKey !== slot.video.fileKey;
  const shown = replaced ? "replaced" : (view.url ?? "missing");
  if (shown === slot.shown) return;
  slot.shown = shown;
  slot.el.classList.toggle("is-replaced", replaced);
  slot.coverage = undefined;
  const summary = videoSummary(slot.video);
  if (replaced) {
    slot.el.replaceChildren(videoCaption(`${summary} (replaced)`));
    return;
  }
  if (view.url === null) {
    const reattach = smallButton("button primary", "Reattach video", () => ctx.deps.onReattach());
    slot.el.replaceChildren(videoCaption(summary), reattach);
    return;
  }
  const player = document.createElement("video");
  player.className = "inline-video-player";
  player.controls = true;
  player.preload = "metadata";
  player.playsInline = true;
  player.src = view.url;
  const popOut = smallButton("pop-out", "Pop out", () => {
    player.pause();
    ctx.deps.onPopOut(player.currentTime);
  });
  const bar = document.createElement("div");
  bar.className = "inline-video-bar";
  bar.append(videoCaption(summary), popOut);
  const coverage = createCoverageStrip({
    onSeek: (seconds) => {
      player.currentTime = seconds;
    },
  });
  coverage.follow(player);
  coverage.update([...ctx.messages.values()], slot.video.durationSeconds);
  slot.coverage = coverage;
  slot.el.replaceChildren(player, coverage.el, bar);
}

function togglePin(ctx: ConversationContext, message: UserMessage, index: number): void {
  const updated: UserMessage = {
    ...message,
    images: message.images.map((ref, i) => (i === index ? { ...ref, pinned: !ref.pinned } : ref)),
  };
  ctx.deps.onMessageChanged(updated);
  showMessage(ctx, updated);
}

function thumbnail(
  ctx: ConversationContext,
  entry: Entry,
  ref: ImageRef,
  messageId: string,
  index: number,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thumb-button";
  const img = document.createElement("img");
  img.alt = imageCaption(ref);
  button.title = img.alt;
  img.loading = "lazy";
  button.append(img);
  button.addEventListener("click", () => openLightbox(ctx, messageId, index));
  ctx.deps.store
    .getImage(ref.id)
    .then((blob) => {
      if (blob === undefined || entry.disposed) return;
      const url = URL.createObjectURL(blob);
      entry.urls.push(url);
      img.src = url;
    })
    .catch(() => {
      img.alt = `${img.alt} (not found)`;
    });
  return button;
}

function lightboxItems(ctx: ConversationContext): LightboxItem[] {
  return [...ctx.messages.values()].flatMap((message) =>
    message.role === "assistant"
      ? []
      : message.images.map((ref, index) => ({
          messageId: message.id,
          index,
          ref,
          pinnable: message.role === "user",
        })),
  );
}

function openLightbox(ctx: ConversationContext, messageId: string, index: number): void {
  const items = lightboxItems(ctx);
  const position = items.findIndex((item) => item.messageId === messageId && item.index === index);
  ctx.lightbox.open(items, position);
}

function togglePinFromLightbox(ctx: ConversationContext, item: LightboxItem): LightboxItem[] {
  const message = ctx.messages.get(item.messageId);
  if (message?.role === "user") togglePin(ctx, message, item.index);
  return lightboxItems(ctx);
}
