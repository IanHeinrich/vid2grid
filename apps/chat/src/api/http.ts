import { isAbortError } from "../abort";
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

// Shorter ones are placeholders, and taking them out would garble the message.
const MIN_KEY_CHARS = 4;

function withoutKey(text: string, { apiKey }: Pick<ApiSettings, "apiKey">): string {
  const key = apiKey.trim();
  return key.length < MIN_KEY_CHARS ? text : text.replaceAll(key, "…");
}

// Some servers repeat the key they were sent. Left whole, since what is wrong can be told from any
// part of it, and never with the first error as its cause, which would carry the key along.
export function safeError(error: unknown, api: Pick<ApiSettings, "apiKey">): unknown {
  if (!(error instanceof Error) || isAbortError(error)) return error;
  const message = withoutKey(error.message, api);
  if (message === error.message) return error;
  if (error instanceof ApiError) return new ApiError(error.status, message);
  return error instanceof SyntaxError ? new SyntaxError(message) : new Error(message);
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
