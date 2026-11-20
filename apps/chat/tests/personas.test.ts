import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPersona,
  deletePersona,
  listPersonas,
  personaFromChat,
  savePersona,
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
  it("replaces the prompt and character fields and keeps the rest", () => {
    expect(applyPersona(settings, analyst)).toEqual({
      systemPrompt: "Be precise.",
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
      modelId: "model",
      sheetResolution: "auto",
    });
  });

  it("does not change the settings it was given", () => {
    applyPersona(settings, analyst);
    expect(settings.characterName).toBe("Mara");
  });
});
