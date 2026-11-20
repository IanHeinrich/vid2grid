import { VENICE_BASE_URL } from "./api/client";

const STORAGE_KEY = "vid2grid-chat-settings";

export interface GlobalSettings {
  apiKey: string;
  baseUrl: string;
  privateOnly: boolean;
  defaultModelId: string;
  fallbackMaxImages: number;
  showThinking: boolean;
  keepVideoCopies: boolean;
  askAboveBytes: number;
  favouriteModels: string[];
  soundLabels: string[];
  // Scored so a quiet stretch is not forced onto one of the sound labels; never reported.
  backgroundSoundLabels: string[];
}

export const DEFAULT_SOUND_LABELS: readonly string[] = [
  "laughter",
  "applause",
  "music",
  "singing",
  "footsteps",
  "door closing",
  "dog barking",
  "phone ringing",
  "traffic",
  "keyboard typing",
  "water running",
  "car horn",
];

// Speech is in the transcript already, so as a reported label it would only crowd the lines out.
export const DEFAULT_BACKGROUND_SOUND_LABELS: readonly string[] = [
  "speech",
  "silence",
  "background noise",
];

export const DEFAULT_SETTINGS: GlobalSettings = {
  apiKey: "",
  baseUrl: VENICE_BASE_URL,
  privateOnly: true,
  defaultModelId: "qwen3-6-27b",
  fallbackMaxImages: 10,
  showThinking: false,
  keepVideoCopies: true,
  askAboveBytes: 4 * 1024 ** 3,
  favouriteModels: [],
  soundLabels: [...DEFAULT_SOUND_LABELS],
  backgroundSoundLabels: [...DEFAULT_BACKGROUND_SOUND_LABELS],
};

type Stored = Partial<Record<keyof GlobalSettings, unknown>>;

function readStored(storage: Storage): Stored {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nonEmptyStringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function positiveIntegerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function labelsOr(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.flatMap((label) =>
    typeof label === "string" && label.trim() !== "" ? [label.trim()] : [],
  );
}

export function loadSettings(storage: Storage = localStorage): GlobalSettings {
  const stored = readStored(storage);
  return {
    apiKey: stringOr(stored.apiKey, DEFAULT_SETTINGS.apiKey),
    baseUrl: nonEmptyStringOr(stored.baseUrl, DEFAULT_SETTINGS.baseUrl),
    privateOnly:
      typeof stored.privateOnly === "boolean" ? stored.privateOnly : DEFAULT_SETTINGS.privateOnly,
    defaultModelId: nonEmptyStringOr(stored.defaultModelId, DEFAULT_SETTINGS.defaultModelId),
    fallbackMaxImages: positiveIntegerOr(
      stored.fallbackMaxImages,
      DEFAULT_SETTINGS.fallbackMaxImages,
    ),
    showThinking:
      typeof stored.showThinking === "boolean"
        ? stored.showThinking
        : DEFAULT_SETTINGS.showThinking,
    keepVideoCopies:
      typeof stored.keepVideoCopies === "boolean"
        ? stored.keepVideoCopies
        : DEFAULT_SETTINGS.keepVideoCopies,
    askAboveBytes: positiveIntegerOr(stored.askAboveBytes, DEFAULT_SETTINGS.askAboveBytes),
    favouriteModels: Array.isArray(stored.favouriteModels)
      ? stored.favouriteModels.filter((id): id is string => typeof id === "string")
      : [],
    soundLabels: labelsOr(stored.soundLabels, DEFAULT_SOUND_LABELS),
    backgroundSoundLabels: labelsOr(stored.backgroundSoundLabels, DEFAULT_BACKGROUND_SOUND_LABELS),
  };
}

export function saveSettings(settings: GlobalSettings, storage: Storage = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
