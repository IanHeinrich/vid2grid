import { beforeEach, describe, expect, it } from "vitest";
import { effectiveVideoReferences } from "../src/chat/prompts";
import {
  applyPersona,
  chatPersona,
  deletePersona,
  listPersonas,
  personaFromChat,
  personaMatches,
  restorePresetFields,
  savePersona,
  withName,
  withVideoReferences,
  type Persona,
} from "../src/chat/personas";
import type { ChatSettings } from "../src/types";

const KEY = "vid2grid-chat-personas";

const mara: Persona = {
  id: "p1",
  name: "Mara",
  systemPrompt: "You are {{char}}.",
  characterName: "Mara",
  userName: "Sam",
  voice: "character",
  videoReferences: "none",
};

const analyst: Persona = { id: "p2", name: "Analyst", systemPrompt: "Be precise." };

beforeEach(() => {
  localStorage.clear();
});

describe("listPersonas", () => {
  it("is empty when nothing is stored", () => {
    expect(listPersonas(localStorage)).toEqual([]);
  });

  it("tolerates corrupt storage", () => {
    localStorage.setItem(KEY, "{not json");
    expect(listPersonas(localStorage)).toEqual([]);
    localStorage.setItem(KEY, '{"id":"p1"}');
    expect(listPersonas(localStorage)).toEqual([]);
  });

  it("drops damaged entries and invalid fields", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        null,
        { id: "p3", name: 7, systemPrompt: "" },
        {
          id: "p4",
          name: "Odd",
          systemPrompt: "",
          voice: "pirate",
          videoReferences: "lots",
          userName: 3,
        },
        analyst,
      ]),
    );
    expect(listPersonas(localStorage)).toEqual([
      { id: "p4", name: "Odd", systemPrompt: "" },
      analyst,
    ]);
  });
});

describe("savePersona and deletePersona", () => {
  it("inserts, updates by id and deletes", () => {
    expect(savePersona(mara, localStorage)).toEqual([mara]);
    savePersona(analyst, localStorage);
    const renamed = { ...mara, name: "Mara 2" };
    expect(savePersona(renamed, localStorage)).toEqual([renamed, analyst]);
    expect(listPersonas(localStorage)).toEqual([renamed, analyst]);
    expect(deletePersona("p1", localStorage)).toEqual([analyst]);
    expect(listPersonas(localStorage)).toEqual([analyst]);
  });

  it("replaces corrupt storage when saving", () => {
    localStorage.setItem(KEY, "garbage");
    expect(savePersona(analyst, localStorage)).toEqual([analyst]);
  });
});

const settings: ChatSettings = {
  systemPrompt: "You are {{char}}.",
  characterName: "Mara",
  userName: "Sam",
  voice: "character",
  videoReferences: "none",
  modelId: "model",
  temperature: 0.7,
  sheetResolution: 1024,
};

describe("personaFromChat", () => {
  it("takes the prompt and character fields from the chat", () => {
    expect(personaFromChat(settings, undefined, "p9")).toEqual({ ...mara, id: "p9" });
  });

  it("leaves the chat's preset id out", () => {
    expect(personaFromChat({ ...settings, presetId: "p1" }, "Copy", "p9")).not.toHaveProperty(
      "presetId",
    );
  });

  it("falls back to a placeholder name without a character name", () => {
    const plain: ChatSettings = { systemPrompt: "", modelId: "model", sheetResolution: "auto" };
    expect(personaFromChat(plain).name).toBe("Untitled preset");
  });

  it("uses the given name and leaves absent fields out", () => {
    const plain: ChatSettings = {
      systemPrompt: "Plain.",
      modelId: "model",
      sheetResolution: "auto",
    };
    const persona = personaFromChat(plain, "Plain");
    expect(persona).toEqual({ id: persona.id, name: "Plain", systemPrompt: "Plain." });
    expect(persona.id).not.toBe("");
  });
});

describe("applyPersona", () => {
  it("replaces the prompt and character fields, records the preset and keeps the rest", () => {
    expect(applyPersona({ ...settings, presetId: "old" }, analyst)).toEqual({
      systemPrompt: "Be precise.",
      presetId: "p2",
      modelId: "model",
      temperature: 0.7,
      sheetResolution: 1024,
    });
    const plain: ChatSettings = { systemPrompt: "", modelId: "model", sheetResolution: "auto" };
    expect(applyPersona(plain, mara)).toEqual({
      systemPrompt: "You are {{char}}.",
      characterName: "Mara",
      userName: "Sam",
      voice: "character",
      videoReferences: "none",
      presetId: "p1",
      modelId: "model",
      sheetResolution: "auto",
    });
  });

  it("does not change the settings it was given", () => {
    applyPersona(settings, analyst);
    expect(settings.characterName).toBe("Mara");
  });
});

describe("restorePresetFields", () => {
  it("puts back the prompt, character fields and preset id from before", () => {
    const before: ChatSettings = { ...settings, presetId: "p1", temperature: 0.2 };
    const applied = applyPersona({ ...settings, temperature: 0.9 }, analyst);
    expect(restorePresetFields(applied, before)).toEqual({
      ...settings,
      presetId: "p1",
      temperature: 0.9,
    });
  });

  it("drops a preset id the chat did not have", () => {
    const applied = applyPersona(settings, analyst);
    expect(restorePresetFields(applied, settings)).toEqual(settings);
  });
});

describe("withName and withVideoReferences", () => {
  it("trims a name and drops a blank one", () => {
    expect(withName(analyst, "userName", " Sam ")).toEqual({ ...analyst, userName: "Sam" });
    expect(withName(mara, "characterName", "  ")).not.toHaveProperty("characterName");
  });

  it("leaves the references unset while they follow the voice's default", () => {
    expect(withVideoReferences(analyst, effectiveVideoReferences({}))).toBe(analyst);
    const other = effectiveVideoReferences({}) === "none" ? "free" : "none";
    expect(withVideoReferences(analyst, other)).toEqual({ ...analyst, videoReferences: other });
  });
});

describe("personaMatches", () => {
  it("matches a chat set up from the preset", () => {
    expect(personaMatches(mara, settings)).toBe(true);
    expect(personaMatches(mara, applyPersona(settings, mara))).toBe(true);
  });

  it("treats unset fields as their defaults", () => {
    const plain: ChatSettings = {
      systemPrompt: "Be precise.",
      voice: "analyst",
      userName: "",
      videoReferences: effectiveVideoReferences({}),
      modelId: "model",
      sheetResolution: "auto",
    };
    expect(personaMatches(analyst, plain)).toBe(true);
  });

  it("sees an edit to any of the preset's fields", () => {
    for (const edit of [
      { systemPrompt: "Other." },
      { characterName: "Ada" },
      { userName: "Kim" },
      { voice: "narrator" as const },
      { videoReferences: "free" as const },
    ]) {
      expect(personaMatches(mara, { ...settings, ...edit })).toBe(false);
    }
  });
});

describe("chatPersona", () => {
  const personas = [analyst, mara];

  it("finds the chat's preset by id, even once edited", () => {
    expect(chatPersona({ ...settings, systemPrompt: "Edited.", presetId: "p1" }, personas)).toBe(
      mara,
    );
  });

  it("finds nothing for a deleted preset", () => {
    expect(chatPersona({ ...settings, presetId: "gone" }, personas)).toBeUndefined();
  });

  it("falls back to a preset whose fields match the chat", () => {
    expect(chatPersona(settings, personas)).toBe(mara);
    expect(chatPersona({ ...settings, systemPrompt: "Other." }, personas)).toBeUndefined();
  });

  it("matches nothing once the chat was set to No preset", () => {
    expect(chatPersona({ ...settings, presetId: "" }, personas)).toBeUndefined();
  });

  it("matches nothing for a blank prompt", () => {
    const blank: Persona = { id: "p3", name: "Blank", systemPrompt: "" };
    const plain: ChatSettings = { systemPrompt: "", modelId: "model", sheetResolution: "auto" };
    expect(chatPersona(plain, [blank])).toBeUndefined();
  });
});
