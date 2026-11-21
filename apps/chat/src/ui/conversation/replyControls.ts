import { currentReplyIndex, replyCount } from "../../chat/alternates";
import { extractTimedClaims } from "../../chat/verify";
import type { AssistantMessage, ChatMessage, UserMessage } from "../../types";
import { iconButton, smallButton } from "../shared/buttons";
import { icon, type IconName } from "../shared/icons";
import { dismissOnOutside } from "../shared/menu";
import { createModelPicker } from "../modelPicker/modelPicker";
import { answerOf } from "./activity";
import {
  isLatest,
  turnSeekHandler,
  upsertStep,
  type ConversationContext,
  type TurnView,
} from "./context";
import { messagePosition } from "./focus";
import { renderReceipt } from "./receipt";
import { renderCheckProgress, renderVerification } from "./verifyPanel";

function modelName(ctx: ConversationContext, id: string): string {
  return ctx.deps.models().find((model) => model.id === id)?.name ?? id;
}

// The swipe arrows on the latest reply, and the model's name when it is not the chat's.
export function replyLead(ctx: ConversationContext, turn: TurnView): HTMLElement[] {
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

export function replayButton(
  ctx: ConversationContext,
  label = "Replay: get a new reply",
): HTMLButtonElement {
  const replay = () => ctx.deps.onReplay();
  return actionButton(ctx, label, replay, "replay-action icon-action", "replay");
}

// The latest turn always offers a way to run again: Replay for a cut-off reply, Retry for none.
export function rerunMode(ctx: ConversationContext, turn: TurnView): "replay" | "retry" | null {
  if (!isLatest(ctx, turn) || ctx.deps.isRunning() || turn.live !== null) return null;
  const answer = answerOf(turn.steps);
  if ((answer && answer.text !== "") || !turn.user) return null;
  return turn.steps.length > 0 ? "replay" : "retry";
}

export function verifyButton(
  ctx: ConversationContext,
  answer: AssistantMessage,
): HTMLButtonElement {
  const check = () => startCheck(ctx, answer);
  return actionButton(ctx, "Check timestamps", check, "verify-action icon-action", "verify");
}

export function compareButton(ctx: ConversationContext, turn: TurnView): HTMLButtonElement {
  const compare = () => openCompare(ctx, turn);
  const label = "Compare with another model…";
  return actionButton(ctx, label, compare, "compare-action icon-action", "compare");
}

export function renderChecks(
  ctx: ConversationContext,
  turn: TurnView,
  answer: AssistantMessage,
): void {
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

export function renderReplyReceipt(
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
  if (turn) ctx.renderAnswer(turn);
  ctx.deps
    .onVerify(answer, controller.signal)
    .then((updated) => finishCheck(ctx, answer.id, controller, updated))
    .catch(() => finishCheck(ctx, answer.id, controller, undefined));
}

function stopCheck(ctx: ConversationContext, id: string, controller: AbortController): void {
  controller.abort();
  finishCheck(ctx, id, controller, undefined);
}

export function stopChecks(ctx: ConversationContext): void {
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
  ctx.renderAnswer(turn);
  ctx.afterChange();
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
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeCompare(ctx);
    turn.answer.actions.querySelector<HTMLButtonElement>(".compare-action")?.focus();
  });
  el.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !el.contains(next)) closeCompare(ctx);
  });
  ctx.compare = { el, picker, stopOutside: dismissOnOutside(el, () => closeCompare(ctx)) };
  mount.querySelector<HTMLButtonElement>(".model-trigger")?.click();
}

function pickCompare(ctx: ConversationContext, id: string): void {
  const model = ctx.deps.models().find((entry) => entry.id === id);
  closeCompare(ctx);
  if (model) ctx.deps.onCompare(model);
}

export function closeCompare(ctx: ConversationContext): void {
  const popover = ctx.compare;
  if (!popover) return;
  ctx.compare = null;
  popover.picker.close();
  popover.stopOutside();
  popover.el.remove();
}

export function actionButton(
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
export function copyButton(ctx: ConversationContext, message: ChatMessage): HTMLButtonElement {
  const copy = () => ctx.deps.onCopy(message);
  const button = actionButton(ctx, "Copy message", copy, "copy-action icon-action", "copy");
  button.disabled = false;
  return button;
}

export function editButton(ctx: ConversationContext, onClick: () => void): HTMLButtonElement {
  return actionButton(ctx, "Edit message", onClick, "edit-action icon-action", "pencil");
}

export function branchButton(ctx: ConversationContext, message: ChatMessage): HTMLButtonElement {
  const branch = () => ctx.deps.onBranch(message);
  return actionButton(
    ctx,
    "Branch: new chat from here",
    branch,
    "branch-action icon-action",
    "branch",
  );
}

export function deleteButton(ctx: ConversationContext, message: ChatMessage): HTMLButtonElement {
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
