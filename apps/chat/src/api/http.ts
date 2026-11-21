import type { ApiSettings } from "../types";
import { asRecord } from "./json";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function requestHeaders(settings: ApiSettings, json: boolean): Record<string, string> {
  return {
    ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function errorMessageFrom(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const record = asRecord(parsed);
    const error = record["error"];
    if (typeof error === "string") return error;
    const nested = asRecord(error)["message"];
    if (typeof nested === "string") return nested;
    if (typeof record["message"] === "string") return record["message"];
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return body;
}

export async function throwForStatus(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.text()).trim();
  throw new ApiError(response.status, errorMessageFrom(body) || response.statusText);
}
