import { messageElement, type ConversationContext } from "./context";

export function applyPendingFocus(ctx: ConversationContext): void {
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

export function focusWithin(ctx: ConversationContext, el: HTMLElement | undefined): void {
  const button =
    el?.querySelector<HTMLButtonElement>(".edit-action:not(:disabled)") ??
    el?.querySelector<HTMLButtonElement>(".message-action:not(:disabled)");
  if (button) button.focus();
  else ctx.deps.focusComposer();
}

export function messagePosition(ctx: ConversationContext, el: Element | null): number {
  const shown = [...ctx.els.list.querySelectorAll(".message:not([hidden])")];
  return Math.max(
    0,
    shown.findIndex((entry) => entry === el),
  );
}
