import type { ModelCallDeps } from "../api/modelCall";
import { isVenice } from "../api/venice";
import type { AppState } from "../state";
import type { StreamChat } from "../types";

export function modelCallDeps(
  state: AppState,
  streamChat: StreamChat,
  modelId: string,
  signal: AbortSignal,
): ModelCallDeps {
  const { baseUrl, apiKey } = state.settings;
  return {
    api: { baseUrl, apiKey },
    streamChat,
    modelId,
    veniceParameters: isVenice(baseUrl),
    signal,
  };
}
