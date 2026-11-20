import { beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { effectiveVideoReferences } from "../src/chat/history";
import { listPersonas, savePersona } from "../src/chat/personas";
import { createMemoryStore } from "../src/chat/store";
import { queryElements, type AppElements } from "../src/dom";
import { DEFAULT_SETTINGS, loadSettings } from "../src/settings";
import {
  blankChat,
  createAppState,
  replaceChat,
  setCurrentChat,
  setModels,
  type AppState,
} from "../src/state";
import type { ChatStore, ModelInfo } from "../src/types";
import {
  initChatSettings,
  initSettingsDialog,
  parseMaxRounds,
  VOICE_HINTS,
} from "../src/ui/settingsDialog";
import { initToast, type Toast } from "../src/ui/toast";

let els: AppElements;
let state: AppState;

function model(id: string, privacy: ModelInfo["privacy"]): ModelInfo {
  return {
    id,
    name: id,
    vision: true,
    tools: true,
    reasoning: false,
    reasoningEffortOptions: [],
    maxImages: 10,
    traits: [],
    uncensored: false,
    recommended: false,
    beta: false,
    videoInput: false,
    audioInput: false,
    e2ee: false,
    privacy,
  };
}

function toast(): Toast {
  return initToast(els, { set: () => 0, clear: vi.fn() });
}

function pickerIds(mount: HTMLElement): string[] {
  return [...mount.querySelectorAll<HTMLElement>(".model-row")].map((row) => row.dataset.id ?? "");
}

function triggerName(mount: HTMLElement): string | null | undefined {
  return mount.querySelector(".model-trigger-name")?.textContent;
}

function pickRow(mount: HTMLElement, id: string): void {
  mount.querySelector<HTMLButtonElement>(".model-trigger")?.click();
  mount.querySelector<HTMLElement>(`.model-row[data-id="${id}"]`)?.click();
}

beforeEach(() => {
  document.body.innerHTML = indexHtml;
  els = queryElements();
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

describe("Chat settings sheet resolution", () => {
  async function openChat(modelId: string): Promise<ChatStore> {
    setModels(state, [model("qwen3-6-27b", "private"), model("claude-opus-4-7", "private")]);
    const store = createMemoryStore();
    const chat = blankChat(modelId, "chat", 1);
    await store.putChat(chat);
    replaceChat(state, chat);
    setCurrentChat(state, chat, []);
    initChatSettings(els, state, { store, toast: toast(), onChanged: vi.fn(), onError: vi.fn() });
    return store;
  }

  it("labels Auto with the resolution and reason for the chat's model", async () => {
    await openChat("qwen3-6-27b");
    const { sheetResolutionSelect, sheetResolutionAuto, sheetResolutionHint } = els.chatSettings;
    expect(sheetResolutionSelect.value).toBe("auto");
    expect(sheetResolutionAuto.textContent).toBe("Auto (3072 px)");
    expect(sheetResolutionAuto.title).toBe("Auto for Qwen");
    expect(sheetResolutionHint.textContent).toBe("Auto for Qwen");
    expect(sheetResolutionHint.hidden).toBe(false);
  });

  it("updates the Auto label when the model changes", async () => {
    await openChat("qwen3-6-27b");
    const { modelPicker, sheetResolutionAuto } = els.chatSettings;
    pickRow(modelPicker, "claude-opus-4-7");
    await vi.waitFor(() => expect(sheetResolutionAuto.textContent).toBe("Auto (1932 px)"));
    expect(sheetResolutionAuto.title).toBe("Auto for Claude (4.7 and later)");
  });

  it("saves a fixed resolution and hides the Auto reason", async () => {
    const store = await openChat("qwen3-6-27b");
    const { sheetResolutionSelect, sheetResolutionHint } = els.chatSettings;
    sheetResolutionSelect.value = "1024";
    sheetResolutionSelect.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(state.currentChat?.settings.sheetResolution).toBe(1024));
    expect((await store.getChat("chat"))?.settings.sheetResolution).toBe(1024);
    expect(sheetResolutionSelect.value).toBe("1024");
    expect(sheetResolutionHint.hidden).toBe(true);
  });
});

describe("max rounds", () => {
  it("clamps to 1 to 30 and treats blank as the default", () => {
    expect(parseMaxRounds("")).toBeUndefined();
    expect(parseMaxRounds("12")).toBe(12);
    expect(parseMaxRounds("0")).toBe(1);
    expect(parseMaxRounds("99")).toBe(30);
  });

  it("saves the chat's max rounds and clears it when blank", async () => {
    const store = createMemoryStore();
    const chat = blankChat("m", "chat", 1);
    replaceChat(state, chat);
    setCurrentChat(state, chat, []);
    initChatSettings(els, state, { store, toast: toast(), onChanged: vi.fn(), onError: vi.fn() });
    const input = els.chatSettings.maxRoundsInput;
    input.value = "12";
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.maxRounds).toBe(12),
    );
    input.value = "";
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings).not.toHaveProperty("maxRounds"),
    );
  });

  it("reports a chat setting that could not be saved", async () => {
    const store = createMemoryStore();
    store.putChat = () => Promise.reject(new Error("Disk full"));
    const chat = blankChat("m", "chat", 1);
    replaceChat(state, chat);
    setCurrentChat(state, chat, []);
    const onError = vi.fn();
    initChatSettings(els, state, { store, toast: toast(), onChanged: vi.fn(), onError });
    els.chatSettings.maxRoundsInput.value = "12";
    els.chatSettings.maxRoundsInput.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Could not save the chat settings: Disk full"),
    );
  });
});

describe("chat settings across chats", () => {
  it("saves a change into the chat it was made in, even after switching chats", async () => {
    const store = createMemoryStore();
    const first = blankChat("m", "chat", 1);
    const second = blankChat("m", "other", 2);
    for (const entry of [first, second]) {
      await store.putChat(entry);
      replaceChat(state, entry);
    }
    setCurrentChat(state, first, []);
    const putChat = store.putChat.bind(store);
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    store.putChat = async (entry) => {
      await gate;
      await putChat(entry);
    };
    initChatSettings(els, state, { store, toast: toast(), onChanged: vi.fn(), onError: vi.fn() });
    const input = els.chatSettings.maxRoundsInput;
    input.value = "12";
    input.dispatchEvent(new Event("change"));
    input.value = "15";
    input.dispatchEvent(new Event("change"));
    setCurrentChat(state, second, []);
    release();
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.maxRounds).toBe(15),
    );
    expect((await store.getChat("other"))?.settings).not.toHaveProperty("maxRounds");
  });
});

describe("Chat settings model", () => {
  it("saves the picked model to the chat and shows it on the trigger", async () => {
    const store = createMemoryStore();
    const chat = blankChat("anon", "chat", 1);
    await store.putChat(chat);
    replaceChat(state, chat);
    setCurrentChat(state, chat, []);
    const onChanged = vi.fn();
    initChatSettings(els, state, { store, toast: toast(), onChanged, onError: vi.fn() });
    const mount = els.chatSettings.modelPicker;
    expect(triggerName(mount)).toBe("anon");
    pickRow(mount, "priv");
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.modelId).toBe("priv"),
    );
    expect(triggerName(mount)).toBe("priv");
    expect(onChanged).toHaveBeenCalled();
  });
});

async function openPersona(askName = vi.fn(() => "Mara")) {
  localStorage.clear();
  const store = createMemoryStore();
  const chat = blankChat("anon", "chat", 1);
  await store.putChat(chat);
  replaceChat(state, chat);
  setCurrentChat(state, chat, []);
  initChatSettings(els, state, {
    store,
    toast: toast(),
    onChanged: vi.fn(),
    onError: vi.fn(),
    askName,
    storage: localStorage,
  });
  return store;
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("change"));
}

describe("Instructions fields", () => {
  it("saves the names and voice and previews the prompt with the names filled in", async () => {
    const store = await openPersona();
    const panel = els.chatSettings;
    type(panel.systemPromptInput, "You are {{char}}, talking with {{user}}.");
    type(panel.characterNameInput, " Mara ");
    expect(panel.promptPreview.textContent).toBe("You are Mara, talking with {{user}}.");
    type(panel.userNameInput, "Sam");
    expect(panel.promptPreview.textContent).toBe("You are Mara, talking with Sam.");
    panel.voiceSelect.value = "narrator";
    panel.voiceSelect.dispatchEvent(new Event("change"));
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings).toMatchObject({
        characterName: "Mara",
        userName: "Sam",
        voice: "narrator",
      }),
    );
    expect(panel.voiceHint.textContent).toBe(VOICE_HINTS.narrator);
  });

  it("drops a cleared name", async () => {
    const store = await openPersona();
    type(els.chatSettings.characterNameInput, "Mara");
    await vi.waitFor(() => expect(state.currentChat?.settings.characterName).toBe("Mara"));
    type(els.chatSettings.characterNameInput, "  ");
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings).not.toHaveProperty("characterName"),
    );
  });
});

describe("Refer to the video", () => {
  it("shows the voice's default until the user picks another", async () => {
    const store = await openPersona();
    const panel = els.chatSettings;
    expect(panel.videoReferencesSelect.value).toBe(effectiveVideoReferences({}));
    panel.voiceSelect.value = "narrator";
    panel.voiceSelect.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(state.currentChat?.settings.voice).toBe("narrator"));
    expect(panel.videoReferencesSelect.value).toBe(effectiveVideoReferences({ voice: "narrator" }));
    const picked = effectiveVideoReferences({ voice: "narrator" }) === "none" ? "free" : "none";
    panel.videoReferencesSelect.value = picked;
    panel.videoReferencesSelect.dispatchEvent(new Event("change"));
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.videoReferences).toBe(picked),
    );
  });

  it("leaves the field unset when the default is picked", async () => {
    const store = await openPersona();
    const panel = els.chatSettings;
    panel.videoReferencesSelect.dispatchEvent(new Event("change"));
    type(panel.systemPromptInput, "After");
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.systemPrompt).toBe("After"),
    );
    expect(state.currentChat?.settings).not.toHaveProperty("videoReferences");
  });
});

describe("Earlier images", () => {
  it("shows describe for a chat that never set it, and saves a change", async () => {
    const store = await openPersona();
    const select = els.chatSettings.earlierImagesSelect;
    expect(select.value).toBe("describe");
    select.value = "send";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.earlierImages).toBe("send"),
    );
    select.value = "describe";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.earlierImages).toBe("describe"),
    );
  });

  it("leaves the field unset when the default is picked", async () => {
    const store = await openPersona();
    const panel = els.chatSettings;
    panel.earlierImagesSelect.dispatchEvent(new Event("change"));
    type(panel.systemPromptInput, "After");
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.systemPrompt).toBe("After"),
    );
    expect(state.currentChat?.settings).not.toHaveProperty("earlierImages");
  });
});

describe("Roleplay names", () => {
  it("starts folded for a chat without names", async () => {
    await openPersona();
    expect(els.chatSettings.roleplayNames.open).toBe(false);
  });

  it("opens when the voice is set to In character", async () => {
    await openPersona();
    const panel = els.chatSettings;
    panel.voiceSelect.value = "character";
    panel.voiceSelect.dispatchEvent(new Event("change"));
    expect(panel.roleplayNames.open).toBe(true);
  });

  it("starts open for a chat with a name set", async () => {
    localStorage.clear();
    const store = createMemoryStore();
    const chat = blankChat("anon", "named", 1);
    const named = { ...chat, settings: { ...chat.settings, userName: "Sam" } };
    await store.putChat(named);
    replaceChat(state, named);
    setCurrentChat(state, named, []);
    initChatSettings(els, state, { store, toast: toast(), onChanged: vi.fn(), onError: vi.fn() });
    expect(els.chatSettings.roleplayNames.open).toBe(true);
  });
});

describe("Saved presets", () => {
  it("saves the form as a named preset and selects it", async () => {
    const askName = vi.fn(() => " Mara ");
    await openPersona(askName);
    const panel = els.chatSettings;
    panel.systemPromptInput.value = "You are {{char}}.";
    panel.characterNameInput.value = "Mara";
    panel.savePersonaButton.click();
    expect(askName).toHaveBeenCalledWith("Mara");
    const [saved] = listPersonas(localStorage);
    expect(saved).toMatchObject({
      name: "Mara",
      systemPrompt: "You are {{char}}.",
      characterName: "Mara",
    });
    expect(panel.personaSelect.value).toBe(saved?.id);
    expect(panel.updatePersonaButton.disabled).toBe(false);
    expect(els.toast.text.textContent).toBe("Saved preset Mara");
  });

  it("applies a saved preset to the chat and undoes it", async () => {
    await openPersona();
    savePersona(
      { id: "p1", name: "Narrator", systemPrompt: "Tell it as a story.", voice: "narrator" },
      localStorage,
    );
    const panel = els.chatSettings;
    panel.systemPromptInput.value = "Before";
    panel.systemPromptInput.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(state.currentChat?.settings.systemPrompt).toBe("Before"));
    panel.personaSelect.replaceChildren(new Option("Narrator", "p1"));
    panel.personaSelect.value = "p1";
    panel.personaSelect.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(state.currentChat?.settings).toMatchObject({
        systemPrompt: "Tell it as a story.",
        voice: "narrator",
      }),
    );
    expect(els.toast.text.textContent).toBe("Applied Narrator");
    els.toast.action.click();
    await vi.waitFor(() => expect(state.currentChat?.settings.systemPrompt).toBe("Before"));
    expect(state.currentChat?.settings).not.toHaveProperty("voice");
  });
});

describe("Saved preset changes", () => {
  it("updates the selected preset from the form", async () => {
    await openPersona();
    const panel = els.chatSettings;
    panel.systemPromptInput.value = "First";
    panel.savePersonaButton.click();
    panel.systemPromptInput.value = "Second";
    panel.updatePersonaButton.click();
    expect(listPersonas(localStorage).map((persona) => persona.systemPrompt)).toEqual(["Second"]);
  });

  it("deletes the selected preset and brings it back with Undo", async () => {
    await openPersona();
    els.chatSettings.savePersonaButton.click();
    els.chatSettings.deletePersonaButton.click();
    expect(listPersonas(localStorage)).toEqual([]);
    expect(els.chatSettings.deletePersonaButton.disabled).toBe(true);
    els.toast.action.click();
    expect(listPersonas(localStorage).map((persona) => persona.name)).toEqual(["Mara"]);
    expect(els.chatSettings.personaSelect.value).not.toBe("");
  });
});
