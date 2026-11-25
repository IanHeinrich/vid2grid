import { VENICE_BASE_URL, normaliseBaseUrl } from "./api/venice";

const STORAGE_KEY = "vid2grid-chat-settings";
// Version 2 is the first that may leave the base URL unset.
const SETTINGS_VERSION = 2;

export interface GlobalSettings {
  apiKey: string;
  baseUrl: string;
  // Every key the user has saved, by base URL, so switching servers never sends one to another host.
  apiKeys: Record<string, string>;
  privateOnly: boolean;
  defaultModelId: string;
  // Given to new chats as their looking model; empty means none.
  defaultLookingModelId: string;
  // The server that model was picked on.
  defaultLookingBaseUrl: string;
  // The looking model's own server, with its key in apiKeys; empty means the chat's server.
  lookingBaseUrl: string;
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
  baseUrl: "",
  apiKeys: {},
  privateOnly: true,
  defaultModelId: "",
  defaultLookingModelId: "",
  defaultLookingBaseUrl: "",
  lookingBaseUrl: "",
  fallbackMaxImages: 10,
  showThinking: false,
  keepVideoCopies: true,
  askAboveBytes: 4 * 1024 ** 3,
  favouriteModels: [],
  soundLabels: [...DEFAULT_SOUND_LABELS],
  backgroundSoundLabels: [...DEFAULT_BACKGROUND_SOUND_LABELS],
};

type Stored = Partial<Record<keyof GlobalSettings | "settingsVersion", unknown>>;

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

export function keyFor(keys: Readonly<Record<string, string>>, baseUrl: string): string {
  return keys[normaliseBaseUrl(baseUrl)] ?? "";
}

export function withKey(
  keys: Readonly<Record<string, string>>,
  baseUrl: string,
  apiKey: string,
): Record<string, string> {
  const next = { ...keys };
  const url = normaliseBaseUrl(baseUrl);
  if (url === "") return next;
  if (apiKey === "") delete next[url];
  else next[url] = apiKey;
  return next;
}

function keysOr(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
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

// Venice was the default before version 2, so a key saved then without a base URL is a Venice key.
function storedBaseUrl(stored: Stored, apiKey: string): string {
  if (stored.settingsVersion === SETTINGS_VERSION) return stringOr(stored.baseUrl, "").trim();
  const fallback = apiKey.trim() === "" ? DEFAULT_SETTINGS.baseUrl : VENICE_BASE_URL;
  return nonEmptyStringOr(stored.baseUrl, fallback);
}

export function loadSettings(storage: Storage = localStorage): GlobalSettings {
  const stored = readStored(storage);
  const apiKey = stringOr(stored.apiKey, DEFAULT_SETTINGS.apiKey);
  const baseUrl = storedBaseUrl(stored, apiKey);
  return {
    apiKey,
    baseUrl,
    apiKeys: withKey(keysOr(stored.apiKeys), baseUrl, apiKey),
    privateOnly:
      typeof stored.privateOnly === "boolean" ? stored.privateOnly : DEFAULT_SETTINGS.privateOnly,
    defaultModelId: nonEmptyStringOr(stored.defaultModelId, DEFAULT_SETTINGS.defaultModelId),
    defaultLookingModelId: stringOr(stored.defaultLookingModelId, "").trim(),
    defaultLookingBaseUrl: stringOr(stored.defaultLookingBaseUrl, "").trim(),
    lookingBaseUrl: stringOr(stored.lookingBaseUrl, "").trim(),
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
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, settingsVersion: SETTINGS_VERSION }));
}
