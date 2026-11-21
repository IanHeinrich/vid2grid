import { DEEP_MAX_ROUNDS as MAX_ROUNDS_LIMIT } from "../chat/agentLoop";
import { currentModel, resolveModel } from "../chat/models";
import { applyPersonaNames } from "../chat/prompts";
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
import { withEffort } from "../chat/thoroughness";
import type { AppElements } from "../dom";
import { updateChat, type AppState } from "../state";
import { errorText } from "../text";
import type { ChatSettings, ChatStore, EarlierImages, ModelInfo } from "../types";
import { resolveSheetResolution } from "../video/resolution";
import { createModelPicker, type ModelPicker } from "./modelPicker";
import {
  listenToPersonaFields,
  readVideoReferences,
  readVoice,
  renderPersonaFields,
  setUnlessFocused,
} from "./personaFields";
import { storedPickerSettings } from "./pickerModel";
import { initPresetManager, type PresetManager } from "./presetManager";
import type { Toast } from "./toast";

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
  effortOptionsKey: string;
  presetOptionsKey: string;
  saving: Promise<void>;
}

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
    effortOptionsKey: "",
    presetOptionsKey: "",
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
  listenToPersonaFields(panel, (edit) => change(ctx, edit));
  for (const input of [panel.systemPromptInput, panel.characterNameInput, panel.userNameInput]) {
    input.addEventListener("input", () => renderPreview(panel));
  }
  panel.voiceSelect.addEventListener("change", () => {
    if (readVoice(panel) === "character") panel.characterNames.open = true;
  });
}

// Changes save on blur, so a preset saved straight after typing reads the form, not the chat.
function formSettings(ctx: ChatSettingsContext, settings: ChatSettings): ChatSettings {
  const panel = ctx.els.chatSettings;
  const voice = readVoice(panel);
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
  ctx.effortOptionsKey = syncOptions(
    panel.reasoningEffortSelect,
    [["Model default", ""], ...efforts.map((effort): Choice => [effort, effort])],
    ctx.effortOptionsKey,
  );
  panel.reasoningEffortSelect.value = settings.reasoningEffort ?? "";
  panel.earlierImagesSelect.value = settings.earlierImages ?? DEFAULT_EARLIER_IMAGES;
  renderSheetResolution(panel, settings, resolveModel(ctx.state, settings.modelId));
}

type Choice = readonly [label: string, value: string];

// Replacing the options of an open native dropdown can close it, so they change only with the list.
function syncOptions(
  select: HTMLSelectElement,
  choices: readonly Choice[],
  shownKey: string,
): string {
  const key = JSON.stringify(choices);
  if (key !== shownKey) {
    select.replaceChildren(...choices.map(([label, value]) => new Option(label, value)));
  }
  return key;
}

function renderPersona(ctx: ChatSettingsContext, settings: ChatSettings, switched: boolean): void {
  const panel = ctx.els.chatSettings;
  renderPersonaFields(panel, settings, switched);
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
  ctx.presetOptionsKey = syncOptions(
    panel.personaSelect,
    [[none, ""], ...personas.map((persona): Choice => [persona.name, persona.id])],
    ctx.presetOptionsKey,
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
