import { VENICE_BASE_URL } from "../../src/api/venice";
import type { ApiSettings } from "../../src/types";

export const veniceSettings: ApiSettings = { baseUrl: VENICE_BASE_URL, apiKey: "secret" };
export const localSettings: ApiSettings = { baseUrl: "http://localhost:11434/v1/", apiKey: "" };

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

export function fakeFetch(respond: () => Response): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(respond());
  };
  return { fetch: impl, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
