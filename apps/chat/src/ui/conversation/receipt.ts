import { usageCostUsd } from "../../api/usage";
import { formatCost, formatTokens, usageTotals } from "../../chat/tokenEstimate";
import { plural } from "../../text";
import type { ChatMessage, ModelInfo, TurnReceipt } from "../../types";
import { seekButton, smallButton } from "../buttons";

export interface ReceiptActions {
  onSeek: (seconds: number) => void;
  // Absent while a check is already running, which hides the Check button.
  onCheck?: () => void;
  running: boolean;
}

export function durationText(durationMs: number): string {
  const seconds = durationMs / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

export function receiptParts(
  receipt: TurnReceipt,
  steps: readonly ChatMessage[],
  pricing: ModelInfo["pricing"],
): string[] {
  const parts = [plural(receipt.rounds, "round"), plural(receipt.imagesSent, "image")];
  const usage = usageTotals(steps);
  if (usage) {
    const cached =
      usage.cachedTokens !== undefined && usage.promptTokens > 0
        ? ` (${Math.round((Math.min(usage.cachedTokens, usage.promptTokens) / usage.promptTokens) * 100)}% cached)`
        : "";
    parts.push(
      `${formatTokens(usage.promptTokens)} in${cached} / ${formatTokens(usage.completionTokens)} out`,
    );
    const cost = usageCostUsd(usage, pricing);
    if (cost !== undefined) parts.push(`≈ ${formatCost(cost)}`);
  }
  parts.push(durationText(receipt.durationMs));
  return parts;
}

function unseenFlag(seconds: readonly number[], actions: ReceiptActions): HTMLElement {
  const flag = document.createElement("p");
  flag.className = "unseen-flag";
  flag.append("Cited ");
  seconds.forEach((t, index) => {
    if (index > 0) flag.append(", ");
    flag.append(seekButton(t, actions.onSeek));
  });
  flag.append(" without looking");
  const { onCheck } = actions;
  if (!onCheck) return flag;
  const check = smallButton("message-action unseen-check", "Check", onCheck);
  check.title = "Check the reply's timestamps against the video";
  check.disabled = actions.running;
  flag.append(check);
  return flag;
}

export function renderReceipt(
  receipt: TurnReceipt,
  steps: readonly ChatMessage[],
  pricing: ModelInfo["pricing"],
  actions: ReceiptActions,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "reply-receipt";
  const line = document.createElement("p");
  line.className = "reply-receipt-line";
  line.textContent = receiptParts(receipt, steps, pricing).join(" · ");
  el.append(line);
  if (receipt.unseenCitations.length > 0) {
    el.append(unseenFlag(receipt.unseenCitations, actions));
  }
  return el;
}
