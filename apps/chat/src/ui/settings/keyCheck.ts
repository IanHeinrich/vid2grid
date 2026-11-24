import type { ApiSettings, ModelInfo } from "../../types";

export const KEY_NOT_CHECKED = "The server answered; the key was not checked.";

// A server that lists its models to anyone says nothing of the key it was sent.
export async function listingChecksKey(
  api: ApiSettings,
  listModels: (api: ApiSettings) => Promise<readonly ModelInfo[]>,
): Promise<boolean> {
  if (api.apiKey === "") return true;
  try {
    await listModels({ ...api, apiKey: "" });
    return false;
  } catch {
    return true;
  }
}
