import { describe, expect, it } from "vitest";
import { blankChat } from "../src/chat/chats";
import {
  chatModelId,
  currentModel,
  defaultModelId,
  effectiveDefaultModelId,
  resolveModel,
  visionModels,
} from "../src/chat/models";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setCurrentChat, setModels } from "../src/state";
import type { Chat, ModelInfo } from "../src/types";
import { model as baseModel } from "./support/factories";

function chat(id: string, updatedAt: number): Chat {
  return { ...blankChat("chat-model", id, updatedAt), title: `Chat ${id}` };
}

function model(id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  return baseModel(id, { name: id.toUpperCase(), ...overrides });
}

describe("models", () => {
  it("lists only vision models, and only private ones when asked", () => {
    const models = [
      model("a"),
      model("b", { privacy: "anonymized" }),
      model("c", { vision: false }),
    ];
    expect(visionModels(models, true).map((entry) => entry.id)).toEqual(["a"]);
    expect(visionModels(models, false).map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("ignores private-only on a server that reports no privacy", () => {
    const models = [model("a", { privacy: "unknown" }), model("b", { privacy: "unknown" })];
    expect(visionModels(models, true).map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("builds a fallback for a model that is not in the loaded list", () => {
    const state = createAppState({ ...DEFAULT_SETTINGS, fallbackMaxImages: 6 });
    setModels(state, [model("known")]);
    expect(resolveModel(state, "known").name).toBe("KNOWN");
    expect(resolveModel(state, "other")).toEqual({
      id: "other",
      name: "other",
      vision: true,
      tools: true,
      reasoning: false,
      reasoningEffortOptions: [],
      maxImages: 6,
      privacy: "unknown",
      traits: [],
      uncensored: false,
      recommended: false,
      beta: false,
      videoInput: false,
      audioInput: false,
      e2ee: false,
    });
  });
});

describe("default model for new chats", () => {
  it("keeps the stored default while it is listed or nothing is loaded", () => {
    expect(effectiveDefaultModelId([], true, "stored")).toBe("stored");
    expect(effectiveDefaultModelId([model("a"), model("stored")], true, "stored")).toBe("stored");
  });

  it("uses the first listed model when no default is stored", () => {
    const models = [
      model("first", { privacy: "unknown" }),
      model("second", { privacy: "unknown" }),
    ];
    expect(effectiveDefaultModelId(models, true, "")).toBe("first");
    expect(effectiveDefaultModelId([], true, "")).toBe("");
  });

  it("uses the first visible vision model when the stored default is not listed", () => {
    const models = [model("anon", { privacy: "anonymized" }), model("priv")];
    expect(effectiveDefaultModelId(models, true, "gone")).toBe("priv");
    expect(effectiveDefaultModelId(models, false, "gone")).toBe("anon");
    const state = createAppState({ ...DEFAULT_SETTINGS, defaultModelId: "gone" });
    setModels(state, models);
    expect(defaultModelId(state)).toBe("priv");
  });
});

describe("a chat's model", () => {
  it("follows the default for a chat made before the models loaded", () => {
    const state = createAppState({ ...DEFAULT_SETTINGS, defaultModelId: "gone" });
    setModels(state, [model("first")]);
    const unset = blankChat("", "a", 1);
    expect(chatModelId(state, unset)).toBe("first");
    expect(chatModelId(state, chat("b", 1))).toBe("chat-model");
    setCurrentChat(state, unset, []);
    expect(currentModel(state)?.id).toBe("first");
  });

  it("has no model while neither the chat nor the settings name one", () => {
    const state = createAppState(DEFAULT_SETTINGS);
    setCurrentChat(state, blankChat("", "a", 1), []);
    expect(currentModel(state)).toBeNull();
  });
});
