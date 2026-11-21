import { isVenice } from "../api/venice";
import { currentModel } from "../chat/models";
import type { AppState } from "../state";

export function sendBlocker(state: AppState): string | null {
  if (state.currentChat === null) return "Start a new chat from the sidebar.";
  const { baseUrl, apiKey } = state.settings;
  if (baseUrl.trim() === "") return "Choose an API in Settings to start chatting.";
  if (isVenice(baseUrl) && apiKey.trim() === "") {
    return "Add your API key in Settings to start chatting.";
  }
  if (currentModel(state) === null) return "Choose a model in Chat settings.";
  return null;
}
