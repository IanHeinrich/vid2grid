import type { ChatSettings, VideoReferences, Voice } from "../types";

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

export function personaFromChat(
  settings: ChatSettings,
  name = settings.characterName ?? "Untitled persona",
  id: string = crypto.randomUUID(),
): Persona {
  return { id, name, systemPrompt: settings.systemPrompt, ...characterFields(settings) };
}

export function applyPersona(settings: ChatSettings, persona: Persona): ChatSettings {
  const applied: ChatSettings = { ...settings, systemPrompt: persona.systemPrompt };
  delete applied.characterName;
  delete applied.userName;
  delete applied.voice;
  delete applied.videoReferences;
  return { ...applied, ...characterFields(persona) };
}
