import type { listModels } from "../api/client";
import { isVenice } from "../api/venice";
import { defaultModelId } from "../chat/models";
import { latestCalls } from "../latest";
import type { GlobalSettings } from "../settings";
import { setModels, setModelsError, updateChat, type AppState } from "../state";
import { errorText } from "../text";
import type { ChatStore, ModelInfo } from "../types";
import type { StatusLine } from "../ui/shared/status";

export interface ModelList {
  load(settings: GlobalSettings): Promise<readonly ModelInfo[]>;
  loadInBackground(): void;
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

export function shouldLoadModels(settings: GlobalSettings): boolean {
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
  return {
    load,
    loadInBackground,
    onSettingsSaved: (previous) => onSettingsSaved(deps, loadInBackground, previous),
  };
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

// A chat made before the models loaded takes the default once there is one, so requests name a model.
export function fillChatModel(deps: FillChatModelDeps): void {
  const { state, store, status } = deps;
  const chat = state.currentChat;
  if (!chat || chat.settings.modelId !== "" || state.models.length === 0) return;
  const modelId = defaultModelId(state);
  if (modelId === "") return;
  updateChat(state, store, chat.id, (latest) => ({
    ...latest,
    settings: { ...latest.settings, modelId: latest.settings.modelId || modelId },
  })).then(
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
  if (apiChanged) deps.refreshBalance();
  if (settings.baseUrl === "") setModels(deps.state, []);
  if (apiChanged && shouldLoadModels(settings)) loadInBackground();
  else deps.refresh();
}
