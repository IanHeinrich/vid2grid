import { replyUsageText } from "../../chat/tokenEstimate";
import { extractTimedClaims } from "../../chat/verify";
import type { AssistantMessage, UserMessage } from "../../types";
import {
  activitySummary,
  answerOf,
  hasActivity,
  prefacesOf,
  renderActivityBody,
  streamingBodyKey,
  updateStreamingReasoning,
} from "./activity";
import {
  dispose,
  isLatest,
  newEntry,
  turnSeekHandler,
  turnTextOptions,
  underway,
  type ActivityView,
  type AnswerView,
  type ConversationContext,
  type TurnView,
} from "./context";
import { renderMarkdownInto, type MarkdownOptions } from "./markdown";
import {
  actionButton,
  branchButton,
  compareButton,
  copyButton,
  deleteButton,
  editButton,
  renderChecks,
  renderReplyReceipt,
  replayButton,
  replyLead,
  rerunMode,
  verifyButton,
} from "./replyControls";
import { thumbnail } from "./thumbnails";
import { startEdit } from "./userMessage";

const PREFACE_LABEL = "Before looking";
const CUT_SHORT_NOTICE =
  "The model's thinking was cut short, so it answered from what it had worked out so far.";

// A turn is keyed by its user message, or by its first step when a reply opens the chat.
export function createTurn(
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

export function renderTurn(
  ctx: ConversationContext,
  turn: TurnView,
  streamed?: AssistantMessage,
): void {
  renderAnswer(ctx, turn);
  renderActivity(ctx, turn, streamed);
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
export function renderAnswer(ctx: ConversationContext, turn: TurnView): void {
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

export function renderActivity(
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

export function streamingStep(turn: TurnView): AssistantMessage | undefined {
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
