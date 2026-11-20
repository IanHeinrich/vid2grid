import { beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import type { AccountBalance, BalanceUnavailable } from "../src/api/client";
import { queryElements, type AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setSettings, type AppState } from "../src/state";
import { balanceText, initBalance, sourceText } from "../src/ui/balance";

let els: AppElements;
let state: AppState;
let tick: (() => void) | undefined;
let visible: boolean;

function setup(result: AccountBalance | BalanceUnavailable) {
  const getBalance = vi.fn(() => Promise.resolve(result));
  const balance = initBalance(els, state, {
    getBalance,
    setInterval: (run) => (tick = run),
    isVisible: () => visible,
  });
  return { balance, getBalance };
}

beforeEach(() => {
  document.body.innerHTML = indexHtml;
  els = queryElements();
  state = createAppState({ ...DEFAULT_SETTINGS, apiKey: "key" });
  tick = undefined;
  visible = true;
});

describe("balanceText", () => {
  it("shows only the parts that are present", () => {
    const base = { canConsume: true, consumptionCurrency: "USD" };
    expect(balanceText({ ...base, usd: 4.234 })).toBe("$4.23");
    expect(balanceText({ ...base, diem: 90.5, diemAllocation: 100 })).toBe("DIEM 90.5 / 100");
    expect(balanceText({ ...base, diem: 3 })).toBe("DIEM 3");
    expect(balanceText({ ...base, bundledCredits: 6, earnedCredits: 4 })).toBe("10 credits");
    expect(
      balanceText({ ...base, usd: 4.23, diem: 90.5, diemAllocation: 100, bundledCredits: 1 }),
    ).toBe("$4.23 · DIEM 90.5 / 100 · 1 credit");
  });

  it("says where payment comes from, or that the balance is out", () => {
    expect(sourceText({ canConsume: true, consumptionCurrency: "DIEM" })).toBe(
      "Paying from DIEM allowance",
    );
    expect(sourceText({ canConsume: true, consumptionCurrency: "USD" })).toBe(
      "Paying from USD balance",
    );
    expect(sourceText({ canConsume: true, consumptionCurrency: "BUNDLED_CREDITS" })).toBe(
      "Paying from bundled credits",
    );
    expect(sourceText({ canConsume: false, consumptionCurrency: "USD" })).toBe("Out of balance");
  });
});

describe("initBalance", () => {
  it("shows the balance and turns red when it cannot be spent", async () => {
    await setup({ canConsume: false, consumptionCurrency: "USD", usd: 0 }).balance.refresh();
    expect(els.balance.el.hidden).toBe(false);
    expect(els.balance.text.textContent).toBe("$0.00");
    expect(els.balance.source.textContent).toBe("Out of balance");
    expect(els.balance.el.classList.contains("is-out")).toBe(true);
  });

  it("explains that an admin key is needed", async () => {
    await setup({ unavailable: "needsAdminKey" }).balance.refresh();
    expect(els.balance.text.textContent).toBe("Balance needs an admin API key");
    expect(els.balance.el.title).toContain("full access");
  });

  it("hides for servers other than Venice and reports errors quietly", async () => {
    await setup({ unavailable: "notVenice" }).balance.refresh();
    expect(els.balance.el.hidden).toBe(true);
    await setup({ unavailable: "error", message: "timeout" }).balance.refresh();
    expect(els.balance.text.textContent).toBe("Balance unavailable");
    expect(els.balance.el.title).toBe("timeout");
  });

  it("refreshes every minute only while the tab is visible", () => {
    const { getBalance } = setup({ canConsume: true, consumptionCurrency: "USD", usd: 1 });
    tick?.();
    expect(getBalance).toHaveBeenCalledTimes(1);
    visible = false;
    tick?.();
    expect(getBalance).toHaveBeenCalledTimes(1);
  });

  it.each(["needsAdminKey", "notVenice"] as const)(
    "stops asking after %s until the settings change",
    async (unavailable) => {
      const { balance, getBalance } = setup({ unavailable });
      await balance.refresh();
      tick?.();
      await balance.refresh();
      expect(getBalance).toHaveBeenCalledTimes(1);
      setSettings(state, { ...state.settings, apiKey: "admin-key" });
      await balance.refresh();
      expect(getBalance).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps asking after a passing error", async () => {
    const { balance, getBalance } = setup({ unavailable: "error", message: "timeout" });
    await balance.refresh();
    await balance.refresh();
    expect(getBalance).toHaveBeenCalledTimes(2);
  });
});
