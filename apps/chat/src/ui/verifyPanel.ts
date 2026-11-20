import type { ClaimCheck, ClaimVerdict } from "../types";
import { seekButton, smallButton } from "./buttons";

const MARKS: Record<ClaimVerdict, { mark: string; label: string }> = {
  confirmed: { mark: "✓", label: "Confirmed" },
  contradicted: { mark: "✗", label: "Contradicted" },
  unclear: { mark: "?", label: "Unclear" },
};

export function verdictSummary(checks: readonly ClaimCheck[]): string {
  const order: ClaimVerdict[] = ["confirmed", "contradicted", "unclear"];
  return order
    .map((verdict) => {
      const count = checks.filter((check) => check.verdict === verdict).length;
      return count === 0 ? "" : `${count} ${verdict}`;
    })
    .filter((part) => part !== "")
    .join(", ");
}

export function renderCheckProgress(claimCount: number, onStop: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "claim-checks is-running";
  el.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = `Checking ${claimCount} ${claimCount === 1 ? "claim" : "claims"} against the video…`;
  el.append(text, smallButton("claim-checks-stop", "Stop", onStop));
  return el;
}

function claimItem(check: ClaimCheck, onSeek: (seconds: number) => void): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `claim-check is-${check.verdict}`;
  const { mark, label } = MARKS[check.verdict];
  const badge = document.createElement("span");
  badge.className = "claim-mark";
  badge.textContent = mark;
  badge.title = label;
  badge.setAttribute("aria-label", label);
  const times = document.createElement("span");
  times.className = "claim-times";
  times.append(...check.seconds.map((seconds) => seekButton(seconds, onSeek)));
  const claim = document.createElement("q");
  claim.className = "claim-text";
  claim.textContent = check.claim;
  const reason = document.createElement("span");
  reason.className = "claim-reason";
  reason.textContent = check.reason;
  item.append(badge, times, claim, reason);
  return item;
}

export function renderVerification(
  checks: readonly ClaimCheck[],
  onSeek: (seconds: number) => void,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "claim-checks";
  const heading = document.createElement("p");
  heading.className = "claim-checks-heading";
  heading.textContent =
    checks.length === 0 ? "No timestamps to check." : `Timestamp check: ${verdictSummary(checks)}`;
  const list = document.createElement("ul");
  list.className = "claim-check-list";
  list.append(...checks.map((check) => claimItem(check, onSeek)));
  el.append(heading, list);
  return el;
}
