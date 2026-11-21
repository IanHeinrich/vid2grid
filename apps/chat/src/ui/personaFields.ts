import { withName, withVideoReferences } from "../chat/personas";
import { effectiveVideoReferences } from "../chat/prompts";
import type { ChatSettings, VideoReferences, Voice } from "../types";

export const VOICE_HINTS: Record<Voice, string> = {
  analyst: "Plain, direct answers about what the video shows.",
  character: "Stays in character, as if what the video shows happened in the scene.",
  narrator: "Tells what happens as third-person prose.",
};

const VOICES: readonly Voice[] = ["analyst", "character", "narrator"];
const VIDEO_REFERENCES: readonly VideoReferences[] = ["free", "few", "none"];

export interface PersonaInputs {
  systemPromptInput: HTMLTextAreaElement;
  characterNameInput: HTMLInputElement;
  userNameInput: HTMLInputElement;
  voiceSelect: HTMLSelectElement;
  voiceHint: HTMLElement;
  videoReferencesSelect: HTMLSelectElement;
}

export type PersonaFields = Pick<
  ChatSettings,
  "systemPrompt" | "characterName" | "userName" | "voice" | "videoReferences"
>;

export type PersonaEdit = <T extends PersonaFields>(fields: T) => T;

export function readVoice(inputs: PersonaInputs): Voice | undefined {
  return VOICES.find((known) => known === inputs.voiceSelect.value);
}

export function readVideoReferences(inputs: PersonaInputs): VideoReferences | undefined {
  return VIDEO_REFERENCES.find((known) => known === inputs.videoReferencesSelect.value);
}

export function listenToPersonaFields(
  inputs: PersonaInputs,
  onChange: (edit: PersonaEdit) => void,
): void {
  inputs.systemPromptInput.addEventListener("change", () => {
    const systemPrompt = inputs.systemPromptInput.value;
    onChange((fields) => ({ ...fields, systemPrompt }));
  });
  for (const [input, key] of [
    [inputs.characterNameInput, "characterName"],
    [inputs.userNameInput, "userName"],
  ] as const) {
    input.addEventListener("change", () => {
      const name = input.value;
      onChange((fields) => withName(fields, key, name));
    });
  }
  inputs.voiceSelect.addEventListener("change", () => {
    const voice = readVoice(inputs);
    if (voice) onChange((fields) => ({ ...fields, voice }));
  });
  inputs.videoReferencesSelect.addEventListener("change", () => {
    const references = readVideoReferences(inputs);
    if (references) onChange((fields) => withVideoReferences(fields, references));
  });
}

// A focused field keeps what is being typed, unless that was typed for the chat before a switch.
export function setUnlessFocused(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  switched = false,
): void {
  if (switched || document.activeElement !== input) input.value = value;
}

export function renderPersonaFields(
  inputs: PersonaInputs,
  fields: PersonaFields,
  switched = false,
): void {
  setUnlessFocused(inputs.systemPromptInput, fields.systemPrompt, switched);
  setUnlessFocused(inputs.characterNameInput, fields.characterName ?? "", switched);
  setUnlessFocused(inputs.userNameInput, fields.userName ?? "", switched);
  const voice = fields.voice ?? "analyst";
  inputs.voiceSelect.value = voice;
  inputs.voiceHint.textContent = VOICE_HINTS[voice];
  inputs.videoReferencesSelect.value = effectiveVideoReferences(fields);
}
