import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS, loadSettings } from "../src/settings";
import { createAppState, setModels, type AppState } from "../src/state";
import type { ModelInfo } from "../src/types";
import { initSettingsDialog } from "../src/ui/settings/settingsDialog";
import { model as baseModel } from "./support/factories";
import { mountPage } from "./support/page";
import { pickerIds, pickRow, triggerName } from "./support/picker";

let els: AppElements;
let state: AppState;

function model(id: string, privacy: ModelInfo["privacy"]): ModelInfo {
  return baseModel(id, { privacy });
}

beforeEach(() => {
  els = mountPage();
  els.settingsDialog.dialog.showModal = vi.fn();
  state = createAppState({ ...DEFAULT_SETTINGS, defaultModelId: "mock-model" });
  setModels(state, [model("anon", "anonymized"), model("priv", "private")]);
});

describe("initSettingsDialog", () => {
  it("selects the first visible model when the stored default is not loaded", () => {
    const dialog = initSettingsDialog(els, state, {
      loadModels: () => Promise.resolve(state.models),
      onSaved: vi.fn(),
    });
    dialog.open();
    const mount = els.settingsDialog.defaultModelPicker;
    expect(triggerName(mount)).toBe("priv");
    mount.querySelector<HTMLButtonElement>(".model-trigger")?.click();
    expect(pickerIds(mount)).toEqual(["priv"]);
  });

  it("follows the private-only toggle with the first visible model", () => {
    const dialog = initSettingsDialog(els, state, {
      loadModels: () => Promise.resolve(state.models),
      onSaved: vi.fn(),
    });
    dialog.open();
    const { privateOnlyInput, defaultModelPicker } = els.settingsDialog;
    privateOnlyInput.checked = false;
    privateOnlyInput.dispatchEvent(new Event("change"));
    expect(triggerName(defaultModelPicker)).toBe("priv");
    defaultModelPicker.querySelector<HTMLButtonElement>(".model-trigger")?.click();
    expect(pickerIds(defaultModelPicker)).toEqual(["anon", "priv"]);
  });

  it("mirrors the private-only checkbox in the picker's Private chip", () => {
    const dialog = initSettingsDialog(els, state, {
      loadModels: () => Promise.resolve(state.models),
      onSaved: vi.fn(),
    });
    dialog.open();
    const { privateOnlyInput, defaultModelPicker } = els.settingsDialog;
    defaultModelPicker.querySelector<HTMLButtonElement>(".model-trigger")?.click();
    const chip = defaultModelPicker.querySelector<HTMLButtonElement>('[data-filter="private"]');
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    chip?.click();
    expect(privateOnlyInput.checked).toBe(false);
    expect(chip?.getAttribute("aria-pressed")).toBe("false");
    expect(pickerIds(defaultModelPicker)).toEqual(["anon", "priv"]);
  });

  it("saves the model picked as the default", () => {
    localStorage.clear();
    const dialog = initSettingsDialog(els, state, {
      loadModels: () => Promise.resolve(state.models),
      onSaved: vi.fn(),
      storage: localStorage,
    });
    dialog.open();
    els.settingsDialog.privateOnlyInput.checked = false;
    pickRow(els.settingsDialog.defaultModelPicker, "anon");
    expect(triggerName(els.settingsDialog.defaultModelPicker)).toBe("anon");
    els.settingsDialog.dialog.returnValue = "save";
    els.settingsDialog.dialog.dispatchEvent(new Event("close"));
    expect(state.settings.defaultModelId).toBe("anon");
    expect(loadSettings(localStorage).defaultModelId).toBe("anon");
  });
});

describe("Connection", () => {
  function openDialog(baseUrl: string): void {
    localStorage.clear();
    state = createAppState({ ...state.settings, baseUrl });
    initSettingsDialog(els, state, {
      loadModels: () => Promise.resolve(state.models),
      onSaved: vi.fn(),
      storage: localStorage,
    }).open();
  }

  function privacyOption(): HTMLElement | null {
    return els.settingsDialog.privateOnlyInput.closest("label");
  }

  it("offers the private-only switch only for Venice, following the typed base URL", () => {
    openDialog("http://localhost:11434/v1");
    expect(privacyOption()?.hidden).toBe(true);
    const { baseUrlInput } = els.settingsDialog;
    baseUrlInput.value = "https://api.venice.ai/api/v1";
    baseUrlInput.dispatchEvent(new Event("input"));
    expect(privacyOption()?.hidden).toBe(false);
  });

  it("fills the base URL from a quick-fill choice", () => {
    openDialog("");
    const fill = els.settingsDialog.form.querySelector<HTMLButtonElement>(
      '[data-base-url="https://openrouter.ai/api/v1"]',
    );
    expect(fill).not.toBeNull();
    fill?.click();
    expect(els.settingsDialog.baseUrlInput.value).toBe("https://openrouter.ai/api/v1");
    expect(document.activeElement).toBe(els.settingsDialog.apiKeyInput);
  });

  it("clears the base URL when the field is saved blank, and keeps it cleared", () => {
    openDialog("http://localhost:1234/v1");
    els.settingsDialog.apiKeyInput.value = "secret";
    els.settingsDialog.baseUrlInput.value = " ";
    els.settingsDialog.dialog.returnValue = "save";
    els.settingsDialog.dialog.dispatchEvent(new Event("close"));
    expect(state.settings.baseUrl).toBe("");
    expect(loadSettings(localStorage).baseUrl).toBe("");
  });
});

describe("API keys per base URL", () => {
  const venice = "https://api.venice.ai/api/v1";
  const openRouter = "https://openrouter.ai/api/v1";

  function openWith(baseUrl: string, apiKey: string): void {
    localStorage.clear();
    state = createAppState({ ...state.settings, baseUrl, apiKey, apiKeys: { [baseUrl]: apiKey } });
    initSettingsDialog(els, state, {
      loadModels: () => Promise.resolve(state.models),
      onSaved: vi.fn(),
      storage: localStorage,
    }).open();
  }

  it("keeps a key per base URL as the quick fills switch servers", () => {
    openWith(venice, "venice-key");
    const { form, apiKeyInput } = els.settingsDialog;
    const fill = (url: string) =>
      form.querySelector<HTMLButtonElement>(`[data-base-url="${url}"]`)?.click();
    fill(openRouter);
    expect(apiKeyInput.value).toBe("");
    apiKeyInput.value = "router-key";
    fill(venice);
    expect(apiKeyInput.value).toBe("venice-key");
    fill(openRouter);
    expect(apiKeyInput.value).toBe("router-key");
    els.settingsDialog.dialog.returnValue = "save";
    els.settingsDialog.dialog.dispatchEvent(new Event("close"));
    expect(loadSettings(localStorage)).toMatchObject({
      baseUrl: openRouter,
      apiKey: "router-key",
      apiKeys: { [venice]: "venice-key", [openRouter]: "router-key" },
    });
  });

  it("swaps in the key for a base URL typed by hand once the field is left", () => {
    openWith("http://localhost:1234/v1", "local-key");
    const { baseUrlInput, apiKeyInput } = els.settingsDialog;
    baseUrlInput.value = "https://api.openai.com/v1";
    baseUrlInput.dispatchEvent(new Event("change"));
    expect(apiKeyInput.value).toBe("");
    baseUrlInput.value = "http://localhost:1234/v1/";
    baseUrlInput.dispatchEvent(new Event("change"));
    expect(apiKeyInput.value).toBe("local-key");
  });
});

describe("Show thinking", () => {
  it("is off by default and saved from the dialog", () => {
    localStorage.clear();
    const onSaved = vi.fn();
    const dialog = initSettingsDialog(els, state, {
      loadModels: () => Promise.resolve(state.models),
      onSaved,
      storage: localStorage,
    });
    dialog.open();
    expect(els.settingsDialog.showThinkingInput.checked).toBe(false);
    els.settingsDialog.showThinkingInput.checked = true;
    els.settingsDialog.dialog.returnValue = "save";
    els.settingsDialog.dialog.dispatchEvent(new Event("close"));
    expect(state.settings.showThinking).toBe(true);
    expect(loadSettings(localStorage).showThinking).toBe(true);
    expect(onSaved).toHaveBeenCalled();
  });
});

describe("audio labels", () => {
  function openDialog(): void {
    localStorage.clear();
    initSettingsDialog(els, state, {
      loadModels: () => Promise.resolve(state.models),
      onSaved: vi.fn(),
      storage: localStorage,
    }).open();
  }

  function save(): void {
    els.settingsDialog.dialog.returnValue = "save";
    els.settingsDialog.dialog.dispatchEvent(new Event("close"));
  }

  it("saves one label per line, trimmed and without blanks or repeats", () => {
    openDialog();
    const { soundLabelsInput, backgroundSoundLabelsInput } = els.settingsDialog;
    expect(soundLabelsInput.value).toBe(DEFAULT_SETTINGS.soundLabels.join("\n"));
    soundLabelsInput.value = " music \n\napplause\nmusic\n";
    backgroundSoundLabelsInput.value = "silence\nwind";
    save();
    expect(state.settings.soundLabels).toEqual(["music", "applause"]);
    expect(state.settings.backgroundSoundLabels).toEqual(["silence", "wind"]);
    expect(loadSettings(localStorage).soundLabels).toEqual(["music", "applause"]);
  });

  it("keeps the labels across a save that leaves them alone or blank", () => {
    state = createAppState({ ...state.settings, soundLabels: ["footsteps"] });
    openDialog();
    save();
    expect(state.settings.soundLabels).toEqual(["footsteps"]);
    els.settingsDialog.soundLabelsInput.value = "  ";
    save();
    expect(state.settings.soundLabels).toEqual(["footsteps"]);
    expect(state.settings.backgroundSoundLabels).toEqual(DEFAULT_SETTINGS.backgroundSoundLabels);
  });

  it("resets both lists to the defaults on Save", () => {
    state = createAppState({
      ...state.settings,
      soundLabels: ["footsteps"],
      backgroundSoundLabels: ["wind"],
    });
    openDialog();
    els.settingsDialog.resetSoundLabelsButton.click();
    save();
    expect(state.settings.soundLabels).toEqual(DEFAULT_SETTINGS.soundLabels);
    expect(state.settings.backgroundSoundLabels).toEqual(DEFAULT_SETTINGS.backgroundSoundLabels);
  });
});

describe("the looking model's settings", () => {
  it("are kept, with its key, when the dialog is saved", () => {
    const own = "http://localhost:5001/v1";
    state = createAppState({
      ...state.settings,
      defaultLookingModelId: "eyes",
      defaultLookingBaseUrl: own,
      lookingBaseUrl: own,
      apiKeys: { [own]: "looking-key" },
    });
    const deps = { loadModels: () => Promise.resolve(state.models), onSaved: vi.fn() };
    initSettingsDialog(els, state, { ...deps, storage: localStorage }).open();
    els.settingsDialog.dialog.returnValue = "save";
    els.settingsDialog.dialog.dispatchEvent(new Event("close"));
    expect(loadSettings(localStorage)).toMatchObject({
      defaultLookingModelId: "eyes",
      lookingBaseUrl: own,
      apiKeys: { [own]: "looking-key" },
    });
  });
});

describe("the form's own validation", () => {
  it("passes every default setting, so Save is never blocked by one", () => {
    state = createAppState(DEFAULT_SETTINGS);
    initSettingsDialog(els, state, {
      loadModels: () => Promise.resolve([]),
      onSaved: vi.fn(),
      storage: localStorage,
    }).open();
    const inputs = [...els.settingsDialog.form.querySelectorAll("input, textarea, select")];
    expect(inputs.length).toBeGreaterThan(8);
    const invalid = inputs.filter((input) => !(input as HTMLInputElement).checkValidity());
    expect(invalid.map((input) => input.id)).toEqual([]);
  });
});
