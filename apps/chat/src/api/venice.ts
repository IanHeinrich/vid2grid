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
