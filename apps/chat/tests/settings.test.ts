import { beforeEach, describe, expect, it } from "vitest";
import { VENICE_BASE_URL } from "../src/api/client";
import {
  DEFAULT_BACKGROUND_SOUND_LABELS,
  DEFAULT_SETTINGS,
  DEFAULT_SOUND_LABELS,
  loadSettings,
  saveSettings,
} from "../src/settings";

const KEY = "vid2grid-chat-settings";

beforeEach(() => {
  localStorage.clear();
});

describe("loadSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings(localStorage)).toEqual({
      apiKey: "",
      baseUrl: VENICE_BASE_URL,
      privateOnly: true,
      defaultModelId: "qwen3-6-27b",
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
        privateOnly: "no",
        fallbackMaxImages: 0,
        showThinking: "yes",
      }),
    );
    expect(loadSettings(localStorage)).toEqual(DEFAULT_SETTINGS);
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
