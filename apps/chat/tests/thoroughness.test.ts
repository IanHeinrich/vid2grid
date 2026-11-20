import { describe, expect, it } from "vitest";
import {
  DEEP_MAX_ROUNDS,
  DEFAULT_MAX_ROUNDS,
  effortFor,
  lowestEffort,
  messageThoroughness,
  roundsFor,
  THOROUGH_MAX_ROUNDS,
} from "../src/chat/thoroughness";
import type { ModelInfo, UserMessage } from "../src/types";

const model: ModelInfo = {
  id: "model",
  name: "Model",
  vision: true,
  tools: true,
  reasoning: true,
  reasoningEffortOptions: ["low", "medium", "high"],
  maxImages: 10,
  privacy: "private",
  traits: [],
  uncensored: false,
  recommended: false,
  beta: false,
  videoInput: false,
  audioInput: false,
  e2ee: false,
};

function withLevels(...reasoningEffortOptions: string[]): ModelInfo {
  return { ...model, reasoningEffortOptions };
}

const message: UserMessage = { id: "u", createdAt: 0, role: "user", text: "hi", images: [] };

describe("messageThoroughness", () => {
  it("reads the tier, an older deep dive as exhaustive, and normal otherwise", () => {
    expect(messageThoroughness(message)).toBe("normal");
    expect(messageThoroughness({ ...message, thoroughness: "thorough" })).toBe("thorough");
    expect(messageThoroughness({ ...message, deep: true })).toBe("exhaustive");
  });
});

describe("roundsFor", () => {
  it("gives each tier its budget, normal following the chat", () => {
    expect([DEFAULT_MAX_ROUNDS, THOROUGH_MAX_ROUNDS, DEEP_MAX_ROUNDS]).toEqual([8, 15, 30]);
    expect(roundsFor("normal", undefined)).toBe(8);
    expect(roundsFor("normal", 4)).toBe(4);
    expect(roundsFor("thorough", 4)).toBe(15);
    expect(roundsFor("exhaustive", undefined)).toBe(30);
  });

  it("never gives a higher tier fewer rounds than a normal reply", () => {
    expect(roundsFor("thorough", 20)).toBe(20);
  });
});

describe("effortFor", () => {
  it("maps the tiers when nothing is chosen, leaving normal to the model's default", () => {
    expect(effortFor("normal", model, undefined, undefined)).toBeUndefined();
    expect(effortFor("thorough", model, undefined, undefined)).toBe("medium");
    expect(effortFor("exhaustive", model, undefined, undefined)).toBe("high");
  });

  it("prefers the message's effort, then the chat's, over the tier", () => {
    expect(effortFor("exhaustive", model, "medium", "low")).toBe("low");
    expect(effortFor("exhaustive", model, "medium", undefined)).toBe("medium");
    expect(effortFor("normal", model, "low", undefined)).toBe("low");
  });

  it("clamps to the nearest level at or below, else the nearest above", () => {
    expect(effortFor("exhaustive", withLevels("low", "medium"), undefined, undefined)).toBe(
      "medium",
    );
    expect(effortFor("thorough", withLevels("high", "xhigh"), undefined, undefined)).toBe("high");
    expect(effortFor("normal", withLevels("none", "high"), "medium", undefined)).toBe("none");
  });

  it("sends nothing to a model without levels or for a level it cannot place", () => {
    expect(effortFor("exhaustive", withLevels(), "high", "high")).toBeUndefined();
    expect(effortFor("normal", model, "turbo", undefined)).toBeUndefined();
  });
});

describe("lowestEffort", () => {
  it("prefers none, else the lowest known level, else the first", () => {
    expect(lowestEffort(withLevels("low", "none", "high"))).toBe("none");
    expect(lowestEffort(withLevels("high", "minimal", "low"))).toBe("minimal");
    expect(lowestEffort(withLevels("fast", "slow"))).toBe("fast");
    expect(lowestEffort(withLevels())).toBeUndefined();
  });
});
