import { isVenice, normaliseBaseUrl } from "../../api/venice";
import { lookingApi, lookingHasOwnServer, pickedLookingServer } from "../../app/lookingConnection";
import { sameApi } from "../../app/modelList";
import { serverName } from "../../chat/looking";
import { offeredModels, reportsPrivacy } from "../../chat/models";
import type { AppElements } from "../../dom";
import { latestCalls } from "../../latest";
import { keyFor, withKey, type GlobalSettings } from "../../settings";
import type { AppState } from "../../state";
import { errorText, plural } from "../../text";
import type { ApiSettings, ModelInfo } from "../../types";
import { createModelPicker, type ModelPicker } from "../modelPicker/modelPicker";
import type { PickerSettings } from "../modelPicker/pickerModel";
import { initConnectionBlock, type ConnectionBlock } from "./connectionBlock";
import { NO_API, NO_API_TEXT } from "./connectionTest";
import type { ListedModels } from "./listedModels";
import { testLookingModel, type LookingProbes, type LookingReport } from "./lookingTest";
import { keyFollower, type KeyFollower, type SavedKeys } from "./serverKeys";

export const NO_LOOKING_MODEL = {
  label: "None",
  details: "The chat's own model sees its pictures",
};

export interface LookingSettings {
  open(settings: GlobalSettings): void;
  modelId(): string;
  // Adds what this section holds to the rest of the form.
  apply(settings: GlobalSettings): GlobalSettings;
  // Pictures go to Venice, on the looking model's own server.
  usesVenice(): boolean;
  // The chat's own server, which looking may share, is another now.
  chatServerChanged(): void;
  render(): void;
  close(): void;
}

export interface LookingSettingsDeps extends LookingProbes {
  keys: SavedKeys;
  pickerSettings: PickerSettings;
  // The whole form as it would be saved.
  formSettings(): GlobalSettings;
  listed: ListedModels;
  // The models of the chat's own server, as the dialog shows them.
  chatModels(): readonly ModelInfo[];
  onListed(api: ApiSettings, models: readonly ModelInfo[]): void;
  onChanged(): void;
}

type LookingElements = Pick<AppElements, "lookingSettings" | "settingsDialog">;

interface LookingContext {
  els: AppElements["lookingSettings"];
  state: AppState;
  deps: LookingSettingsDeps;
  picker: ModelPicker;
  block: ConnectionBlock;
  follower: KeyFollower;
  // Kept for the server it was picked on, so another server never gets it by name.
  choice: { modelId: string; server: string };
  chosen(): string;
  refusal(): string | undefined;
  startRefresh: ReturnType<typeof latestCalls>;
}

export function initLookingSettings(
  els: LookingElements & Pick<AppElements, "templates">,
  state: AppState,
  deps: LookingSettingsDeps,
): LookingSettings {
  const { modelPicker, baseUrlInput, apiKeyInput, testButton, testStatus } = els.lookingSettings;
  const { defaultLookingModelId, defaultLookingBaseUrl } = state.settings;
  const choice = { modelId: defaultLookingModelId, server: defaultLookingBaseUrl };
  const chosen = () =>
    choice.modelId !== "" && refusal(els, state, deps, choice) === undefined ? choice.modelId : "";
  const ctx: LookingContext = {
    els: els.lookingSettings,
    state,
    deps,
    picker: createModelPicker(
      { mount: modelPicker, ...els.templates },
      {
        models: () => offered(els, state, deps),
        current: chosen,
        onPick: (id) => {
          choice.modelId = id;
          choice.server = formServer(els);
          ctx.block.clear();
          render(ctx);
          deps.onChanged();
        },
        settings: deps.pickerSettings,
        none: NO_LOOKING_MODEL,
      },
    ),
    block: initConnectionBlock({ button: testButton, status: testStatus }),
    follower: keyFollower(deps.keys, { url: baseUrlInput, key: apiKeyInput }),
    choice,
    chosen,
    refusal: () => refusal(els, state, deps, choice),
    startRefresh: latestCalls(),
  };
  listen(ctx, els.settingsDialog);
  return {
    open: (settings) => open(ctx, settings),
    modelId: chosen,
    apply: (settings) => apply(ctx, settings),
    usesVenice: () => ownServer(els.lookingSettings) && isVenice(baseUrlInput.value),
    chatServerChanged: () => {
      ctx.block.clear();
      render(ctx);
    },
    render: () => render(ctx),
    close: () => {
      ctx.picker.close();
      ctx.block.clear();
      ctx.startRefresh();
    },
  };
}

function ownServer({ ownServerInput, baseUrlInput }: AppElements["lookingSettings"]): boolean {
  return ownServerInput.checked && baseUrlInput.value.trim() !== "";
}

// The server a model picked now would be on.
function formServer({ lookingSettings, settingsDialog }: LookingElements): string {
  const lookingBaseUrl = ownServer(lookingSettings) ? lookingSettings.baseUrlInput.value : "";
  return pickedLookingServer({ baseUrl: settingsDialog.baseUrlInput.value, lookingBaseUrl });
}

// Why the model wanted cannot be the one chosen, with the fields as they are.
function refusal(
  els: LookingElements,
  state: AppState,
  deps: LookingSettingsDeps,
  { modelId, server }: LookingContext["choice"],
): string | undefined {
  if (formServer(els) !== server) {
    return `${modelId} was picked on ${serverName(server)}. Choose the looking model again for the server used now.`;
  }
  const models = offered(els, state, deps);
  const model = models.find((entry) => entry.id === modelId);
  const hidden =
    deps.pickerSettings.privateOnly() && reportsPrivacy(models) && model?.privacy !== "private";
  return model && hidden
    ? `${model.name} is not a private model, so no looking model is chosen. Choose another, or show models that are not private.`
    : undefined;
}

function sharesServer({ lookingSettings, settingsDialog }: LookingElements): boolean {
  const own = normaliseBaseUrl(lookingSettings.baseUrlInput.value);
  return own === normaliseBaseUrl(settingsDialog.baseUrlInput.value);
}

function typedApi({ baseUrlInput, apiKeyInput }: AppElements["lookingSettings"]): ApiSettings {
  return { baseUrl: baseUrlInput.value.trim(), apiKey: apiKeyInput.value.trim() };
}

function offered(
  els: LookingElements,
  state: AppState,
  deps: LookingSettingsDeps,
): readonly ModelInfo[] {
  if (!ownServer(els.lookingSettings) || sharesServer(els)) return deps.chatModels();
  const api = typedApi(els.lookingSettings);
  const saved = lookingHasOwnServer(state.settings) && sameApi(api, lookingApi(state.settings));
  return deps.listed.of(api) ?? (saved ? state.lookingModels : []);
}

function listen(ctx: LookingContext, dlg: AppElements["settingsDialog"]): void {
  const { els } = ctx;
  els.ownServerInput.addEventListener("change", () => {
    if (els.ownServerInput.checked) els.baseUrlInput.focus();
    changed(ctx);
  });
  els.baseUrlInput.addEventListener("input", () => changed(ctx));
  els.baseUrlInput.addEventListener("change", () => serverChanged(ctx));
  els.apiKeyInput.addEventListener("input", () => changed(ctx));
  dlg.apiKeyInput.addEventListener("input", () => ctx.block.clear());
  els.serverFields.addEventListener("click", (event) => {
    const fill =
      event.target instanceof Element ? event.target.closest("[data-looking-url]") : null;
    if (!(fill instanceof HTMLElement)) return;
    els.baseUrlInput.value = fill.dataset["lookingUrl"] ?? "";
    serverChanged(ctx);
    els.apiKeyInput.focus();
  });
  els.refreshButton.addEventListener("click", () => void refresh(ctx));
  els.testButton.addEventListener("click", () => void test(ctx));
}

// Anything known of the server, or still on its way, is of the fields as they were.
function changed(ctx: LookingContext): void {
  ctx.block.clear();
  ctx.startRefresh();
  ctx.els.modelsStatus.textContent = "";
  render(ctx);
  ctx.deps.onChanged();
}

function serverChanged(ctx: LookingContext): void {
  ctx.follower.follow();
  changed(ctx);
}

function open(ctx: LookingContext, settings: GlobalSettings): void {
  const { els } = ctx;
  const { lookingBaseUrl } = settings;
  ctx.startRefresh();
  ctx.block.clear();
  ctx.choice.modelId = settings.defaultLookingModelId;
  ctx.choice.server = settings.defaultLookingBaseUrl;
  els.ownServerInput.checked = lookingBaseUrl !== "";
  ctx.follower.show(lookingBaseUrl, keyFor(settings.apiKeys, lookingBaseUrl));
  els.modelsStatus.textContent = "";
  render(ctx);
}

function apply(ctx: LookingContext, settings: GlobalSettings): GlobalSettings {
  const lookingBaseUrl = ownServer(ctx.els) ? ctx.els.baseUrlInput.value.trim() : "";
  const defaultLookingModelId = ctx.chosen();
  const server = pickedLookingServer({ ...settings, lookingBaseUrl });
  const applied = {
    ...settings,
    lookingBaseUrl,
    defaultLookingModelId,
    defaultLookingBaseUrl: defaultLookingModelId === "" ? "" : server,
  };
  // On the chat's own server, the key typed for the chat stands.
  if (!lookingHasOwnServer(applied)) return applied;
  const apiKey = ctx.els.apiKeyInput.value.trim();
  return { ...applied, apiKeys: withKey(applied.apiKeys, lookingBaseUrl, apiKey) };
}

function render(ctx: LookingContext): void {
  const { els, deps } = ctx;
  const own = els.ownServerInput.checked;
  els.serverFields.hidden = !own;
  // Disabled while hidden, so an unfinished URL in them cannot block Save.
  els.baseUrlInput.disabled = !own;
  els.apiKeyInput.disabled = !own;
  const { baseUrl } = lookingApi(deps.formSettings());
  const refused = ctx.choice.modelId === "" ? undefined : ctx.refusal();
  els.changedNote.hidden = refused === undefined;
  els.changedNote.textContent = refused ?? "";
  els.destination.hidden = baseUrl === "";
  els.destination.textContent = `Pictures from chats that use a looking model are sent to ${serverName(baseUrl)}.`;
  ctx.picker.render();
}

async function refresh(ctx: LookingContext): Promise<void> {
  const { modelsStatus } = ctx.els;
  const api = lookingApi(ctx.deps.formSettings());
  if (api.baseUrl === "") {
    modelsStatus.textContent = NO_API_TEXT;
    return;
  }
  const isLatest = ctx.startRefresh();
  modelsStatus.textContent = "Loading models…";
  try {
    const models = await ctx.deps.listModels(api);
    if (!isLatest()) return;
    ctx.deps.onListed(api, models);
    const privateOnly = ctx.deps.pickerSettings.privateOnly();
    const noun = isVenice(api.baseUrl) ? "vision model" : "model";
    modelsStatus.textContent = plural(offeredModels(models, privateOnly).length, noun);
  } catch (error) {
    if (isLatest()) modelsStatus.textContent = errorText(error);
  }
}

async function test(ctx: LookingContext): Promise<void> {
  const api = lookingApi(ctx.deps.formSettings());
  if (api.baseUrl === "") {
    ctx.block.show(NO_API);
    return;
  }
  let report: LookingReport | undefined;
  const shown = await ctx.block.run(async () => {
    report = await testLookingModel(api, ctx.chosen(), ctx.deps);
    return report.result;
  });
  if (shown && report?.models) ctx.deps.onListed(api, report.models);
}
