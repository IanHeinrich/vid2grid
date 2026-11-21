import { describe, expect, it } from "vitest";
import { getBalance } from "../src/api/accountBalance";
import { VENICE_BASE_URL } from "../src/api/venice";
import { fakeFetch, jsonResponse, localSettings, veniceSettings } from "./support/apiFakes";

describe("getBalance", () => {
  it("maps the balance, leaving out null figures", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({
        canConsume: true,
        consumptionCurrency: "USD",
        balances: { diem: null, usd: 25.5, bundledCredits: null, earnedCredits: 5 },
        diemEpochAllocation: 0,
      }),
    );
    expect(await getBalance(veniceSettings, fetchImpl)).toEqual({
      canConsume: true,
      consumptionCurrency: "USD",
      usd: 25.5,
      diemAllocation: 0,
      earnedCredits: 5,
    });
    expect(calls[0]?.url).toBe(`${VENICE_BASE_URL}/billing/balance`);
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer secret");
  });

  it("maps a null consumption currency and DIEM figures", async () => {
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({
        canConsume: false,
        consumptionCurrency: null,
        balances: { diem: 90.5, usd: null, bundledCredits: 10, earnedCredits: null },
        diemEpochAllocation: 100,
      }),
    );
    expect(await getBalance(veniceSettings, fetchImpl)).toEqual({
      canConsume: false,
      consumptionCurrency: null,
      diem: 90.5,
      diemAllocation: 100,
      bundledCredits: 10,
    });
  });

  it("reports notVenice without a request for another server", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(() => jsonResponse({}));
    expect(await getBalance(localSettings, fetchImpl)).toEqual({ unavailable: "notVenice" });
    expect(calls).toHaveLength(0);
  });

  it.each([401, 403])("reports needsAdminKey for status %d", async (status) => {
    const { fetch: fetchImpl } = fakeFetch(() => jsonResponse({ error: "Forbidden" }, status));
    expect(await getBalance(veniceSettings, fetchImpl)).toEqual({ unavailable: "needsAdminKey" });
  });

  it("reports other failures as errors with their message", async () => {
    const server = fakeFetch(() => jsonResponse({ error: "Upstream down" }, 500));
    expect(await getBalance(veniceSettings, server.fetch)).toEqual({
      unavailable: "error",
      message: "Upstream down",
    });
    const offline: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await getBalance(veniceSettings, offline)).toEqual({
      unavailable: "error",
      message: "Failed to fetch",
    });
  });
});
