import type { ChatSettings, VideoReferences, Voice } from "../types";
import { effectiveVideoReferences } from "./prompts";

const STORAGE_KEY = "vid2grid-chat-personas";
const VOICES: readonly Voice[] = ["analyst", "character", "narrator"];
const VIDEO_REFERENCES: readonly VideoReferences[] = ["free", "few", "none"];

export interface Persona {
  id: string;
  name: string;
  systemPrompt: string;
  characterName?: string;
  userName?: string;
  voice?: Voice;
  videoReferences?: VideoReferences;
}

function readStored(storage: Storage): unknown[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type StoredPersona = Partial<Record<keyof Persona, unknown>>;

function storedPersona(value: unknown): StoredPersona {
  return typeof value === "object" && value !== null ? value : {};
}

function personaFrom(value: unknown): Persona | undefined {
  const { id, name, systemPrompt, characterName, userName, voice, videoReferences } =
    storedPersona(value);
  if (typeof id !== "string" || typeof name !== "string" || typeof systemPrompt !== "string") {
    return undefined;
  }
  const knownVoice = VOICES.find((known) => known === voice);
  const knownReferences = VIDEO_REFERENCES.find((known) => known === videoReferences);
  return {
    id,
    name,
    systemPrompt,
    ...(typeof characterName === "string" && { characterName }),
    ...(typeof userName === "string" && { userName }),
    ...(knownVoice !== undefined && { voice: knownVoice }),
    ...(knownReferences !== undefined && { videoReferences: knownReferences }),
  };
}

export function listPersonas(storage: Storage = localStorage): Persona[] {
  return readStored(storage).flatMap((value) => personaFrom(value) ?? []);
}

function writePersonas(personas: Persona[], storage: Storage): Persona[] {
  storage.setItem(STORAGE_KEY, JSON.stringify(personas));
  return personas;
}

export function savePersona(persona: Persona, storage: Storage = localStorage): Persona[] {
  const personas = listPersonas(storage);
  const index = personas.findIndex((existing) => existing.id === persona.id);
  if (index === -1) personas.push(persona);
  else personas[index] = persona;
  return writePersonas(personas, storage);
}

export function deletePersona(id: string, storage: Storage = localStorage): Persona[] {
  return writePersonas(
    listPersonas(storage).filter((persona) => persona.id !== id),
    storage,
  );
}

type CharacterFields = Pick<
  ChatSettings,
  "characterName" | "userName" | "voice" | "videoReferences"
>;

function characterFields({
  characterName,
  userName,
  voice,
  videoReferences,
}: CharacterFields): CharacterFields {
  return {
    ...(characterName !== undefined && { characterName }),
    ...(userName !== undefined && { userName }),
    ...(voice !== undefined && { voice }),
    ...(videoReferences !== undefined && { videoReferences }),
  };
}

export function withName<T extends CharacterFields>(
  fields: T,
  key: "characterName" | "userName",
  raw: string,
): T {
  const next = { ...fields };
  const name = raw.trim();
  if (name === "") delete next[key];
  else next[key] = name;
  return next;
}

// Left unset, the choice keeps following the voice's default.
export function withVideoReferences<T extends CharacterFields>(
  fields: T,
  references: VideoReferences,
): T {
  if (fields.videoReferences === undefined && references === effectiveVideoReferences(fields)) {
    return fields;
  }
  return { ...fields, videoReferences: references };
}

export function personaFromChat(
  settings: ChatSettings,
  name = settings.characterName ?? "Untitled preset",
  id: string = crypto.randomUUID(),
): Persona {
  return { id, name, systemPrompt: settings.systemPrompt, ...characterFields(settings) };
}

function withoutPresetFields(settings: ChatSettings): ChatSettings {
  const rest = { ...settings };
  delete rest.characterName;
  delete rest.userName;
  delete rest.voice;
  delete rest.videoReferences;
  delete rest.presetId;
  return rest;
}

export function applyPersona(settings: ChatSettings, persona: Persona): ChatSettings {
  return {
    ...withoutPresetFields(settings),
    systemPrompt: persona.systemPrompt,
    ...characterFields(persona),
    presetId: persona.id,
  };
}

export function restorePresetFields(settings: ChatSettings, before: ChatSettings): ChatSettings {
  return {
    ...withoutPresetFields(settings),
    systemPrompt: before.systemPrompt,
    ...characterFields(before),
    ...(before.presetId !== undefined && { presetId: before.presetId }),
  };
}

// Compares what the fields mean, so an unset voice matches an explicit Analyst.
export function personaMatches(persona: Persona, settings: ChatSettings): boolean {
  return (
    persona.systemPrompt === settings.systemPrompt &&
    (persona.characterName ?? "") === (settings.characterName ?? "") &&
    (persona.userName ?? "") === (settings.userName ?? "") &&
    (persona.voice ?? "analyst") === (settings.voice ?? "analyst") &&
    effectiveVideoReferences(persona) === effectiveVideoReferences(settings)
  );
}

// A blank prompt matches nothing, so a new chat never looks like it came from a preset.
export function chatPersona(
  settings: ChatSettings,
  personas: readonly Persona[],
): Persona | undefined {
  if (settings.presetId !== undefined) {
    return personas.find((persona) => persona.id === settings.presetId);
  }
  if (settings.systemPrompt.trim() === "") return undefined;
  return personas.find((persona) => personaMatches(persona, settings));
}
