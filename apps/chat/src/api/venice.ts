import type { ChatRequest } from "../types";

export const VENICE_BASE_URL = "https://api.venice.ai/api/v1";

export function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function isVenice(baseUrl: string): boolean {
  try {
    return new URL(baseUrl.trim()).hostname === "api.venice.ai";
  } catch {
    return false;
  }
}

export function veniceOptions(
  veniceParameters: boolean,
  cacheKey?: string,
): Pick<ChatRequest, "venice_parameters" | "prompt_cache_key"> {
  if (!veniceParameters) return {};
  return {
    venice_parameters: { include_venice_system_prompt: false },
    // Venice routes requests with the same key to the same prompt cache.
    ...(cacheKey !== undefined && { prompt_cache_key: cacheKey }),
  };
}
