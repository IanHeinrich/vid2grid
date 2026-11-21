import { beforeEach, describe, expect, it } from "vitest";
import { VENICE_BASE_URL } from "../src/api/client";
import {
  DEFAULT_BACKGROUND_SOUND_LABELS,
  DEFAULT_SETTINGS,
  DEFAULT_SOUND_LABELS,
  keyFor,
  loadSettings,
  saveSettings,
  withKey,
} from "../src/settings";

const KEY = "vid2grid-chat-settings";

beforeEach(() => {
  localStorage.clear();
});

describe("loadSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings(localStorage)).toEqual({
      apiKey: "",
      baseUrl: "",
      apiKeys: {},
      privateOnly: true,
      defaultModelId: "",
      fallbackMaxImages: 10,
      showThinking: false,
      keepVideoCopies: true,
      askAboveBytes: 4 * 1024 ** 3,
      favouriteModels: [],
      soundLabels: DEFAULT_SOUND_LABELS,
      backgroundSoundLabels: DEFAULT_BACKGROUND_SOUND_LABELS,
    });
  });

  it("round-trips what saveSettings stored", () => {
    const settings = {
      apiKey: "secret",
      baseUrl: "http://localhost:11434/v1",
      apiKeys: { "http://localhost:11434/v1": "secret", "https://api.venice.ai/api/v1": "vkey" },
      privateOnly: false,
      defaultModelId: "llava",
      fallbackMaxImages: 4,
      showThinking: true,
      keepVideoCopies: false,
      askAboveBytes: 1024,
      favouriteModels: ["qwen"],
      soundLabels: ["music", "a kettle whistling"],
      backgroundSoundLabels: [],
    };
    saveSettings(settings, localStorage);
    expect(loadSettings(localStorage)).toEqual(settings);
  });

  it("falls back to the defaults for unreadable JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadSettings(localStorage)).toEqual(DEFAULT_SETTINGS);
  });

  it("replaces each malformed field with its default", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        apiKey: 5,
        baseUrl: " ",
        apiKeys: ["key"],
        privateOnly: "no",
        fallbackMaxImages: 0,
        showThinking: "yes",
      }),
    );
    expect(loadSettings(localStorage)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("loadSettings base URL", () => {
  it("keeps Venice for settings saved with a key but no base URL", () => {
    localStorage.setItem(KEY, JSON.stringify({ apiKey: "secret" }));
    expect(loadSettings(localStorage)).toMatchObject({
      baseUrl: VENICE_BASE_URL,
      apiKeys: { [VENICE_BASE_URL]: "secret" },
    });
    localStorage.setItem(KEY, JSON.stringify({ apiKey: "secret", baseUrl: " " }));
    expect(loadSettings(localStorage).baseUrl).toBe(VENICE_BASE_URL);
  });

  it("keeps a blank base URL blank once the settings were saved by this version", () => {
    saveSettings({ ...DEFAULT_SETTINGS, apiKey: "secret", baseUrl: "" }, localStorage);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ settingsVersion: 2 });
    expect(loadSettings(localStorage).baseUrl).toBe("");
  });

  it("leaves the base URL unset when no key was saved either", () => {
    localStorage.setItem(KEY, JSON.stringify({ privateOnly: false }));
    expect(loadSettings(localStorage).baseUrl).toBe("");
  });

  it("keeps a stored base URL and default model as they are", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        apiKey: "secret",
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModelId: "qwen3-6-27b",
      }),
    );
    const loaded = loadSettings(localStorage);
    expect(loaded.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(loaded.defaultModelId).toBe("qwen3-6-27b");
  });
});

describe("keys per base URL", () => {
  it("files a key under its base URL, ignoring a trailing slash, and drops a cleared one", () => {
    const keys = withKey({}, "https://openrouter.ai/api/v1/", "or-key");
    expect(keys).toEqual({ "https://openrouter.ai/api/v1": "or-key" });
    expect(keyFor(keys, " https://openrouter.ai/api/v1 ")).toBe("or-key");
    expect(keyFor(keys, VENICE_BASE_URL)).toBe("");
    expect(withKey(keys, "https://openrouter.ai/api/v1", "")).toEqual({});
    expect(withKey(keys, " ", "stray")).toEqual(keys);
  });

  it("keeps only string keys from storage and adds the current key", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        settingsVersion: 2,
        apiKey: "local-key",
        baseUrl: "http://localhost:1234/v1",
        apiKeys: { [VENICE_BASE_URL]: "vkey", "https://api.openai.com/v1": 7 },
      }),
    );
    expect(loadSettings(localStorage).apiKeys).toEqual({
      [VENICE_BASE_URL]: "vkey",
      "http://localhost:1234/v1": "local-key",
    });
  });
});

describe("loadSettings sound labels", () => {
  it("defaults to everyday sounds, with speech, silence and background noise as background", () => {
    expect(DEFAULT_SOUND_LABELS).toEqual([
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
    ]);
    expect(DEFAULT_BACKGROUND_SOUND_LABELS).toEqual(["speech", "silence", "background noise"]);
  });

  it("gives settings saved before sound labels existed the default labels", () => {
    localStorage.setItem(KEY, JSON.stringify({ apiKey: "secret", favouriteModels: [] }));
    const loaded = loadSettings(localStorage);
    expect(loaded.soundLabels).toEqual(DEFAULT_SOUND_LABELS);
    expect(loaded.backgroundSoundLabels).toEqual(DEFAULT_BACKGROUND_SOUND_LABELS);
  });

  it("keeps only non-empty sound labels, trimmed", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ soundLabels: [" music ", "", 4, "rain"], backgroundSoundLabels: "silence" }),
    );
    const loaded = loadSettings(localStorage);
    expect(loaded.soundLabels).toEqual(["music", "rain"]);
    expect(loaded.backgroundSoundLabels).toEqual(DEFAULT_BACKGROUND_SOUND_LABELS);
  });
});
