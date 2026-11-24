import { errorText } from "../text";
import type { ApiSettings } from "../types";
import { requestHeaders, safeError, throwForStatus } from "./http";
import { asRecord } from "./json";
import { isVenice, normaliseBaseUrl } from "./venice";

export interface AccountBalance {
  canConsume: boolean;
  consumptionCurrency: string | null;
  usd?: number;
  diem?: number;
  diemAllocation?: number;
  bundledCredits?: number;
  earnedCredits?: number;
}

export type BalanceUnavailable = {
  unavailable: "needsAdminKey" | "notVenice" | "error";
  message?: string;
};

function toAccountBalance(body: unknown): AccountBalance {
  const record = asRecord(body);
  const { usd, diem, bundledCredits, earnedCredits } = asRecord(record["balances"]);
  const currency = record["consumptionCurrency"];
  const diemAllocation = record["diemEpochAllocation"];
  return {
    canConsume: record["canConsume"] === true,
    consumptionCurrency: typeof currency === "string" ? currency : null,
    ...(typeof usd === "number" ? { usd } : {}),
    ...(typeof diem === "number" ? { diem } : {}),
    ...(typeof diemAllocation === "number" ? { diemAllocation } : {}),
    ...(typeof bundledCredits === "number" ? { bundledCredits } : {}),
    ...(typeof earnedCredits === "number" ? { earnedCredits } : {}),
  };
}

// Venice serves billing to admin keys only; an inference key gets 401 or 403.
export async function getBalance(
  settings: ApiSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountBalance | BalanceUnavailable> {
  if (!isVenice(settings.baseUrl)) return { unavailable: "notVenice" };
  try {
    const response = await fetchImpl(`${normaliseBaseUrl(settings.baseUrl)}/billing/balance`, {
      headers: requestHeaders(settings, false),
    });
    if (response.status === 401 || response.status === 403) {
      return { unavailable: "needsAdminKey" };
    }
    await throwForStatus(response);
    return toAccountBalance(await response.json());
  } catch (error) {
    return {
      unavailable: "error",
      message: errorText(safeError(error, settings)),
    };
  }
}
