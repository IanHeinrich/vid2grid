import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveVideoReferences } from "../src/chat/prompts";
import { listPersonas, savePersona, type Persona } from "../src/chat/personas";
import type { AppElements } from "../src/dom";
import { VOICE_HINTS } from "../src/ui/personaFields";
import { initPresetManager, type PresetManager } from "../src/ui/presetManager";
import { mountPage, stillToast } from "./support/page";

let els: AppElements;
let onApply: ReturnType<typeof vi.fn>;
let onChanged: ReturnType<typeof vi.fn>;

const mara: Persona = {
  id: "p1",
  name: "Mara",
  systemPrompt: "You are {{char}}.",
  characterName: "Mara",
  voice: "character",
};

const analyst: Persona = { id: "p2", name: "Analyst", systemPrompt: "Be precise." };

function setup(presets: Persona[] = [mara, analyst]): PresetManager {
  for (const preset of presets) savePersona(preset, localStorage);
  return initPresetManager(els, {
    toast: stillToast(els),
    storage: localStorage,
    onApply,
    onChanged,
  });
}

function listed(): string[] {
  return [...els.presetManager.list.querySelectorAll(".preset-item")].map(
    (item) => item.textContent ?? "",
  );
}

function current(): string | null | undefined {
  return els.presetManager.list.querySelector('[aria-current="true"]')?.textContent;
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("change"));
}

function pick(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

beforeEach(() => {
  els = mountPage();
  localStorage.clear();
  onApply = vi.fn();
  onChanged = vi.fn();
  els.presetManager.dialog.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  els.presetManager.dialog.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe("opening", () => {
  it("lists the presets and edits the one asked for", () => {
    setup().open({ presetId: "p2" });
    const { dialog, nameInput, systemPromptInput } = els.presetManager;
    expect(dialog.open).toBe(true);
    expect(listed()).toEqual(["Mara", "Analyst"]);
    expect(current()).toBe("Analyst");
    expect(nameInput.value).toBe("Analyst");
    expect(systemPromptInput.value).toBe("Be precise.");
  });

  it("starts on the first preset and focuses the name when asked", () => {
    setup().open({ focusName: true });
    expect(current()).toBe("Mara");
    expect(document.activeElement).toBe(els.presetManager.nameInput);
  });

  it("fills the editor from the preset", () => {
    setup().open();
    const panel = els.presetManager;
    expect(panel.characterNameInput.value).toBe("Mara");
    expect(panel.userNameInput.value).toBe("");
    expect(panel.voiceSelect.value).toBe("character");
    expect(panel.voiceHint.textContent).toBe(VOICE_HINTS.character);
    expect(panel.videoReferencesSelect.value).toBe(effectiveVideoReferences(mara));
  });

  it("says there are no presets and offers only New", () => {
    setup([]).open();
    const panel = els.presetManager;
    expect(panel.empty.hidden).toBe(false);
    expect(panel.editor.hidden).toBe(true);
    expect(panel.duplicateButton.disabled).toBe(true);
    expect(panel.deleteButton.disabled).toBe(true);
    expect(panel.applyButton.disabled).toBe(true);
    expect(panel.newButton.disabled).toBe(false);
  });

  it("switches the editor to a clicked preset", () => {
    setup().open();
    els.presetManager.list.querySelectorAll<HTMLButtonElement>(".preset-item")[1]?.click();
    expect(current()).toBe("Analyst");
    expect(els.presetManager.nameInput.value).toBe("Analyst");
  });
});

describe("editing", () => {
  it("renames a preset in place, keeping its id", () => {
    setup().open();
    type(els.presetManager.nameInput, " Mara the guide ");
    expect(listPersonas(localStorage).map(({ id, name }) => [id, name])).toEqual([
      ["p1", "Mara the guide"],
      ["p2", "Analyst"],
    ]);
    expect(listed()).toEqual(["Mara the guide", "Analyst"]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("keeps the old name when the name is cleared", () => {
    setup().open();
    type(els.presetManager.nameInput, "  ");
    expect(listPersonas(localStorage)[0]?.name).toBe("Mara");
    expect(els.presetManager.nameInput.value).toBe("Mara");
  });

  it("saves the prompt, names and voice on change", () => {
    setup().open();
    const panel = els.presetManager;
    type(panel.systemPromptInput, "You are {{char}}, with {{user}}.");
    type(panel.characterNameInput, "  ");
    type(panel.userNameInput, " Sam ");
    pick(panel.voiceSelect, "narrator");
    expect(listPersonas(localStorage)[0]).toEqual({
      id: "p1",
      name: "Mara",
      systemPrompt: "You are {{char}}, with {{user}}.",
      userName: "Sam",
      voice: "narrator",
    });
    expect(panel.voiceHint.textContent).toBe(VOICE_HINTS.narrator);
  });

  it("leaves Refer to the video unset when the voice's default is picked", () => {
    setup().open({ presetId: "p2" });
    const select = els.presetManager.videoReferencesSelect;
    pick(select, effectiveVideoReferences({}));
    expect(listPersonas(localStorage)[1]).toEqual(analyst);
    const other = effectiveVideoReferences({}) === "none" ? "free" : "none";
    pick(select, other);
    expect(listPersonas(localStorage)[1]?.videoReferences).toBe(other);
  });
});

describe("New and Duplicate", () => {
  it("adds a blank preset, selects it and focuses its name", () => {
    setup().open();
    els.presetManager.newButton.click();
    const added = listPersonas(localStorage)[2];
    expect(added).toMatchObject({ name: "New preset", systemPrompt: "" });
    expect(added?.id).not.toBe("");
    expect(current()).toBe("New preset");
    expect(document.activeElement).toBe(els.presetManager.nameInput);
  });

  it("copies the selected preset under a new id", () => {
    setup().open();
    els.presetManager.duplicateButton.click();
    const copy = listPersonas(localStorage)[2];
    expect(copy).toEqual({ ...mara, id: copy?.id, name: "Mara copy" });
    expect(copy?.id).not.toBe("p1");
    expect(current()).toBe("Mara copy");
  });
});

describe("Delete", () => {
  it("removes the selected preset, moves to the next and brings it back with Undo", () => {
    setup().open();
    els.presetManager.deleteButton.click();
    expect(listPersonas(localStorage)).toEqual([analyst]);
    expect(current()).toBe("Analyst");
    expect(els.toast.text.textContent).toBe("Deleted preset Mara");
    els.toast.action.click();
    expect(listPersonas(localStorage).map((persona) => persona.id)).toEqual(["p2", "p1"]);
    expect(current()).toBe("Mara");
  });

  it("shows the empty state once the last preset is gone", () => {
    setup([analyst]).open();
    els.presetManager.deleteButton.click();
    expect(els.presetManager.empty.hidden).toBe(false);
    expect(els.presetManager.editor.hidden).toBe(true);
  });
});

describe("Apply to this chat", () => {
  it("closes and hands over the selected preset", () => {
    setup().open({ presetId: "p2" });
    els.presetManager.applyButton.click();
    expect(els.presetManager.dialog.open).toBe(false);
    expect(onApply).toHaveBeenCalledWith(analyst);
  });
});
