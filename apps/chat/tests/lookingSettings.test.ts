import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/http";
import { VENICE_BASE_URL } from "../src/api/venice";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS, loadSettings, type GlobalSettings } from "../src/settings";
import { createAppState, setLookingModels, setModels, type AppState } from "../src/state";
import type { ApiSettings, ModelInfo } from "../src/types";
import { NO_API_TEXT } from "../src/ui/settings/connectionTest";
import { initSettingsDialog, type SettingsDialog } from "../src/ui/settings/settingsDialog";
import { model } from "./support/factories";
import { mountPage } from "./support/page";
import { pickerIds, pickRow, triggerName } from "./support/picker";

const LOCAL = "http://localhost:5001/v1";
const BLIND = model("blind", { vision: false, privacy: "unknown" });
const SEES = model("sees", { privacy: "unknown" });

let els: AppElements;
let state: AppState;
let dialog: SettingsDialog;
let listModels: ReturnType<typeof vi.fn<(api: ApiSettings) => Promise<readonly ModelInfo[]>>>;
let loadModels: ReturnType<typeof vi.fn<() => Promise<readonly ModelInfo[]>>>;
let onListed: ReturnType<typeof vi.fn>;
let askOnce: ReturnType<typeof vi.fn<(api: ApiSettings, modelId: string) => Promise<void>>>;

function open(settings: Partial<GlobalSettings> = {}): void {
  state = createAppState({ ...DEFAULT_SETTINGS, baseUrl: LOCAL, ...settings });
  setModels(state, [BLIND, SEES]);
  setLookingModels(state, [model("eyes")]);
  dialog = initSettingsDialog(els, state, {
    loadModels,
    listModels,
    askOnce,
    onListed,
    onSaved: vi.fn(),
    storage: localStorage,
  });
  dialog.open();
}

function save(): GlobalSettings {
  els.settingsDialog.dialog.returnValue = "save";
  els.settingsDialog.dialog.dispatchEvent(new Event("close"));
  return loadSettings(localStorage);
}

function useOwnServer(url = VENICE_BASE_URL, key = ""): void {
  const { ownServerInput, baseUrlInput, apiKeyInput } = els.lookingSettings;
  ownServerInput.checked = true;
  ownServerInput.dispatchEvent(new Event("change"));
  baseUrlInput.value = url;
  baseUrlInput.dispatchEvent(new Event("input"));
  baseUrlInput.dispatchEvent(new Event("change"));
  if (key === "") return;
  apiKeyInput.value = key;
  apiKeyInput.dispatchEvent(new Event("input"));
}

function openList(mount: HTMLElement): string[] {
  mount.querySelector<HTMLButtonElement>(".model-trigger")?.click();
  return pickerIds(mount);
}

function block(): HTMLElement {
  const found = els.lookingSettings.testStatus.querySelector<HTMLElement>(".connection-result");
  if (!found) throw new Error("No result block");
  return found;
}

function result(): (string | null | undefined)[] {
  const lines = [...block().querySelectorAll("li")].map((li) => li.textContent);
  return [block().querySelector(".connection-result-heading")?.textContent, ...lines];
}

async function test(): Promise<void> {
  els.lookingSettings.testButton.click();
  await vi.waitFor(() => expect(els.lookingSettings.testButton.disabled).toBe(false));
}

beforeEach(() => {
  els = mountPage();
  els.settingsDialog.dialog.showModal = vi.fn();
  localStorage.clear();
  listModels = vi.fn(() => Promise.resolve([model("eyes", { name: "Eyes" }), model("more")]));
  loadModels = vi.fn(() => Promise.resolve(state.models));
  onListed = vi.fn();
  askOnce = vi.fn(() => Promise.resolve());
});

describe("the looking model for new chats", () => {
  it("is None, or one the chat's own server lists that can see images", () => {
    open();
    const mount = els.lookingSettings.modelPicker;
    expect(triggerName(mount)).toBe("None");
    expect(openList(mount)).toEqual(["", "sees"]);
    pickRow(mount, "sees");
    expect(dialog.looking()).toBe(true);
    expect(save()).toMatchObject({
      defaultLookingModelId: "sees",
      defaultLookingBaseUrl: LOCAL,
      lookingBaseUrl: "",
    });
  });

  it("can be taken away again", () => {
    open({ defaultLookingModelId: "sees", defaultLookingBaseUrl: LOCAL });
    const mount = els.lookingSettings.modelPicker;
    expect(triggerName(mount)).toBe("sees");
    mount.querySelector<HTMLButtonElement>(".model-trigger")?.click();
    mount.querySelector<HTMLElement>(".model-row.is-none")?.click();
    expect(save().defaultLookingModelId).toBe("");
  });

  it("lets the default model be one that cannot see images", () => {
    open();
    const { defaultModelPicker } = els.settingsDialog;
    expect(openList(defaultModelPicker)).toEqual(["sees"]);
    const note = defaultModelPicker.querySelector<HTMLElement>(".model-text-note");
    expect([note?.hidden, note?.textContent]).toEqual([
      false,
      "Models that cannot see images are hidden. Choose a looking model below to use one.",
    ]);
    defaultModelPicker.querySelector<HTMLButtonElement>(".model-trigger")?.click();
    pickRow(els.lookingSettings.modelPicker, "sees");
    expect(openList(defaultModelPicker)).toEqual(["blind", "sees"]);
    expect(note?.hidden).toBe(true);
    defaultModelPicker.querySelector<HTMLButtonElement>(".model-trigger")?.click();
    pickRow(defaultModelPicker, "blind");
    expect(save().defaultModelId).toBe("blind");
  });
});

describe("a different server for looking", () => {
  it("shows its fields only when asked for, and keeps them out of the form otherwise", () => {
    open();
    const { serverFields, baseUrlInput, apiKeyInput, ownServerInput } = els.lookingSettings;
    expect([serverFields.hidden, baseUrlInput.disabled, apiKeyInput.disabled]).toEqual([
      true,
      true,
      true,
    ]);
    useOwnServer();
    expect([serverFields.hidden, baseUrlInput.disabled]).toEqual([false, false]);
    ownServerInput.checked = false;
    ownServerInput.dispatchEvent(new Event("change"));
    expect(save()).toMatchObject({ lookingBaseUrl: "", apiKeys: {} });
  });

  it("is saved with its key under its own URL, and the model with the server it is on", async () => {
    open({ apiKey: "local-key" });
    useOwnServer(`${VENICE_BASE_URL}/`, "venice-key");
    await test();
    pickRow(els.lookingSettings.modelPicker, "eyes");
    expect(save()).toMatchObject({
      apiKey: "local-key",
      baseUrl: LOCAL,
      lookingBaseUrl: `${VENICE_BASE_URL}/`,
      defaultLookingModelId: "eyes",
      defaultLookingBaseUrl: VENICE_BASE_URL,
      apiKeys: { [LOCAL]: "local-key", [VENICE_BASE_URL]: "venice-key" },
    });
  });

  it("shows the key saved for a URL, from either pair of fields", () => {
    open({ apiKeys: { [VENICE_BASE_URL]: "venice-key" } });
    const { serverFields, apiKeyInput, ownServerInput } = els.lookingSettings;
    ownServerInput.checked = true;
    ownServerInput.dispatchEvent(new Event("change"));
    serverFields.querySelector<HTMLElement>("[data-looking-url]")?.click();
    expect(apiKeyInput.value).toBe("venice-key");
    expect(els.settingsDialog.baseUrlInput.value).toBe(LOCAL);
  });

  it("never offers a model by name on a server it was not picked on", () => {
    open({
      defaultLookingModelId: "eyes",
      defaultLookingBaseUrl: VENICE_BASE_URL,
      lookingBaseUrl: VENICE_BASE_URL,
    });
    const mount = els.lookingSettings.modelPicker;
    expect(triggerName(mount)).toBe("eyes");
    useOwnServer("https://openrouter.ai/api/v1");
    expect(triggerName(mount)).toBe("None");
    useOwnServer(VENICE_BASE_URL);
    expect(triggerName(mount)).toBe("eyes");
    useOwnServer("https://openrouter.ai/api/v1");
    expect(save()).toMatchObject({ defaultLookingModelId: "", defaultLookingBaseUrl: "" });
  });

  it("says where pictures are sent", () => {
    open();
    const { destination, ownServerInput } = els.lookingSettings;
    const sentence = (host: string) =>
      `Pictures from chats that use a looking model are sent to ${host}.`;
    expect(destination.textContent).toBe(sentence("localhost:5001"));
    useOwnServer();
    expect(destination.textContent).toBe(sentence("api.venice.ai"));
    ownServerInput.checked = false;
    ownServerInput.dispatchEvent(new Event("change"));
    els.settingsDialog.baseUrlInput.value = "";
    els.settingsDialog.baseUrlInput.dispatchEvent(new Event("input"));
    expect(destination.hidden).toBe(true);
  });

  it("honours private only on Venice, whose option shows for it too", () => {
    open({ lookingBaseUrl: VENICE_BASE_URL });
    setLookingModels(state, [model("priv"), model("anon", { privacy: "anonymized" })]);
    const { privateOnlyInput } = els.settingsDialog;
    expect(privateOnlyInput.closest("label")?.hidden).toBe(false);
    expect(openList(els.lookingSettings.modelPicker)).toEqual(["", "priv"]);
    privateOnlyInput.checked = false;
    privateOnlyInput.dispatchEvent(new Event("change"));
    expect(pickerIds(els.lookingSettings.modelPicker)).toEqual(["", "anon", "priv"]);
  });
});

describe("a looking model that the fields leave no room for", () => {
  const onVenice = {
    defaultLookingModelId: "anon",
    defaultLookingBaseUrl: VENICE_BASE_URL,
    lookingBaseUrl: VENICE_BASE_URL,
    privateOnly: false,
  };

  it("is not chosen while only private models are shown, and the dialog says so", () => {
    open(onVenice);
    setLookingModels(state, [
      model("anon", { name: "Anon", privacy: "anonymized" }),
      model("priv"),
    ]);
    dialog.open();
    const { changedNote, modelPicker } = els.lookingSettings;
    const { privateOnlyInput } = els.settingsDialog;
    expect([triggerName(modelPicker), changedNote.hidden]).toEqual(["Anon", true]);
    privateOnlyInput.checked = true;
    privateOnlyInput.dispatchEvent(new Event("change"));
    expect(triggerName(modelPicker)).toBe("None");
    expect(changedNote.textContent).toContain("Anon is not a private model");
    privateOnlyInput.checked = false;
    privateOnlyInput.dispatchEvent(new Event("change"));
    expect([triggerName(modelPicker), changedNote.hidden]).toEqual(["Anon", true]);
    privateOnlyInput.checked = true;
    privateOnlyInput.dispatchEvent(new Event("change"));
    expect(save().defaultLookingModelId).toBe("");
  });

  it("says which server it was picked on, the chat's own included", () => {
    open({ defaultLookingModelId: "sees", defaultLookingBaseUrl: LOCAL });
    const { changedNote, modelPicker } = els.lookingSettings;
    els.settingsDialog.baseUrlInput.value = "https://openrouter.ai/api/v1";
    els.settingsDialog.baseUrlInput.dispatchEvent(new Event("input"));
    expect(triggerName(modelPicker)).toBe("None");
    expect(changedNote.textContent).toContain("sees was picked on localhost:5001");
    pickRow(modelPicker, "sees");
    expect(changedNote.hidden).toBe(true);
    expect(save().defaultLookingBaseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("keeps a text-only default model in mind until looking is back", () => {
    open({
      defaultModelId: "blind",
      defaultLookingModelId: "sees",
      defaultLookingBaseUrl: LOCAL,
    });
    const { defaultModelPicker, baseUrlInput } = els.settingsDialog;
    const type = (url: string) => {
      baseUrlInput.value = url;
      baseUrlInput.dispatchEvent(new Event("input"));
      els.settingsDialog.privateOnlyInput.dispatchEvent(new Event("change"));
    };
    expect(triggerName(defaultModelPicker)).toBe("blind");
    type("https://openrouter.ai/api/v1");
    expect(triggerName(defaultModelPicker)).toBe("sees");
    type(LOCAL);
    expect(triggerName(defaultModelPicker)).toBe("blind");
    expect(save().defaultModelId).toBe("blind");
  });
});

describe("testing the looking model", () => {
  it("says it is there, and offers the server's models at once", async () => {
    open();
    useOwnServer(VENICE_BASE_URL, "k");
    await test();
    expect(listModels).toHaveBeenCalledWith(
      { baseUrl: VENICE_BASE_URL, apiKey: "k" },
      DEFAULT_SETTINGS.fallbackMaxImages,
    );
    expect(result()).toEqual([
      "Connected",
      "api.venice.ai",
      "No looking model is chosen for new chats yet.",
      "The server answered; the key was not checked.",
    ]);
    expect(askOnce).not.toHaveBeenCalled();
    expect(openList(els.lookingSettings.modelPicker)).toEqual(["", "eyes", "more"]);
    expect(onListed).toHaveBeenCalledTimes(1);
    pickRow(els.lookingSettings.modelPicker, "eyes");
    expect(block().hidden).toBe(true);
    await test();
    expect(result()).toContain("Eyes is there and can see images.");
    expect(result()).toContain("The key works: Eyes answered.");
    expect(askOnce).toHaveBeenCalledWith({ baseUrl: VENICE_BASE_URL, apiKey: "k" }, "eyes");
    expect(block().classList.contains("is-success")).toBe(true);
  });

  it("says when the model is missing or cannot see", async () => {
    open({ defaultLookingModelId: "gone", defaultLookingBaseUrl: LOCAL });
    await test();
    expect(result()).toEqual([
      "Connected, but the model is not usable",
      "localhost:5001",
      "It does not list gone.",
    ]);
    expect(block().classList.contains("is-error")).toBe(true);
    listModels.mockResolvedValueOnce([model("gone", { name: "Gone", vision: false })]);
    await test();
    expect(result()).toContain("Gone cannot see images.");
  });

  it("says when the server fails, or is not named", async () => {
    open();
    useOwnServer(VENICE_BASE_URL, "k");
    listModels.mockRejectedValueOnce(new ApiError(401, "bad key"));
    await test();
    expect(result()).toEqual([
      "Could not connect",
      "api.venice.ai",
      "The server refused the API key.",
    ]);
    expect(onListed).not.toHaveBeenCalled();
    els.lookingSettings.ownServerInput.checked = false;
    els.settingsDialog.baseUrlInput.value = "";
    await test();
    expect(result()).toContain(NO_API_TEXT);
  });

  it("asks the model something short only when the list does not check the key", async () => {
    open({
      defaultLookingModelId: "eyes",
      defaultLookingBaseUrl: VENICE_BASE_URL,
      lookingBaseUrl: VENICE_BASE_URL,
      apiKeys: { [VENICE_BASE_URL]: "k" },
    });
    listModels.mockImplementation(({ apiKey }) =>
      apiKey === "" ? Promise.reject(new Error("no key")) : Promise.resolve([model("eyes")]),
    );
    await test();
    expect(result()).toHaveLength(3);
    expect(askOnce).not.toHaveBeenCalled();
    listModels.mockResolvedValue([model("eyes", { name: "Eyes" })]);
    askOnce.mockRejectedValueOnce(new ApiError(401, "bad key"));
    await test();
    expect(result()).toContain("The server refused the API key.");
    askOnce.mockRejectedValueOnce(new ApiError(500, "out of memory"));
    await test();
    expect(result()).toEqual([
      "Connected, but the model did not answer",
      "api.venice.ai",
      "Eyes did not answer a short text message.",
    ]);
    expect(block().querySelector(".connection-result-detail")?.textContent).toBe(
      "HTTP 500: out of memory",
    );
  });

  it("drops a result that comes after the fields changed or the dialog closed", async () => {
    open();
    useOwnServer(VENICE_BASE_URL, "k");
    for (const change of [
      () => useOwnServer("https://openrouter.ai/api/v1"),
      () => els.settingsDialog.dialog.dispatchEvent(new Event("close")),
    ]) {
      let finish: (models: ModelInfo[]) => void = () => {};
      listModels.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
      els.lookingSettings.testButton.click();
      change();
      finish([model("late")]);
      await Promise.resolve();
      await Promise.resolve();
      expect(block().hidden).toBe(true);
    }
    expect(onListed).not.toHaveBeenCalled();
  });

  it("refreshes its list without a test", async () => {
    open();
    useOwnServer(VENICE_BASE_URL, "k");
    els.lookingSettings.refreshButton.click();
    const { modelsStatus } = els.lookingSettings;
    await vi.waitFor(() => expect(modelsStatus.textContent).toBe("2 vision models"));
    listModels.mockRejectedValueOnce(new Error("offline"));
    els.lookingSettings.refreshButton.click();
    await vi.waitFor(() => expect(modelsStatus.textContent).toBe("offline"));
  });
});

describe("a list read in the dialog", () => {
  const TYPED = { baseUrl: "http://localhost:9999/v1", apiKey: "typed" };
  const defaultModelPicker = () => els.settingsDialog.defaultModelPicker;

  function type({ baseUrl, apiKey }: ApiSettings): void {
    els.settingsDialog.baseUrlInput.value = baseUrl;
    els.settingsDialog.apiKeyInput.value = apiKey;
  }

  it("fills the dialog's lists at once, and keeps the chosen model where it is listed", () => {
    open({ defaultModelId: "sees" });
    type(TYPED);
    dialog.listed(TYPED, [model("other"), model("sees")]);
    expect(triggerName(defaultModelPicker())).toBe("sees");
    expect(openList(defaultModelPicker())).toEqual(["other", "sees"]);
    expect(openList(els.lookingSettings.modelPicker)).toEqual(["", "other", "sees"]);
    expect(els.settingsDialog.modelsStatus.textContent).toBe("2 models");
    expect(state.models).toEqual([BLIND, SEES]);
    expect(onListed).toHaveBeenCalledWith(TYPED, [model("other"), model("sees")]);
  });

  it("takes the first model when the chosen one is not listed", () => {
    open({ defaultModelId: "sees" });
    type(TYPED);
    dialog.listed(TYPED, [model("other")]);
    expect(triggerName(defaultModelPicker())).toBe("other");
  });

  it("is not shown for other fields, nor when the dialog opens again", () => {
    open({ defaultModelId: "sees" });
    type(TYPED);
    dialog.listed(TYPED, [model("other")]);
    type({ ...TYPED, apiKey: "another" });
    expect(openList(defaultModelPicker())).toEqual(["sees"]);
    dialog.open();
    expect(triggerName(defaultModelPicker())).toBe("sees");
  });

  it("is loaded for the app when Refresh asks the saved server, and here alone otherwise", async () => {
    open();
    const { refreshModelsButton, modelsStatus } = els.settingsDialog;
    refreshModelsButton.click();
    await vi.waitFor(() => expect(modelsStatus.textContent).toBe("1 model"));
    expect([loadModels.mock.calls.length, listModels.mock.calls.length]).toEqual([1, 0]);
    type(TYPED);
    refreshModelsButton.click();
    await vi.waitFor(() => expect(modelsStatus.textContent).toBe("2 models"));
    expect([loadModels.mock.calls.length, listModels.mock.calls.length]).toEqual([1, 1]);
    expect(state.models).toEqual([BLIND, SEES]);
    listModels.mockRejectedValueOnce(new Error("offline"));
    refreshModelsButton.click();
    await vi.waitFor(() => expect(modelsStatus.textContent).toBe("offline"));
  });
});

describe("lists and what is not saved yet", () => {
  it("stay in the dialog while the image limit is not as saved", async () => {
    open();
    const { refreshModelsButton, fallbackMaxImagesInput, modelsStatus } = els.settingsDialog;
    fallbackMaxImagesInput.value = "3";
    refreshModelsButton.click();
    await vi.waitFor(() => expect(modelsStatus.textContent).toBe("2 models"));
    expect(loadModels).not.toHaveBeenCalled();
    expect(listModels).toHaveBeenCalledWith({ baseUrl: LOCAL, apiKey: "" }, 3);
    expect(onListed).not.toHaveBeenCalled();
  });

  it("are dropped by Refresh for its own server alone", async () => {
    open();
    const looking = { baseUrl: VENICE_BASE_URL, apiKey: "" };
    useOwnServer();
    dialog.listed(looking, [model("eyes")]);
    els.settingsDialog.refreshModelsButton.click();
    await vi.waitFor(() => expect(loadModels).toHaveBeenCalled());
    await Promise.resolve();
    expect(openList(els.lookingSettings.modelPicker)).toEqual(["", "eyes"]);
  });
});
