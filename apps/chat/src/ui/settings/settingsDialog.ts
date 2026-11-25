import { listModels } from "../../api/client";
import { isVenice } from "../../api/venice";
import { sameApi } from "../../app/modelList";
import { effectiveDefaultModelId, offeredModels } from "../../chat/models";
import type { AppElements } from "../../dom";
import {
  DEFAULT_BACKGROUND_SOUND_LABELS,
  DEFAULT_SOUND_LABELS,
  saveSettings,
  withKey,
  type GlobalSettings,
} from "../../settings";
import { setSettings, type AppState } from "../../state";
import { errorText, plural } from "../../text";
import type { ApiSettings, ModelInfo } from "../../types";
import { createModelPicker } from "../modelPicker/modelPicker";
import {
  DEFAULT_TEXT_ONLY_NOTE,
  storedPickerSettings,
  type PickerSettings,
} from "../modelPicker/pickerModel";
import { askModelOnce } from "./askModelOnce";
import { createListedModels, type ListedModels } from "./listedModels";
import { initLookingSettings, type LookingSettings } from "./lookingSettings";
import { keyFollower, type KeyFollower, type SavedKeys } from "./serverKeys";

export interface SettingsDialog {
  open(): void;
  // Whether the form names a looking model for new chats, saved or not.
  looking(): boolean;
  // Shows what a server listed, here at once and everywhere if it is a saved one.
  listed(api: ApiSettings, models: readonly ModelInfo[]): void;
}

export interface SettingsDialogDeps {
  loadModels(settings: GlobalSettings): Promise<readonly ModelInfo[]>;
  onSaved(previous: GlobalSettings): void;
  onOpen?: () => void;
  storage?: Storage;
  // A list read in the dialog, of the server asked with the key asked with.
  onListed?: (api: ApiSettings, models: readonly ModelInfo[]) => void;
  askOnce?: (api: ApiSettings, modelId: string) => Promise<void>;
  listModels?: (api: ApiSettings, fallbackMaxImages: number) => Promise<readonly ModelInfo[]>;
}

const GIB = 1024 ** 3;

function readAskAbove(raw: string, fallback: number): number {
  const gib = Number(raw);
  return Number.isFinite(gib) && gib > 0 ? Math.round(gib * GIB) : fallback;
}

function readLabels(raw: string, fallback: readonly string[]): string[] {
  const labels = [...new Set(raw.split("\n").map((label) => label.trim()))].filter(
    (label) => label !== "",
  );
  return labels.length > 0 ? labels : [...fallback];
}

function fillLabels(
  dlg: AppElements["settingsDialog"],
  sounds: readonly string[],
  background: readonly string[],
): void {
  dlg.soundLabelsInput.value = sounds.join("\n");
  dlg.backgroundSoundLabelsInput.value = background.join("\n");
}

function typedApi({ baseUrlInput, apiKeyInput }: AppElements["settingsDialog"]): ApiSettings {
  return { baseUrl: baseUrlInput.value.trim(), apiKey: apiKeyInput.value.trim() };
}

function modelCountText(form: Form): string {
  const { dlg, state, looking } = form;
  const shown = form.models();
  if (shown === state.models && state.modelsError !== null) return state.modelsError;
  if (shown.length === 0) return "";
  const textToo = looking.modelId() !== "";
  const count = offeredModels(shown, dlg.privateOnlyInput.checked, textToo).length;
  const known = isVenice(dlg.baseUrlInput.value) && !textToo;
  return plural(count, known ? "vision model" : "model");
}

// The checkbox is the form's copy of the setting, saved with the rest on Save.
function formPickerSettings(
  dlg: AppElements["settingsDialog"],
  stored: PickerSettings,
  onPrivateOnly: () => void,
): PickerSettings {
  return {
    ...stored,
    privateOnly: () => dlg.privateOnlyInput.checked,
    setPrivateOnly: (privateOnly) => {
      dlg.privateOnlyInput.checked = privateOnly;
      onPrivateOnly();
    },
  };
}

interface DefaultModelChoice {
  id(): string;
  fill(preferred: string): void;
  refill(): void;
  close(): void;
}

function initDefaultModelChoice(
  els: Pick<AppElements, "settingsDialog" | "templates">,
  state: AppState,
  settings: PickerSettings,
  models: () => readonly ModelInfo[],
  looking: () => boolean,
): DefaultModelChoice {
  const dlg = els.settingsDialog;
  // What the user wants, kept apart from what the list as it is now leaves to show.
  let preferred = state.settings.defaultModelId;
  let shown = preferred;
  const picker = createModelPicker(
    { mount: dlg.defaultModelPicker, ...els.templates },
    {
      models,
      current: () => shown,
      onPick: (id) => {
        preferred = id;
        shown = id;
      },
      settings,
      textOnly: { offered: looking, note: DEFAULT_TEXT_ONLY_NOTE },
    },
  );
  const refill = () => {
    const privateOnly = dlg.privateOnlyInput.checked;
    const offered = offeredModels(models(), privateOnly, looking());
    const wanted = offered.some((model) => model.id === preferred) ? preferred : shown;
    shown = effectiveDefaultModelId(models(), privateOnly, wanted, looking());
    picker.render();
  };
  const fill = (id: string) => {
    preferred = id;
    shown = id;
    refill();
  };
  return { id: () => shown, fill, refill, close: () => picker.close() };
}

function renderPrivacyOption(dlg: AppElements["settingsDialog"], looking: LookingSettings): void {
  const option = dlg.privateOnlyInput.closest("label");
  if (option) option.hidden = !isVenice(dlg.baseUrlInput.value) && !looking.usesVenice();
}

function listenToBaseUrl(
  dlg: AppElements["settingsDialog"],
  follower: KeyFollower,
  onChanged: () => void,
): void {
  dlg.baseUrlInput.addEventListener("input", onChanged);
  dlg.baseUrlInput.addEventListener("change", () => follower.follow());
  dlg.form.addEventListener("click", (event) => {
    const fill = event.target instanceof Element ? event.target.closest("[data-base-url]") : null;
    if (!(fill instanceof HTMLElement)) return;
    dlg.baseUrlInput.value = fill.dataset["baseUrl"] ?? "";
    follower.follow();
    onChanged();
    dlg.apiKeyInput.focus();
  });
}

interface Form {
  dlg: AppElements["settingsDialog"];
  state: AppState;
  keys: SavedKeys;
  follower: KeyFollower;
  defaultModel: DefaultModelChoice;
  looking: LookingSettings;
  listed: ListedModels;
  // What the fields' server listed in the dialog, or else the app's own list.
  models(): readonly ModelInfo[];
  read(): GlobalSettings;
  list(api: ApiSettings): Promise<readonly ModelInfo[]>;
  // Its image limits are as typed, so it is the app's as well only while those are as saved.
  take(api: ApiSettings, models: readonly ModelInfo[]): void;
  limitSaved(): boolean;
}

function initForm(
  els: Pick<AppElements, "settingsDialog" | "lookingSettings" | "templates">,
  state: AppState,
  deps: SettingsDialogDeps,
): Form {
  const dlg = els.settingsDialog;
  const keys: SavedKeys = { current: {} };
  const follower = keyFollower(keys, { url: dlg.baseUrlInput, key: dlg.apiKeyInput });
  const refill = () => {
    defaultModel.refill();
    looking.render();
  };
  const stored = storedPickerSettings(state, deps.storage);
  const settings = formPickerSettings(dlg, stored, refill);
  const listed = createListedModels();
  const models = () => listed.of(typedApi(dlg)) ?? state.models;
  const defaultModel = initDefaultModelChoice(
    els,
    state,
    settings,
    models,
    () => looking.modelId() !== "",
  );
  const read = () => looking.apply(readForm(dlg, state.settings, defaultModel.id(), keys.current));
  const list = (api: ApiSettings) => listFor(deps, api, read().fallbackMaxImages);
  const limitSaved = () => read().fallbackMaxImages === state.settings.fallbackMaxImages;
  const take = (api: ApiSettings, found: readonly ModelInfo[]) => {
    listed.keep(api, found);
    if (limitSaved()) deps.onListed?.(api, found);
    refill();
  };
  const askOnce = deps.askOnce ?? askModelOnce;
  const looking = initLookingSettings(els, state, {
    ...{ keys, listed, chatModels: models, listModels: list, onListed: take, askOnce },
    pickerSettings: settings,
    formSettings: read,
    onChanged: () => {
      renderPrivacyOption(dlg, looking);
      defaultModel.refill();
    },
  });
  dlg.privateOnlyInput.addEventListener("change", refill);
  listenToBaseUrl(dlg, follower, () => {
    renderPrivacyOption(dlg, looking);
    looking.chatServerChanged();
  });
  return {
    ...{ dlg, state, keys, follower, defaultModel, looking, listed },
    ...{ models, read, list, take, limitSaved },
  };
}

function listFor(
  { listModels: list }: SettingsDialogDeps,
  api: ApiSettings,
  fallbackMaxImages: number,
): Promise<readonly ModelInfo[]> {
  return list ? list(api, fallbackMaxImages) : listModels(api, { fallbackMaxImages });
}

function fillForm(form: Form): void {
  const { dlg, state, keys, follower, defaultModel, looking } = form;
  const { settings } = state;
  form.listed.reset();
  keys.current = { ...settings.apiKeys };
  follower.show(settings.baseUrl, settings.apiKey);
  dlg.privateOnlyInput.checked = settings.privateOnly;
  dlg.showThinkingInput.checked = settings.showThinking;
  dlg.keepCopiesInput.checked = settings.keepVideoCopies;
  dlg.askAboveInput.value = String(Math.round((settings.askAboveBytes / GIB) * 10) / 10);
  dlg.fallbackMaxImagesInput.value = String(settings.fallbackMaxImages);
  fillLabels(dlg, settings.soundLabels, settings.backgroundSoundLabels);
  looking.open(settings);
  renderPrivacyOption(dlg, looking);
  defaultModel.fill(settings.defaultModelId);
  dlg.modelsStatus.textContent = modelCountText(form);
}

// The app's own list is loaded again only for the server it is of; another shows here alone.
async function refreshModels(form: Form, deps: SettingsDialogDeps): Promise<void> {
  const { dlg, state } = form;
  const api = typedApi(dlg);
  const stillTyped = () => sameApi(api, typedApi(dlg));
  dlg.modelsStatus.textContent = "Loading models…";
  try {
    if (sameApi(api, state.settings) && form.limitSaved()) {
      await deps.loadModels(form.read());
      form.listed.drop(api);
    } else {
      form.take(api, await form.list(api));
    }
    if (!stillTyped()) return;
    form.defaultModel.refill();
    form.looking.render();
    dlg.modelsStatus.textContent = modelCountText(form);
  } catch (error) {
    if (stillTyped()) dlg.modelsStatus.textContent = errorText(error);
  }
}

export function initSettingsDialog(
  els: Pick<AppElements, "settingsDialog" | "lookingSettings" | "templates">,
  state: AppState,
  deps: SettingsDialogDeps,
): SettingsDialog {
  const dlg = els.settingsDialog;
  const form = initForm(els, state, deps);
  const { defaultModel, looking } = form;
  dlg.refreshModelsButton.addEventListener("click", () => {
    void refreshModels(form, deps);
  });
  dlg.resetSoundLabelsButton.addEventListener("click", () =>
    fillLabels(dlg, DEFAULT_SOUND_LABELS, DEFAULT_BACKGROUND_SOUND_LABELS),
  );
  dlg.dialog.addEventListener("close", () => {
    defaultModel.close();
    looking.close();
    if (dlg.dialog.returnValue !== "save") return;
    const previous = state.settings;
    const settings = form.read();
    saveSettings(settings, deps.storage);
    setSettings(state, settings);
    deps.onSaved(previous);
  });
  return {
    open: () => {
      fillForm(form);
      deps.onOpen?.();
      dlg.dialog.returnValue = "";
      dlg.dialog.showModal();
    },
    looking: () => looking.modelId() !== "",
    listed: (api, models) => {
      form.listed.keep(api, models);
      // The connection test reads it with the saved image limit.
      deps.onListed?.(api, models);
      defaultModel.refill();
      looking.render();
      dlg.modelsStatus.textContent = modelCountText(form);
    },
  };
}

function readForm(
  dlg: AppElements["settingsDialog"],
  previous: GlobalSettings,
  defaultModelId: string,
  keys: Readonly<Record<string, string>>,
): GlobalSettings {
  const fallbackMaxImages = Number(dlg.fallbackMaxImagesInput.value);
  const apiKey = dlg.apiKeyInput.value.trim();
  const baseUrl = dlg.baseUrlInput.value.trim();
  return {
    favouriteModels: previous.favouriteModels,
    apiKey,
    baseUrl,
    apiKeys: withKey(keys, baseUrl, apiKey),
    privateOnly: dlg.privateOnlyInput.checked,
    showThinking: dlg.showThinkingInput.checked,
    keepVideoCopies: dlg.keepCopiesInput.checked,
    askAboveBytes: readAskAbove(dlg.askAboveInput.value, previous.askAboveBytes),
    defaultModelId: defaultModelId || previous.defaultModelId,
    defaultLookingModelId: previous.defaultLookingModelId,
    defaultLookingBaseUrl: previous.defaultLookingBaseUrl,
    lookingBaseUrl: previous.lookingBaseUrl,
    fallbackMaxImages:
      Number.isInteger(fallbackMaxImages) && fallbackMaxImages > 0
        ? fallbackMaxImages
        : previous.fallbackMaxImages,
    soundLabels: readLabels(dlg.soundLabelsInput.value, previous.soundLabels),
    backgroundSoundLabels: readLabels(
      dlg.backgroundSoundLabelsInput.value,
      previous.backgroundSoundLabels,
    ),
  };
}
