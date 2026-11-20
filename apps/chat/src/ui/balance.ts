import type { AccountBalance, BalanceUnavailable } from "../api/client";
import type { AppElements } from "../dom";
import type { AppState } from "../state";
import type { ApiSettings } from "../types";

const REFRESH_MS = 60_000;
const ADMIN_KEY_HINT =
  "Venice only shows billing to admin API keys. An inference key cannot read it, and an admin key stored in this browser would have full access to your account.";

export interface Balance {
  refresh(): Promise<void>;
}

export interface BalanceDeps {
  getBalance(settings: ApiSettings): Promise<AccountBalance | BalanceUnavailable>;
  setInterval?: (run: () => void, ms: number) => unknown;
  isVisible?: () => boolean;
}

function amount(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(value < 10 ? 2 : 1).replace(/0$/, "");
}

export function balanceText(balance: AccountBalance): string {
  const parts: string[] = [];
  if (balance.usd !== undefined) parts.push(`$${balance.usd.toFixed(2)}`);
  if (balance.diem !== undefined) {
    const allocation =
      balance.diemAllocation === undefined ? "" : ` / ${amount(balance.diemAllocation)}`;
    parts.push(`DIEM ${amount(balance.diem)}${allocation}`);
  }
  const hasCredits = balance.bundledCredits !== undefined || balance.earnedCredits !== undefined;
  if (hasCredits) {
    const credits = (balance.bundledCredits ?? 0) + (balance.earnedCredits ?? 0);
    parts.push(`${amount(credits)} credit${credits === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function sourceText(balance: AccountBalance): string {
  if (!balance.canConsume) return "Out of balance";
  const currency = balance.consumptionCurrency?.toLowerCase() ?? "";
  if (currency === "") return "";
  if (currency.includes("diem")) return "Paying from DIEM allowance";
  if (currency.includes("usd")) return "Paying from USD balance";
  if (currency.includes("credit") || currency.includes("bundle"))
    return "Paying from bundled credits";
  return `Paying from ${balance.consumptionCurrency ?? ""}`;
}

export function initBalance(
  els: Pick<AppElements, "balance">,
  state: AppState,
  deps: BalanceDeps,
): Balance {
  const { el, text, source } = els.balance;
  let request = 0;
  const show = (result: AccountBalance | BalanceUnavailable) => {
    el.classList.remove("is-out", "is-unavailable");
    el.title = "";
    if ("unavailable" in result) {
      el.hidden = result.unavailable === "notVenice";
      el.classList.add("is-unavailable");
      text.textContent =
        result.unavailable === "needsAdminKey"
          ? "Balance needs an admin API key"
          : "Balance unavailable";
      source.textContent = "";
      el.title = result.unavailable === "needsAdminKey" ? ADMIN_KEY_HINT : (result.message ?? "");
      return;
    }
    el.hidden = false;
    el.classList.toggle("is-out", !result.canConsume);
    text.textContent = balanceText(result);
    source.textContent = sourceText(result);
  };
  // Asking again cannot change these answers, so polling waits until the key or server changes.
  let settledFor: string | null = null;
  const refresh = async () => {
    const token = ++request;
    const { baseUrl, apiKey } = state.settings;
    if (apiKey === "") {
      el.hidden = true;
      return;
    }
    const asked = `${baseUrl}
${apiKey}`;
    if (asked === settledFor) return;
    const result = await deps.getBalance({ baseUrl, apiKey });
    if (token !== request) return;
    const final = "unavailable" in result && result.unavailable !== "error";
    settledFor = final ? asked : null;
    show(result);
  };
  const isVisible = deps.isVisible ?? (() => document.visibilityState === "visible");
  (deps.setInterval ?? ((run, ms) => window.setInterval(run, ms)))(() => {
    if (isVisible()) refresh().catch(() => undefined);
  }, REFRESH_MS);
  return { refresh };
}
