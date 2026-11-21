import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../src/types";
import {
  contextText,
  matchesQuery,
  modelBadges,
  modelDetails,
  modelFacts,
  modelTags,
  monogram,
  pickerSections,
  type FilterName,
  type PickerView,
} from "../src/ui/pickerModel";
import { model } from "./support/factories";
import { firstModel, MODELS } from "./support/picker";

const VIEW: PickerView = {
  query: "",
  favouritesOnly: false,
  filters: new Set(),
  sort: "recommended",
};

function ids(sections: ReturnType<typeof pickerSections>): string[][] {
  return sections.map((section) => section.models.map((entry) => entry.id));
}

describe("monogram", () => {
  it("uses family initials and a fixed tone per family", () => {
    const initials = [
      "qwen3-6-27b",
      "deepseek-v3.2",
      "zai-org-glm-4.6",
      "gemma-3-27b",
      "grok-41-fast",
      "kimi-k2-thinking",
      "claude-opus-4-7",
      "openai-gpt-oss-120b",
      "mistral-31-24b",
    ].map((id) => monogram({ id, name: id }).initials);
    expect(initials).toEqual(["Qw", "DS", "GLM", "Gm", "Gk", "Ki", "Cl", "GPT", "Mi"]);
    const tone = (id: string) => monogram({ id, name: id }).tone;
    expect(tone("qwen-a")).toBe(tone("qwen-b"));
  });

  it("falls back to the name's first letters", () => {
    expect(monogram({ id: "venice-uncensored", name: "Venice Uncensored" }).initials).toBe("Ve");
  });
});

describe("labels", () => {
  const labels = (entry: ModelInfo) => modelBadges(entry).map((badge) => badge.label);

  it("lists privacy, flags and Venice trait labels", () => {
    expect(labels(model("a"))).toEqual(["Private"]);
    expect(labels(model("b", { privacy: "anonymized", uncensored: true, beta: true }))).toEqual([
      "Anon",
      "Uncensored",
      "Beta",
    ]);
    const traits = [
      "default_vision",
      "most_uncensored",
      "most_intelligent",
      "default_reasoning",
      "default",
    ];
    expect(
      labels(model("c", { privacy: "unknown", recommended: true, uncensored: true, traits })),
    ).toEqual([
      "Recommended",
      "Default vision",
      "Most uncensored",
      "Most intelligent",
      "Default reasoning",
      "Venice default",
    ]);
  });

  it("tags every Venice trait, naming the ones without a label", () => {
    expect(modelTags(firstModel()).map((tag) => tag.label)).toEqual([
      "Private",
      "Default vision",
      "Function calling default",
    ]);
  });

  it("sums up price, context, images and auto resolution in one line", () => {
    expect(contextText(262144)).toBe("256k");
    expect(contextText(1048576)).toBe("1M");
    expect(contextText(undefined)).toBe("");
    expect(modelDetails(firstModel())).toBe("$0.33 / $3.25 · 256k · 10 images · Auto 3072 px");
    expect(modelDetails(model("one", { maxImages: 1 }))).toContain("1 image ·");
  });
});

describe("modelFacts", () => {
  it("lists every fact for the details pane", () => {
    expect(modelFacts(firstModel())).toEqual([
      ["Input", "$0.33 per M tokens"],
      ["Output", "$3.25 per M tokens"],
      ["Cached input", "$0.10 per M tokens"],
      ["Context", "256k tokens"],
      ["Max images", "10"],
      ["Auto resolution", "3072 px"],
      ["Reasoning effort", "low, high"],
      ["Privacy", "Private"],
      ["Quantization", "fp8"],
      ["Video input", "Yes"],
      ["Audio input", "No"],
    ]);
    expect(Object.fromEntries(modelFacts(model("bare", { privacy: "unknown" })))).toMatchObject({
      Input: "Not listed",
      Context: "Unknown",
      "Reasoning effort": "None",
      Privacy: "Unknown",
    });
  });
});

describe("pickerSections", () => {
  it("groups favourites, recommended and the rest, vision models only", () => {
    const sections = pickerSections(MODELS, VIEW, ["glm-5v"]);
    expect(ids(sections)).toEqual([
      ["glm-5v"],
      ["audio-one", "qwen3-6-27b"],
      ["gemma-4", "venice-uncensored"],
    ]);
    expect(sections.map((section) => section.label)).toEqual([
      "Favourites",
      "Recommended",
      "Other models",
    ]);
  });

  it("flattens into one list for the other sort orders", () => {
    const sorted = (sort: PickerView["sort"]) => ids(pickerSections(MODELS, { ...VIEW, sort }, []));
    expect(sorted("price")).toEqual([
      ["gemma-4", "qwen3-6-27b", "audio-one", "glm-5v", "venice-uncensored"],
    ]);
    expect(sorted("context")).toEqual([
      ["qwen3-6-27b", "glm-5v", "venice-uncensored", "audio-one", "gemma-4"],
    ]);
    expect(sorted("name")).toEqual([
      ["audio-one", "gemma-4", "glm-5v", "qwen3-6-27b", "venice-uncensored"],
    ]);
  });

  it("filters by each chip", () => {
    const only = (filter: FilterName) =>
      ids(pickerSections(MODELS, { ...VIEW, sort: "name", filters: new Set([filter]) }, [])).flat();
    expect(only("private")).not.toContain("glm-5v");
    expect(only("uncensored")).toEqual(["venice-uncensored"]);
    expect(only("recommended")).toEqual(["audio-one", "qwen3-6-27b"]);
    expect(only("reasoning")).toEqual(["gemma-4"]);
    expect(only("audio")).toEqual(["audio-one"]);
    expect(only("beta")).toEqual(["glm-5v"]);
  });

  it("searches name, id and description", () => {
    expect(matchesQuery(firstModel(), "qwen 27b")).toBe(true);
    expect(matchesQuery(firstModel(), "3-6-27")).toBe(true);
    expect(matchesQuery(firstModel(), "video FRAMES")).toBe(true);
    expect(matchesQuery(firstModel(), "claude")).toBe(false);
    const favouritesOnly = { ...VIEW, favouritesOnly: true };
    expect(ids(pickerSections(MODELS, favouritesOnly, ["gemma-4"]))).toEqual([["gemma-4"]]);
  });
});
