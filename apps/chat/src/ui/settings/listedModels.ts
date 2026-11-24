import { normaliseBaseUrl } from "../../api/venice";
import type { ApiSettings, ModelInfo } from "../../types";

// What servers listed while the dialog is open, by the URL and key asked, so a list read for one
// server is never offered for another.
export interface ListedModels {
  reset(): void;
  drop(api: ApiSettings): void;
  keep(api: ApiSettings, models: readonly ModelInfo[]): void;
  of(api: ApiSettings): readonly ModelInfo[] | undefined;
}

function keyOf({ baseUrl, apiKey }: ApiSettings): string {
  return JSON.stringify([normaliseBaseUrl(baseUrl), apiKey.trim()]);
}

export function createListedModels(): ListedModels {
  const lists = new Map<string, readonly ModelInfo[]>();
  return {
    reset: () => lists.clear(),
    drop: (api) => lists.delete(keyOf(api)),
    keep: (api, models) => lists.set(keyOf(api), models),
    of: (api) => lists.get(keyOf(api)),
  };
}
