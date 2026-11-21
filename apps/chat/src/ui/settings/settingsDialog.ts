import { isVenice } from "../../api/venice";
import { effectiveDefaultModelId, visionModels } from "../../chat/models";
import type { AppElements } from "../../dom";
import {
  DEFAULT_BACKGROUND_SOUND_LABELS,
  DEFAULT_SOUND_LABELS,
  keyFor,
  saveSettings,
  withKey,
  type GlobalSettings,
} from "../../settings";
import { setSettings, type AppState } from "../../state";
import { errorText } from "../../text";
import type { ModelInfo } from "../../types";
import { createModelPicker } from "../modelPicker/modelPicker";
import { storedPickerSettings } from "../modelPicker/pickerModel";

export interface SettingsDialog {
  open(): void;
}

export interface SettingsDialogDeps {
  loadModels(settings: GlobalSettings): Promise<readonly ModelInfo[]>;
  onSaved(previous: GlobalSettings): void;
  onOpen?: () => void;
  storage?: Storage;
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

function visionCountText(state: AppState, privateOnly: boolean): string {
  if (state.modelsError !== null) return state.modelsError;
  if (state.models.length === 0) return "";
  const count = visionModels(state.models, privateOnly).length;
  return `${count} vision model${count === 1 ? "" : "s"}`;
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
  storage: Storage | undefined,
): DefaultModelChoice {
  const dlg = els.settingsDialog;
  let chosenModelId = state.settings.defaultModelId;
  const picker = createModelPicker(
    { mount: dlg.defaultModelPicker, ...els.templates },
    {
      models: () => state.models,
      current: () => chosenModelId,
      onPick: (id) => {
        chosenModelId = id;
      },
      // The checkbox is the form's copy of the setting, saved with the rest on Save.
      settings: {
        ...storedPickerSettings(state, storage),
        privateOnly: () => dlg.privateOnlyInput.checked,
        setPrivateOnly: (privateOnly) => {
          dlg.privateOnlyInput.checked = privateOnly;
          refill();
        },
      },
    },
  );
  const fill = (preferred: string) => {
    const privateOnly = dlg.privateOnlyInput.checked;
    chosenModelId = effectiveDefaultModelId(state.models, privateOnly, preferred);
    picker.render();
  };
  const refill = () => fill(chosenModelId || state.settings.defaultModelId);
  dlg.privateOnlyInput.addEventListener("change", refill);
  return { id: () => chosenModelId, fill, refill, close: () => picker.close() };
}

function renderPrivacyOption(dlg: AppElements["settingsDialog"]): void {
  const option = dlg.privateOnlyInput.closest("label");
  if (option) option.hidden = !isVenice(dlg.baseUrlInput.value);
}

// The key field always holds the key for the base URL shown, so a key is never tested against another host.
interface KeyMemory {
  reset(settings: GlobalSettings): void;
  follow(): void;
  keys(): Record<string, string>;
}

function initKeyMemory(dlg: AppElements["settingsDialog"]): KeyMemory {
  let keys: Record<string, string> = {};
  let keyUrl = "";
  return {
    reset: (settings) => {
      keys = { ...settings.apiKeys };
      keyUrl = settings.baseUrl;
    },
    follow: () => {
      keys = withKey(keys, keyUrl, dlg.apiKeyInput.value.trim());
      keyUrl = dlg.baseUrlInput.value;
      dlg.apiKeyInput.value = keyFor(keys, keyUrl);
    },
    keys: () => keys,
  };
}

function listenToBaseUrl(dlg: AppElements["settingsDialog"], memory: KeyMemory): void {
  dlg.baseUrlInput.addEventListener("input", () => renderPrivacyOption(dlg));
  dlg.baseUrlInput.addEventListener("change", () => memory.follow());
  dlg.form.addEventListener("click", (event) => {
    const fill = event.target instanceof Element ? event.target.closest("[data-base-url]") : null;
    if (!(fill instanceof HTMLElement)) return;
    dlg.baseUrlInput.value = fill.dataset["baseUrl"] ?? "";
    memory.follow();
    renderPrivacyOption(dlg);
    dlg.apiKeyInput.focus();
  });
}

export function initSettingsDialog(
  els: Pick<AppElements, "settingsDialog" | "templates">,
  state: AppState,
  deps: SettingsDialogDeps,
): SettingsDialog {
  const dlg = els.settingsDialog;
  const defaultModel = initDefaultModelChoice(els, state, deps.storage);
  const memory = initKeyMemory(dlg);
  listenToBaseUrl(dlg, memory);
  dlg.refreshModelsButton.addEventListener("click", () => {
    dlg.modelsStatus.textContent = "Loading models…";
    deps.loadModels(readForm(dlg, state.settings, defaultModel.id(), memory.keys())).then(
      () => {
        defaultModel.refill();
        dlg.modelsStatus.textContent = visionCountText(state, dlg.privateOnlyInput.checked);
      },
      (error: unknown) => {
        dlg.modelsStatus.textContent = errorText(error);
      },
    );
  });
  dlg.resetSoundLabelsButton.addEventListener("click", () =>
    fillLabels(dlg, DEFAULT_SOUND_LABELS, DEFAULT_BACKGROUND_SOUND_LABELS),
  );
  dlg.dialog.addEventListener("close", () => {
    defaultModel.close();
    if (dlg.dialog.returnValue !== "save") return;
    const previous = state.settings;
    const settings = readForm(dlg, previous, defaultModel.id(), memory.keys());
    saveSettings(settings, deps.storage);
    setSettings(state, settings);
    deps.onSaved(previous);
  });
  return {
    open: () => {
      const { settings } = state;
      memory.reset(settings);
      dlg.apiKeyInput.value = settings.apiKey;
      dlg.baseUrlInput.value = settings.baseUrl;
      dlg.privateOnlyInput.checked = settings.privateOnly;
      renderPrivacyOption(dlg);
      dlg.showThinkingInput.checked = settings.showThinking;
      dlg.keepCopiesInput.checked = settings.keepVideoCopies;
      dlg.askAboveInput.value = String(Math.round((settings.askAboveBytes / GIB) * 10) / 10);
      deps.onOpen?.();
      dlg.fallbackMaxImagesInput.value = String(settings.fallbackMaxImages);
      fillLabels(dlg, settings.soundLabels, settings.backgroundSoundLabels);
      defaultModel.fill(settings.defaultModelId);
      dlg.modelsStatus.textContent = visionCountText(state, settings.privateOnly);
      dlg.dialog.returnValue = "";
      dlg.dialog.showModal();
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
