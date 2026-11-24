import type { listModels } from "../api/client";
import { isVenice, normaliseBaseUrl } from "../api/venice";
import { latestCalls } from "../latest";
import type { GlobalSettings } from "../settings";
import {
  isRunningIn,
  setLookingModels,
  setModels,
  setModelsError,
  updateChat,
  type AppState,
} from "../state";
import { errorText } from "../text";
import type { ApiSettings, ChatStore, ModelInfo } from "../types";
import type { StatusLine } from "../ui/shared/status";
import { withNewChatDefaults } from "./chatDefaults";
import { lookingApi, lookingHasOwnServer } from "./lookingConnection";

export interface ModelList {
  load(settings: GlobalSettings): Promise<readonly ModelInfo[]>;
  // Takes a list just read, in place of any load still on its way, if it is of a saved server.
  accept(api: ApiSettings, models: readonly ModelInfo[]): void;
  loadInBackground(): void;
  // The second list, for a looking model with its own server.
  loadLookingInBackground(): void;
  onSettingsSaved(previous: GlobalSettings): void;
}

export interface FillChatModelDeps {
  state: AppState;
  store: ChatStore;
  status: Pick<StatusLine, "show">;
  refresh(): void;
}

export interface ModelListDeps extends FillChatModelDeps {
  listModels: typeof listModels;
  refreshBalance(): void;
}

export function shouldLoadModels(settings: ApiSettings): boolean {
  return settings.baseUrl.trim() !== "" && (settings.apiKey !== "" || !isVenice(settings.baseUrl));
}

export function createModelList(deps: ModelListDeps): ModelList {
  const startLoad = latestCalls();
  const load = (settings: GlobalSettings) => loadModels(deps, startLoad, settings);
  const loadInBackground = () => {
    load(deps.state.settings).catch((error: unknown) => {
      deps.status.show(`Could not load models: ${errorText(error)}`, "error");
    });
  };
  const startLookingLoad = latestCalls();
  const loadLookingInBackground = () => {
    loadLookingModels(deps, startLookingLoad).catch((error: unknown) => {
      deps.status.show(`Could not load the looking model's list: ${errorText(error)}`, "error");
    });
  };
  return {
    load,
    accept: (api, models) => accept(deps, { startLoad, startLookingLoad }, api, models),
    loadInBackground,
    loadLookingInBackground,
    onSettingsSaved: (previous) => {
      if (lookingChanged(previous, deps.state.settings)) loadLookingInBackground();
      onSettingsSaved(deps, loadInBackground, previous);
    },
  };
}

export function sameApi(a: ApiSettings, b: ApiSettings): boolean {
  const sameServer = normaliseBaseUrl(a.baseUrl) === normaliseBaseUrl(b.baseUrl);
  return sameServer && a.apiKey.trim() === b.apiKey.trim();
}

interface ListLoads {
  startLoad: ReturnType<typeof latestCalls>;
  startLookingLoad: ReturnType<typeof latestCalls>;
}

function accept(
  deps: ModelListDeps,
  { startLoad, startLookingLoad }: ListLoads,
  api: ApiSettings,
  models: readonly ModelInfo[],
): void {
  const { state } = deps;
  const ofChat = sameApi(api, state.settings);
  const ofLooking = lookingHasOwnServer(state.settings) && sameApi(api, lookingApi(state.settings));
  if (ofChat) {
    startLoad();
    setModels(state, models);
    fillChatModel(deps);
  }
  if (ofLooking) {
    startLookingLoad();
    setLookingModels(state, models);
  }
  if (ofChat || ofLooking) deps.refresh();
}

// A newer load owns the model list, so an older one that settles late changes nothing.
async function loadModels(
  deps: ModelListDeps,
  startLoad: ReturnType<typeof latestCalls>,
  settings: GlobalSettings,
): Promise<readonly ModelInfo[]> {
  const isLatest = startLoad();
  try {
    const models = await deps.listModels(settings, {
      fallbackMaxImages: settings.fallbackMaxImages,
    });
    if (!isLatest()) return deps.state.models;
    setModels(deps.state, models);
    fillChatModel(deps);
    return models;
  } catch (error) {
    if (!isLatest()) return deps.state.models;
    setModelsError(deps.state, errorText(error));
    throw error;
  } finally {
    deps.refresh();
  }
}

async function loadLookingModels(
  deps: ModelListDeps,
  startLoad: ReturnType<typeof latestCalls>,
): Promise<void> {
  const isLatest = startLoad();
  const { settings } = deps.state;
  const api = lookingApi(settings);
  setLookingModels(deps.state, []);
  if (!lookingHasOwnServer(settings) || !shouldLoadModels(api)) return;
  const { fallbackMaxImages } = settings;
  try {
    const models = await deps.listModels(api, { fallbackMaxImages });
    if (!isLatest()) return;
    setLookingModels(deps.state, models);
    deps.refresh();
  } catch (error) {
    if (isLatest()) throw error;
  }
}

function lookingChanged(previous: GlobalSettings, settings: GlobalSettings): boolean {
  const [before, after] = [lookingApi(previous), lookingApi(settings)];
  return (
    lookingHasOwnServer(previous) !== lookingHasOwnServer(settings) ||
    (lookingHasOwnServer(settings) &&
      (before.baseUrl !== after.baseUrl ||
        before.apiKey !== after.apiKey ||
        previous.fallbackMaxImages !== settings.fallbackMaxImages))
  );
}

// A chat made before the models loaded takes the default once there is one, so requests name a
// model. One with no messages follows the default looking model too.
export function fillChatModel(deps: FillChatModelDeps): void {
  const { state, store, status } = deps;
  const chat = state.currentChat;
  if (!chat) return;
  const empty = state.messages.length === 0 && !isRunningIn(state, chat.id);
  if (withNewChatDefaults(state, chat, empty) === chat) return;
  updateChat(state, store, chat.id, (latest) => withNewChatDefaults(state, latest, empty)).then(
    () => deps.refresh(),
    (error: unknown) =>
      status.show(`Could not save the chat's model: ${errorText(error)}`, "error"),
  );
}

function onSettingsSaved(
  deps: ModelListDeps,
  loadInBackground: () => void,
  previous: GlobalSettings,
): void {
  const { settings } = deps.state;
  const apiChanged =
    settings.apiKey !== previous.apiKey ||
    settings.baseUrl !== previous.baseUrl ||
    settings.fallbackMaxImages !== previous.fallbackMaxImages;
  // A changed server's own models come first, and fill it then.
  if (!apiChanged) fillChatModel(deps);
  if (apiChanged) deps.refreshBalance();
  if (settings.baseUrl === "") setModels(deps.state, []);
  if (apiChanged && shouldLoadModels(settings)) loadInBackground();
  else deps.refresh();
}
