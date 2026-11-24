import { withLooking } from "../chat/chats";
import { defaultModelId, resolveModel } from "../chat/models";
import { lookingModelId } from "../chat/seen";
import type { AppState } from "../state";
import type { Chat, ChatSettings } from "../types";

type Defaults = Pick<AppState, "settings" | "models">;

function followedLooking({ settings }: Defaults, chat: ChatSettings): ChatSettings {
  const { defaultLookingModelId, defaultLookingBaseUrl } = settings;
  const next = { ...chat };
  delete next.lookingModelId;
  delete next.lookingBaseUrl;
  return { ...next, ...withLooking(defaultLookingModelId, defaultLookingBaseUrl) };
}

function sameLooking(a: ChatSettings, b: ChatSettings): boolean {
  return a.lookingModelId === b.lookingModelId && a.lookingBaseUrl === b.lookingBaseUrl;
}

// The same chat when it already has what a new one would get. A looking model the user chose for it,
// or chose against, stays.
export function withNewChatDefaults(state: Defaults, chat: Chat, empty: boolean): Chat {
  const follows = empty && chat.settings.lookingPicked !== true;
  const followed = follows ? followedLooking(state, chat.settings) : chat.settings;
  const settings = sameLooking(followed, chat.settings) ? chat.settings : followed;
  const looking = lookingModelId({ settings }) !== undefined;
  const { modelId } = settings;
  const unusable = empty && !looking && modelId !== "" && !resolveModel(state, modelId).vision;
  const wanted = modelId === "" || unusable ? modelFor(state, looking) : "";
  if (wanted !== "" && wanted !== modelId) {
    return { ...chat, settings: { ...settings, modelId: wanted } };
  }
  return settings === chat.settings ? chat : { ...chat, settings };
}

function modelFor(state: Defaults, looking: boolean): string {
  return state.models.length === 0 ? "" : defaultModelId(state, looking);
}
