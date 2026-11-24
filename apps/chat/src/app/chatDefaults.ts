import { withLooking } from "../chat/chats";
import { defaultModelId, resolveModel } from "../chat/models";
import { lookingModelId } from "../chat/seen";
import { replaceChat, type AppState } from "../state";
import type { Chat, ChatSettings, ChatStore } from "../types";
import { lookingProblem } from "./lookingConnection";

type Defaults = Pick<AppState, "settings" | "models" | "lookingModels">;

function followedLooking(state: Defaults, chat: Chat): ChatSettings {
  const { defaultLookingModelId, defaultLookingBaseUrl } = state.settings;
  // Its pictures would go to the writer's server without the user having chosen that.
  const gone = lookingProblem(state, chat) !== undefined;
  if (defaultLookingModelId === "" && gone) return chat.settings;
  const next = { ...chat.settings };
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
  const followed = follows ? followedLooking(state, chat) : chat.settings;
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

function sameSettings(a: ChatSettings, b: ChatSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Shown at once, then settled by the stored chat, which another tab may have changed, used or
// deleted. False when it is not there, or not empty, after all.
export async function followDefaults(
  state: AppState,
  store: Pick<ChatStore, "changeChat">,
  chat: Chat,
  empty: boolean,
): Promise<boolean> {
  const shown = withNewChatDefaults(state, chat, empty);
  if (shown !== chat) replaceChat(state, shown);
  let used = false;
  const saved = await store.changeChat(chat.id, (stored, hasMessages) => {
    used = hasMessages;
    return withNewChatDefaults(state, stored, empty && !hasMessages);
  });
  const { settings } = saved ?? chat;
  const latest = state.chats.find((entry) => entry.id === chat.id);
  // Left as it is when the user has changed it since.
  if (latest?.settings === shown.settings && !sameSettings(shown.settings, settings)) {
    replaceChat(state, { ...latest, settings });
  }
  return saved !== undefined && !(empty && used);
}

function modelFor(state: Defaults, looking: boolean): string {
  return state.models.length === 0 ? "" : defaultModelId(state, looking);
}
