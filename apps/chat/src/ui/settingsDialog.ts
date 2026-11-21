import { isVenice } from "../api/client";
import { DEEP_MAX_ROUNDS as MAX_ROUNDS_LIMIT } from "../chat/agentLoop";
import { applyPersonaNames, effectiveVideoReferences } from "../chat/history";
import {
  applyPersona,
  chatPersona,
  listPersonas,
  personaFromChat,
  personaMatches,
  restorePresetFields,
  savePersona,
  withName,
  withVideoReferences,
  type Persona,
} from "../chat/personas";
import type { AppElements } from "../dom";
import {
  DEFAULT_BACKGROUND_SOUND_LABELS,
  DEFAULT_SOUND_LABELS,
  keyFor,
  saveSettings,
  withKey,
  type GlobalSettings,
} from "../settings";
import {
  currentModel,
  effectiveDefaultModelId,
  resolveModel,
  setSettings,
  updateChat,
  visionModels,
  type AppState,
} from "../state";
import { errorText } from "../text";
import type {
  ChatSettings,
  ChatStore,
  EarlierImages,
  ModelInfo,
  VideoReferences,
  Voice,
} from "../types";
import { resolveSheetResolution } from "../video/resolution";
import { createModelPicker, storedPickerSettings, type ModelPicker } from "./modelPicker";
import { initPresetManager, VOICE_HINTS, type PresetManager } from "./presetManager";
import type { Toast } from "./toast";

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

export interface ChatSettingsPanel {
  render(): void;
  close(): void;
}

export interface ChatSettingsDeps {
  store: ChatStore;
  toast: Toast;
  onChanged(): void;
  onError(message: string): void;
  storage?: Storage;
}

interface ChatSettingsContext {
  els: Pick<AppElements, "header" | "chatSettings">;
  state: AppState;
  deps: ChatSettingsDeps;
  picker: ModelPicker;
  presets: PresetManager;
  renderedChatId: string | undefined;
  saving: Promise<void>;
}

const VOICES: readonly Voice[] = ["analyst", "character", "narrator"];

const VIDEO_REFERENCES: readonly VideoReferences[] = ["free", "few", "none"];

const EARLIER_IMAGES: readonly EarlierImages[] = ["describe", "send"];
const DEFAULT_EARLIER_IMAGES: EarlierImages = "describe";

export function initChatSettings(
  els: Pick<AppElements, "header" | "chatSettings" | "templates" | "presetManager">,
  state: AppState,
  deps: ChatSettingsDeps,
): ChatSettingsPanel {
  const ctx: ChatSettingsContext = {
    els,
    state,
    deps,
    picker: createModelPicker(
      { mount: els.chatSettings.modelPicker, ...els.templates },
      {
        models: () => state.models,
        current: () => currentModel(state)?.id,
        onPick: (id) => change(ctx, (settings) => withModel(ctx, settings, id)),
        settings: storedPickerSettings(state, deps.storage),
      },
    ),
    presets: initPresetManager(els, {
      toast: deps.toast,
      storage: deps.storage ?? localStorage,
      onApply: (persona) => applyWithUndo(ctx, persona, `Applied ${persona.name}`),
      onChanged: () => renderPresets(ctx),
    }),
    renderedChatId: undefined,
    saving: Promise.resolve(),
  };
  const panel = els.chatSettings;
  listenToPersona(ctx);
  listenToPresets(ctx);
  listenToNumbers(ctx);
  panel.reasoningEffortSelect.addEventListener("change", () => {
    const effort = panel.reasoningEffortSelect.value;
    change(ctx, (settings) => withEffort(settings, effort));
  });
  panel.earlierImagesSelect.addEventListener("change", () => {
    const earlierImages = EARLIER_IMAGES.find((known) => known === panel.earlierImagesSelect.value);
    if (earlierImages) change(ctx, (settings) => withEarlierImages(settings, earlierImages));
  });
  panel.sheetResolutionSelect.addEventListener("change", () => {
    const { value } = panel.sheetResolutionSelect;
    const sheetResolution = value === "auto" ? value : Number(value);
    change(ctx, (settings) => ({ ...settings, sheetResolution }));
  });
  render(ctx);
  return { render: () => render(ctx), close: () => ctx.picker.close() };
}

function listenToPersona(ctx: ChatSettingsContext): void {
  const panel = ctx.els.chatSettings;
  panel.systemPromptInput.addEventListener("change", () => {
    const systemPrompt = panel.systemPromptInput.value;
    change(ctx, (settings) => ({ ...settings, systemPrompt }));
  });
  for (const [input, key] of [
    [panel.characterNameInput, "characterName"],
    [panel.userNameInput, "userName"],
  ] as const) {
    input.addEventListener("change", () => {
      const name = input.value;
      change(ctx, (settings) => withName(settings, key, name));
    });
  }
  for (const input of [panel.systemPromptInput, panel.characterNameInput, panel.userNameInput]) {
    input.addEventListener("input", () => renderPreview(panel));
  }
  panel.voiceSelect.addEventListener("change", () => {
    const voice = VOICES.find((known) => known === panel.voiceSelect.value);
    if (voice === "character") panel.characterNames.open = true;
    if (voice) change(ctx, (settings) => ({ ...settings, voice }));
  });
  panel.videoReferencesSelect.addEventListener("change", () => {
    const references = readVideoReferences(panel);
    if (references) change(ctx, (settings) => withVideoReferences(settings, references));
  });
}

function readVideoReferences(panel: AppElements["chatSettings"]): VideoReferences | undefined {
  return VIDEO_REFERENCES.find((known) => known === panel.videoReferencesSelect.value);
}

// Changes save on blur, so a preset saved straight after typing reads the form, not the chat.
function formSettings(ctx: ChatSettingsContext, settings: ChatSettings): ChatSettings {
  const panel = ctx.els.chatSettings;
  const voice = VOICES.find((known) => known === panel.voiceSelect.value);
  const references = readVideoReferences(panel);
  const prompted = { ...settings, systemPrompt: panel.systemPromptInput.value };
  const withCharacter = withName(prompted, "characterName", panel.characterNameInput.value);
  const named = withName(withCharacter, "userName", panel.userNameInput.value);
  const voiced = voice ? { ...named, voice } : named;
  return references ? withVideoReferences(voiced, references) : voiced;
}

function listenToPresets(ctx: ChatSettingsContext): void {
  const panel = ctx.els.chatSettings;
  panel.personaSelect.addEventListener("change", () => pickPreset(ctx, panel.personaSelect.value));
  panel.savePersonaButton.addEventListener("click", () => saveAsPersona(ctx));
  panel.managePresetsButton.addEventListener("click", () =>
    ctx.presets.open({ presetId: shownPersona(ctx)?.id }),
  );
  panel.updatePresetButton.addEventListener("click", () => updatePersona(ctx));
  panel.revertPresetButton.addEventListener("click", () => {
    const persona = shownPersona(ctx);
    if (persona) applyWithUndo(ctx, persona, `Reverted to ${persona.name}`);
  });
}

function personaStorage(ctx: ChatSettingsContext): Storage {
  return ctx.deps.storage ?? localStorage;
}

function shownPersona(ctx: ChatSettingsContext): Persona | undefined {
  const chat = ctx.state.currentChat;
  return chat ? chatPersona(chat.settings, listPersonas(personaStorage(ctx))) : undefined;
}

function pickPreset(ctx: ChatSettingsContext, id: string): void {
  if (id === "") {
    change(ctx, (settings) => ({ ...settings, presetId: "" }));
    return;
  }
  const persona = listPersonas(personaStorage(ctx)).find((entry) => entry.id === id);
  if (persona) applyWithUndo(ctx, persona, `Applied ${persona.name}`);
}

function applyWithUndo(ctx: ChatSettingsContext, persona: Persona, message: string): void {
  const chat = ctx.state.currentChat;
  if (!chat) return;
  const before = chat.settings;
  change(ctx, (settings) => applyPersona(settings, persona));
  ctx.deps.toast.show(message, {
    label: "Undo",
    run: () => {
      if (ctx.state.currentChat?.id !== chat.id) return;
      change(ctx, (settings) => restorePresetFields(settings, before));
    },
  });
}

function saveAsPersona(ctx: ChatSettingsContext): void {
  const chat = ctx.state.currentChat;
  if (!chat) return;
  const persona = personaFromChat(formSettings(ctx, chat.settings));
  savePersona(persona, personaStorage(ctx));
  change(ctx, (settings) => applyPersona(settings, persona));
  ctx.presets.open({ presetId: persona.id, focusName: true });
}

function updatePersona(ctx: ChatSettingsContext): void {
  const chat = ctx.state.currentChat;
  const persona = shownPersona(ctx);
  if (!chat || !persona) return;
  savePersona(
    personaFromChat(formSettings(ctx, chat.settings), persona.name, persona.id),
    personaStorage(ctx),
  );
  renderPresets(ctx);
  ctx.deps.toast.show(`Updated preset ${persona.name}`);
}

export function parseMaxRounds(raw: string): number | undefined {
  const value = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_ROUNDS_LIMIT, Math.max(1, Math.round(value)));
}

function listenToNumbers(ctx: ChatSettingsContext): void {
  const panel = ctx.els.chatSettings;
  panel.temperatureInput.addEventListener("change", () => {
    const raw = panel.temperatureInput.value.trim();
    const value = Number(raw);
    change(ctx, (settings) => {
      const next = { ...settings };
      if (raw === "" || !Number.isFinite(value)) delete next.temperature;
      else next.temperature = value;
      return next;
    });
  });
  panel.maxRoundsInput.addEventListener("change", () => {
    const maxRounds = parseMaxRounds(panel.maxRoundsInput.value);
    change(ctx, (settings) => {
      const next = { ...settings };
      if (maxRounds === undefined) delete next.maxRounds;
      else next.maxRounds = maxRounds;
      return next;
    });
  });
}

function withEffort(settings: ChatSettings, effort: string): ChatSettings {
  const next = { ...settings };
  if (effort === "") delete next.reasoningEffort;
  else next.reasoningEffort = effort;
  return next;
}

function withEarlierImages(settings: ChatSettings, earlierImages: EarlierImages): ChatSettings {
  if (settings.earlierImages === undefined && earlierImages === DEFAULT_EARLIER_IMAGES) {
    return settings;
  }
  return { ...settings, earlierImages };
}

function withModel(
  ctx: ChatSettingsContext,
  settings: ChatSettings,
  modelId: string,
): ChatSettings {
  const model = resolveModel(ctx.state, modelId);
  const effort = settings.reasoningEffort ?? "";
  const keepsEffort = model.reasoningEffortOptions.includes(effort);
  return withEffort({ ...settings, modelId }, keepsEffort ? effort : "");
}

// Each change starts from the last one's saved chat, so quick edits to two fields both stick.
function change(ctx: ChatSettingsContext, next: (settings: ChatSettings) => ChatSettings): void {
  const chatId = ctx.state.currentChat?.id;
  if (chatId === undefined) return;
  ctx.saving = ctx.saving.then(() =>
    update(ctx, chatId, next).catch((error: unknown) => {
      ctx.deps.onError(`Could not save the chat settings: ${errorText(error)}`);
    }),
  );
}

async function update(
  ctx: ChatSettingsContext,
  chatId: string,
  change: (settings: ChatSettings) => ChatSettings,
): Promise<void> {
  const updated = await updateChat(ctx.state, ctx.deps.store, chatId, (chat) => ({
    ...chat,
    settings: change(chat.settings),
  }));
  if (!updated) return;
  render(ctx);
  ctx.deps.onChanged();
}

function render(ctx: ChatSettingsContext): void {
  renderHeader(ctx);
  const { chatSettings: panel } = ctx.els;
  const chat = ctx.state.currentChat;
  const model = currentModel(ctx.state);
  if (!chat) return;
  const { settings } = chat;
  const switched = chat.id !== ctx.renderedChatId;
  renderPersona(ctx, settings, switched);
  ctx.picker.render();
  const temperature = settings.temperature === undefined ? "" : String(settings.temperature);
  setUnlessFocused(panel.temperatureInput, temperature, switched);
  const maxRounds = settings.maxRounds === undefined ? "" : String(settings.maxRounds);
  setUnlessFocused(panel.maxRoundsInput, maxRounds, switched);
  const efforts = model?.reasoningEffortOptions ?? [];
  panel.reasoningEffortField.hidden = efforts.length === 0;
  panel.reasoningEffortSelect.replaceChildren(
    new Option("Model default", ""),
    ...efforts.map((effort) => new Option(effort, effort)),
  );
  panel.reasoningEffortSelect.value = settings.reasoningEffort ?? "";
  panel.earlierImagesSelect.value = settings.earlierImages ?? DEFAULT_EARLIER_IMAGES;
  renderSheetResolution(panel, settings, resolveModel(ctx.state, settings.modelId));
}

// A focused field keeps what is being typed, unless that was typed for the chat before a switch.
function setUnlessFocused(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  switched: boolean,
): void {
  if (switched || document.activeElement !== input) input.value = value;
}

function renderPersona(ctx: ChatSettingsContext, settings: ChatSettings, switched: boolean): void {
  const panel = ctx.els.chatSettings;
  setUnlessFocused(panel.systemPromptInput, settings.systemPrompt, switched);
  setUnlessFocused(panel.characterNameInput, settings.characterName ?? "", switched);
  setUnlessFocused(panel.userNameInput, settings.userName ?? "", switched);
  const voice = settings.voice ?? "analyst";
  panel.voiceSelect.value = voice;
  panel.voiceHint.textContent = VOICE_HINTS[voice];
  panel.videoReferencesSelect.value = effectiveVideoReferences(settings);
  renderCharacterNames(ctx, settings);
  renderPreview(panel);
  renderPresets(ctx);
}

// Set only when the chat changes, so saving another field never folds it under the user.
function renderCharacterNames(ctx: ChatSettingsContext, settings: ChatSettings): void {
  const chatId = ctx.state.currentChat?.id;
  if (chatId === ctx.renderedChatId) return;
  ctx.renderedChatId = chatId;
  ctx.els.chatSettings.characterNames.open =
    settings.characterName !== undefined ||
    settings.userName !== undefined ||
    settings.voice === "character";
}

function renderPreview(panel: AppElements["chatSettings"]): void {
  const prompt = panel.systemPromptInput.value;
  panel.promptPreview.textContent =
    prompt.trim() === ""
      ? "No system prompt yet."
      : applyPersonaNames(prompt, {
          characterName: panel.characterNameInput.value,
          userName: panel.userNameInput.value,
        });
}

function renderPresets(ctx: ChatSettingsContext): void {
  const panel = ctx.els.chatSettings;
  const personas = listPersonas(personaStorage(ctx));
  const settings = ctx.state.currentChat?.settings;
  const shown = settings && chatPersona(settings, personas);
  const none = personas.length === 0 ? "No saved presets yet" : "No preset";
  panel.personaSelect.replaceChildren(
    new Option(none, ""),
    ...personas.map((persona) => new Option(persona.name, persona.id)),
  );
  panel.personaSelect.value = shown?.id ?? "";
  panel.personaSelect.disabled = personas.length === 0;
  panel.presetEdited.hidden = !shown || !settings || personaMatches(shown, settings);
}

function renderSheetResolution(
  panel: AppElements["chatSettings"],
  settings: ChatSettings,
  model: ModelInfo,
): void {
  const auto = resolveSheetResolution("auto", model);
  panel.sheetResolutionAuto.textContent = `Auto (${auto.px} px)`;
  panel.sheetResolutionAuto.title = auto.reason;
  panel.sheetResolutionSelect.value = String(settings.sheetResolution);
  panel.sheetResolutionHint.textContent = auto.reason;
  panel.sheetResolutionHint.hidden = settings.sheetResolution !== "auto";
}

function renderHeader(ctx: ChatSettingsContext): void {
  const { header } = ctx.els;
  const model = currentModel(ctx.state);
  header.title.textContent = ctx.state.currentChat?.title ?? "vid2grid chat";
  header.modelName.textContent = model?.name ?? "";
  const privacy = model?.privacy ?? "unknown";
  header.modelBadge.hidden = privacy === "unknown";
  header.modelBadge.textContent = privacy;
  header.modelBadge.className = `badge badge-${privacy}`;
}
