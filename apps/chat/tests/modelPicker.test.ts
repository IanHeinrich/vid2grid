import { beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { queryElements, type AppElements } from "../src/dom";
import { DEFAULT_SETTINGS, loadSettings } from "../src/settings";
import { createAppState, setModels, type AppState } from "../src/state";
import type { ModelInfo } from "../src/types";
import {
  contextText,
  createModelPicker,
  matchesQuery,
  modelBadges,
  modelDetails,
  modelFacts,
  modelTags,
  monogram,
  pickerSections,
  storedPickerSettings,
  type FilterName,
  type ModelPicker,
  type PickerView,
} from "../src/ui/modelPicker";

function model(id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name: id,
    vision: true,
    tools: true,
    reasoning: false,
    reasoningEffortOptions: [],
    maxImages: 10,
    privacy: "private",
    traits: [],
    uncensored: false,
    recommended: false,
    beta: false,
    videoInput: false,
    audioInput: false,
    e2ee: false,
    ...overrides,
  };
}

const LONG_DESCRIPTION =
  "Sharp eyes for video frames. ".repeat(12) + "It ends with this exact sentence.";

const MODELS: ModelInfo[] = [
  model("qwen3-6-27b", {
    name: "Qwen 3.6 27B",
    traits: ["default_vision", "function_calling_default"],
    pricing: { inputPerMTok: 0.33, outputPerMTok: 3.25, cachedInputPerMTok: 0.1 },
    contextTokens: 262144,
    description: LONG_DESCRIPTION,
    reasoningEffortOptions: ["low", "high"],
    quantization: "fp8",
    videoInput: true,
  }),
  model("venice-uncensored", { name: "Venice Uncensored", uncensored: true, contextTokens: 32768 }),
  model("gemma-4", {
    name: "Gemma 4",
    reasoning: true,
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
    description: "Small and quick",
  }),
  model("glm-5v", { name: "GLM 5V", privacy: "anonymized", beta: true, contextTokens: 131072 }),
  model("audio-one", { name: "Audio One", audioInput: true, recommended: true }),
  model("text-only", { name: "Text Only", vision: false }),
];

const VIEW: PickerView = {
  query: "",
  favouritesOnly: false,
  filters: new Set(),
  sort: "recommended",
};

function ids(sections: ReturnType<typeof pickerSections>): string[][] {
  return sections.map((section) => section.models.map((entry) => entry.id));
}

function first(): ModelInfo {
  const [qwen] = MODELS;
  if (!qwen) throw new Error("No model");
  return qwen;
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
    expect(modelTags(first()).map((tag) => tag.label)).toEqual([
      "Private",
      "Default vision",
      "Function calling default",
    ]);
  });

  it("sums up price, context, images and auto resolution in one line", () => {
    expect(contextText(262144)).toBe("256k");
    expect(contextText(1048576)).toBe("1M");
    expect(contextText(undefined)).toBe("");
    expect(modelDetails(first())).toBe("$0.33 / $3.25 · 256k · 10 images · Auto 3072 px");
    expect(modelDetails(model("one", { maxImages: 1 }))).toContain("1 image ·");
  });
});

describe("modelFacts", () => {
  it("lists every fact for the details pane", () => {
    expect(modelFacts(first())).toEqual([
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
    expect(matchesQuery(first(), "qwen 27b")).toBe(true);
    expect(matchesQuery(first(), "3-6-27")).toBe(true);
    expect(matchesQuery(first(), "video FRAMES")).toBe(true);
    expect(matchesQuery(first(), "claude")).toBe(false);
    const favouritesOnly = { ...VIEW, favouritesOnly: true };
    expect(ids(pickerSections(MODELS, favouritesOnly, ["gemma-4"]))).toEqual([["gemma-4"]]);
  });
});

let els: AppElements;
let state: AppState;
let mount: HTMLElement;
let current: string | undefined;
let onPick: ReturnType<typeof vi.fn<(id: string) => void>>;

function setup(): ModelPicker {
  return createModelPicker(
    { mount, ...els.templates },
    {
      models: () => state.models,
      current: () => current,
      onPick,
      settings: storedPickerSettings(state, localStorage),
    },
  );
}

function find<T extends Element>(selector: string): T {
  const el = mount.querySelector<T>(selector);
  if (!el) throw new Error(`No ${selector}`);
  return el;
}

const trigger = () => find<HTMLButtonElement>(".model-trigger");
const panel = () => find<HTMLElement>(".model-panel");
const paneName = () => find(".model-pane-name").textContent;
const focusedId = () => (document.activeElement as HTMLElement | null)?.dataset.id;
const rowIds = () =>
  [...mount.querySelectorAll<HTMLElement>(".model-row")].map((row) => row.dataset.id);
const key = (target: Element | null, name: string) =>
  target?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = indexHtml;
  els = queryElements();
  mount = els.chatSettings.modelPicker;
  state = createAppState({ ...DEFAULT_SETTINGS, privateOnly: true });
  setModels(state, MODELS);
  current = "qwen3-6-27b";
  onPick = vi.fn<(id: string) => void>();
});

describe("model picker trigger", () => {
  it("shows the current model's monogram, name and privacy", () => {
    setup();
    expect(find(".model-trigger .model-monogram").textContent).toBe("Qw");
    expect(find(".model-trigger-name").textContent).toBe("Qwen 3.6 27B");
    expect(find(".model-trigger-privacy").textContent).toBe("Private");
    expect(trigger().textContent).not.toContain("$");
  });

  it("shows an unknown current model by its id", () => {
    current = "retired-model";
    setup();
    expect(find(".model-trigger-name").textContent).toBe("retired-model");
    expect(find<HTMLElement>(".model-trigger-privacy").hidden).toBe(true);
  });

  it("picks a row by click and updates the trigger", () => {
    const picker = setup();
    trigger().click();
    find<HTMLElement>('.model-row[data-id="gemma-4"] .model-row-name').click();
    expect(onPick).toHaveBeenCalledWith("gemma-4");
    current = "gemma-4";
    picker.render();
    expect(find(".model-trigger-name").textContent).toBe("Gemma 4");
    expect(find(".model-trigger .model-monogram").textContent).toBe("Gm");
  });
});

describe("model picker list", () => {
  it("opens with search focused and the current model highlighted", () => {
    setup();
    trigger().click();
    expect(panel().hidden).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(find(".model-search-input"));
    const highlighted = find<HTMLElement>(".model-row.is-current");
    expect(highlighted.dataset.id).toBe("qwen3-6-27b");
    expect(highlighted.classList.contains("is-active")).toBe(true);
    expect(highlighted.getAttribute("aria-selected")).toBe("true");
  });

  it("lists private vision models in sections with badges and one meta line", () => {
    setup();
    trigger().click();
    expect([...mount.querySelectorAll(".model-section")].map((el) => el.textContent)).toEqual([
      "Recommended",
      "Other models",
    ]);
    expect(rowIds()).toEqual(["audio-one", "qwen3-6-27b", "gemma-4", "venice-uncensored"]);
    const row = find(".model-row.is-current");
    const badges = [...row.querySelectorAll(".model-pill")].map((el) => el.textContent);
    expect(badges).toEqual(["Private", "Default vision"]);
    expect(row.querySelector(".model-row-meta")?.textContent).toBe(modelDetails(first()));
  });

  it("keeps rows the same on hover: no description in a row and no description titles", () => {
    setup();
    trigger().click();
    const row = find<HTMLElement>('.model-row[data-id="qwen3-6-27b"]');
    const before = row.innerHTML;
    row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(row.innerHTML).toBe(before);
    expect(row.textContent).not.toContain("Sharp eyes");
    expect(mount.querySelector(`[title="${LONG_DESCRIPTION}"]`)).toBeNull();
  });
});

describe("model picker filters", () => {
  it("mirrors and updates the private-only setting from the Private chip", () => {
    setup();
    trigger().click();
    find<HTMLButtonElement>(".model-filter-toggle").click();
    const chip = find<HTMLButtonElement>('[data-filter="private"]');
    expect(find<HTMLElement>(".model-filter-chips").hidden).toBe(false);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    chip.click();
    expect(state.settings.privateOnly).toBe(false);
    expect(loadSettings(localStorage).privateOnly).toBe(false);
    expect(rowIds()).toContain("glm-5v");
    expect(rowIds()).not.toContain("text-only");
  });

  it("narrows by search, chips, sort and favourites", () => {
    setup();
    trigger().click();
    const search = find<HTMLInputElement>(".model-search-input");
    search.value = "exact sentence";
    search.dispatchEvent(new Event("input"));
    expect(rowIds()).toEqual(["qwen3-6-27b"]);
    search.value = "";
    search.dispatchEvent(new Event("input"));
    find<HTMLButtonElement>('[data-filter="reasoning"]').click();
    expect(rowIds()).toEqual(["gemma-4"]);
    find<HTMLButtonElement>('[data-filter="reasoning"]').click();
    find<HTMLButtonElement>('[data-sort="name"]').click();
    expect(mount.querySelectorAll(".model-section")).toHaveLength(0);
    expect(rowIds()).toEqual(["audio-one", "gemma-4", "qwen3-6-27b", "venice-uncensored"]);
    find<HTMLButtonElement>(".model-favourites-toggle").click();
    expect(rowIds()).toEqual([]);
    expect(find<HTMLElement>(".model-empty").hidden).toBe(false);
  });

  it("toggles a favourite from the row's star and persists it", () => {
    setup();
    trigger().click();
    find<HTMLButtonElement>('.model-row[data-id="gemma-4"] .model-star').click();
    expect(onPick).not.toHaveBeenCalled();
    expect(loadSettings(localStorage).favouriteModels).toEqual(["gemma-4"]);
    expect(find(".model-section").textContent).toBe("Favourites");
    expect(rowIds()[0]).toBe("gemma-4");
    const star = find<HTMLButtonElement>('.model-row[data-id="gemma-4"] .model-star');
    expect(star.getAttribute("aria-pressed")).toBe("true");
    star.click();
    expect(state.settings.favouriteModels).toEqual([]);
  });
});

describe("model picker star from the keyboard", () => {
  it("stars and unstars the highlighted row with F, keeping it focused, and says so", () => {
    setup();
    trigger().click();
    key(find(".model-search-input"), "ArrowDown");
    key(document.activeElement, "ArrowDown");
    expect(focusedId()).toBe("gemma-4");
    key(document.activeElement, "f");
    expect(state.settings.favouriteModels).toEqual(["gemma-4"]);
    expect(focusedId()).toBe("gemma-4");
    expect(document.activeElement).not.toBe(find(".model-search-input"));
    key(document.activeElement, "F");
    expect(state.settings.favouriteModels).toEqual([]);
    expect(find(".model-hint").textContent).toContain("to star");
  });

  it("does not announce the details pane on every hover", () => {
    setup();
    expect(find(".model-pane").hasAttribute("aria-live")).toBe(false);
  });
});

describe("model picker details pane", () => {
  it("shows the selected model in full when it opens", () => {
    setup();
    trigger().click();
    expect(paneName()).toBe("Qwen 3.6 27B");
    expect(find(".model-pane-id").textContent).toBe("qwen3-6-27b");
    expect(find(".model-pane-description").textContent).toBe(LONG_DESCRIPTION);
    const tags = [...find(".model-pane-tags").children].map((el) => el.textContent);
    expect(tags).toEqual(["Private", "Default vision", "Function calling default"]);
    const facts = [...find(".model-pane-facts").children].map((el) => el.textContent);
    expect(facts).toContain("Cached input");
    expect(facts).toContain("low, high");
    expect(facts).toContain("fp8");
  });

  it("follows the hovered row and falls back to the highlighted one", () => {
    setup();
    trigger().click();
    const gemma = find('.model-row[data-id="gemma-4"]');
    gemma.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(paneName()).toBe("Gemma 4");
    expect(find(".model-pane-description").textContent).toBe("Small and quick");
    find(".model-list").dispatchEvent(new MouseEvent("mouseleave"));
    expect(paneName()).toBe("Qwen 3.6 27B");
  });

  it("follows the keyboard highlight", () => {
    setup();
    trigger().click();
    key(find(".model-search-input"), "ArrowDown");
    key(document.activeElement, "ArrowDown");
    expect(focusedId()).toBe("gemma-4");
    expect(paneName()).toBe("Gemma 4");
    expect(find<HTMLElement>(".model-pane-description").hidden).toBe(false);
    key(document.activeElement, "End");
    expect(paneName()).toBe("Venice Uncensored");
    expect(find<HTMLElement>(".model-pane-description").hidden).toBe(true);
  });
});

describe("model picker keyboard and dismissal", () => {
  it("moves with the arrow keys, jumps with Home and End, and picks with Enter", () => {
    setup();
    trigger().click();
    const search = find<HTMLInputElement>(".model-search-input");
    key(search, "ArrowDown");
    expect(focusedId()).toBe("qwen3-6-27b");
    key(document.activeElement, "ArrowDown");
    expect(focusedId()).toBe("gemma-4");
    key(document.activeElement, "End");
    expect(focusedId()).toBe("venice-uncensored");
    key(document.activeElement, "Home");
    expect(focusedId()).toBe("audio-one");
    key(document.activeElement, "g");
    expect(document.activeElement).toBe(search);
    key(search, "ArrowDown");
    key(document.activeElement, "Enter");
    expect(onPick).toHaveBeenCalledWith("audio-one");
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on Escape without reaching a surrounding dialog, and returns focus", () => {
    setup();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    trigger().click();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    find(".model-search-input").dispatchEvent(escape);
    document.removeEventListener("keydown", outer);
    expect(escape.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click outside", () => {
    setup();
    trigger().click();
    find(".model-row").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(panel().hidden).toBe(false);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(panel().hidden).toBe(true);
  });
});
