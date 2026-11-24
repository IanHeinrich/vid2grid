import { saveSettings, type GlobalSettings } from "../../settings";
import { setSettings, type AppState } from "../../state";
import type { ModelInfo } from "../../types";
import { resolveSheetResolution } from "../../video/resolution";

export type SortOrder = "recommended" | "price" | "context" | "name";
export type FilterName = "private" | "uncensored" | "recommended" | "reasoning" | "audio" | "beta";

const TEXT_ONLY_HIDDEN = "Models that cannot see images are hidden.";
export const DEFAULT_TEXT_ONLY_NOTE = `${TEXT_ONLY_HIDDEN} Choose a looking model below to use one.`;
export const CHAT_TEXT_ONLY_NOTE = `${TEXT_ONLY_HIDDEN} Choose a looking model for this chat to use one.`;

export interface PickerSettings {
  privateOnly(): boolean;
  setPrivateOnly(privateOnly: boolean): void;
  favourites(): readonly string[];
  setFavourites(ids: readonly string[]): void;
}

export interface PickerView {
  query: string;
  favouritesOnly: boolean;
  filters: ReadonlySet<FilterName>;
  sort: SortOrder;
  // Offer models that cannot see images too.
  textOnly?: boolean;
}

export interface ModelSection {
  label: string;
  models: ModelInfo[];
}

export interface Badge {
  label: string;
  kind: "private" | "anon" | "uncensored" | "beta" | "recommended" | "trait";
}

const TONES = 8;

const FAMILIES: readonly { pattern: RegExp; initials: string; tone: number }[] = [
  { pattern: /qwen|qwq/, initials: "Qw", tone: 0 },
  { pattern: /deepseek/, initials: "DS", tone: 1 },
  { pattern: /glm|zai-/, initials: "GLM", tone: 2 },
  { pattern: /gemma|gemini/, initials: "Gm", tone: 3 },
  { pattern: /grok/, initials: "Gk", tone: 4 },
  { pattern: /kimi|moonshot/, initials: "Ki", tone: 5 },
  { pattern: /claude/, initials: "Cl", tone: 6 },
  { pattern: /gpt|openai/, initials: "GPT", tone: 7 },
  { pattern: /minimax/, initials: "MM", tone: 1 },
  { pattern: /mistral|magistral|pixtral|devstral|ministral/, initials: "Mi", tone: 2 },
  { pattern: /llama/, initials: "Ll", tone: 4 },
];

const TRAIT_LABELS: Readonly<Record<string, string>> = {
  default_vision: "Default vision",
  most_uncensored: "Most uncensored",
  most_intelligent: "Most intelligent",
  default_reasoning: "Default reasoning",
  default: "Venice default",
};

export function isRecommended(model: ModelInfo): boolean {
  return model.recommended || model.traits.length > 0;
}

const FILTERS: Record<FilterName, (model: ModelInfo) => boolean> = {
  private: (model) => model.privacy === "private",
  uncensored: (model) => model.uncensored || model.traits.includes("most_uncensored"),
  recommended: isRecommended,
  reasoning: (model) => model.reasoning,
  audio: (model) => model.audioInput,
  beta: (model) => model.beta,
};

type Compare = (a: ModelInfo, b: ModelInfo) => number;

const byName: Compare = (a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

function totalPrice(model: ModelInfo): number {
  return model.pricing ? model.pricing.inputPerMTok + model.pricing.outputPerMTok : Infinity;
}

const COMPARE: Record<Exclude<SortOrder, "recommended">, Compare> = {
  price: (a, b) => totalPrice(a) - totalPrice(b) || byName(a, b),
  context: (a, b) => (b.contextTokens ?? 0) - (a.contextTokens ?? 0) || byName(a, b),
  name: byName,
};

export function isFilterName(value: string | undefined): value is FilterName {
  return value !== undefined && Object.hasOwn(FILTERS, value);
}

export function isSortOrder(value: string | undefined): value is SortOrder {
  return value === "recommended" || (value !== undefined && Object.hasOwn(COMPARE, value));
}

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

export function monogram(model: Pick<ModelInfo, "id" | "name">): {
  initials: string;
  tone: number;
} {
  const haystack = `${model.id} ${model.name}`.toLowerCase();
  const family = FAMILIES.find((entry) => entry.pattern.test(haystack));
  if (family) return { initials: family.initials, tone: family.tone };
  const letters = (model.name || model.id).replace(/[^\p{L}\p{N}]/gu, "");
  const initials = `${letters.charAt(0).toUpperCase()}${letters.charAt(1).toLowerCase()}`;
  return { initials: initials || "?", tone: hash(model.id) % TONES };
}

export function traitLabels(model: ModelInfo): string[] {
  const labels = model.traits.flatMap((trait) => TRAIT_LABELS[trait] ?? []);
  return [...new Set(labels)];
}

export function modelBadges(model: ModelInfo): Badge[] {
  const badges: Badge[] = [];
  if (model.privacy === "private") badges.push({ label: "Private", kind: "private" });
  if (model.privacy === "anonymized") badges.push({ label: "Anon", kind: "anon" });
  if (model.uncensored && !model.traits.includes("most_uncensored")) {
    badges.push({ label: "Uncensored", kind: "uncensored" });
  }
  if (!model.vision) badges.push({ label: "Text only", kind: "trait" });
  if (model.beta) badges.push({ label: "Beta", kind: "beta" });
  if (model.recommended) badges.push({ label: "Recommended", kind: "recommended" });
  return [...badges, ...traitLabels(model).map((label): Badge => ({ label, kind: "trait" }))];
}

export function priceText(pricing: ModelInfo["pricing"]): string {
  return pricing
    ? `$${pricing.inputPerMTok.toFixed(2)} / $${pricing.outputPerMTok.toFixed(2)}`
    : "";
}

// Venice reports contexts in powers of two, so 262144 reads as the advertised "256k".
export function contextText(tokens: number | undefined): string {
  if (tokens === undefined || tokens <= 0) return "";
  if (tokens >= 1024 ** 2) return `${Number((tokens / 1024 ** 2).toFixed(1))}M`;
  return `${Math.round(tokens / 1024)}k`;
}

export function modelDetails(model: ModelInfo): string {
  return [
    priceText(model.pricing),
    contextText(model.contextTokens),
    ...(model.vision
      ? [
          `${model.maxImages} image${model.maxImages === 1 ? "" : "s"}`,
          `Auto ${resolveSheetResolution("auto", model).px} px`,
        ]
      : []),
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

function humanise(trait: string): string {
  const words = trait.replace(/_/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function modelTags(model: ModelInfo): Badge[] {
  const unlabelled = model.traits.filter((trait) => TRAIT_LABELS[trait] === undefined);
  return [
    ...modelBadges(model),
    ...unlabelled.map((trait): Badge => ({ label: humanise(trait), kind: "trait" })),
  ];
}

function perMTok(price: number | undefined): string {
  return price === undefined ? "Not listed" : `$${price.toFixed(2)} per M tokens`;
}

const PRIVACY_TEXT: Record<ModelInfo["privacy"], string> = {
  private: "Private",
  anonymized: "Anonymized",
  unknown: "Unknown",
};

export function modelFacts(model: ModelInfo): [string, string][] {
  const { pricing, reasoningEffortOptions: efforts } = model;
  const context = contextText(model.contextTokens);
  const effort = efforts.length > 0 ? efforts.join(", ") : model.reasoning ? "Built in" : "None";
  const facts: [string, string][] = [
    ["Input", perMTok(pricing?.inputPerMTok)],
    ["Output", perMTok(pricing?.outputPerMTok)],
  ];
  if (pricing?.cachedInputPerMTok !== undefined) {
    facts.push(["Cached input", perMTok(pricing.cachedInputPerMTok)]);
  }
  facts.push(["Context", context === "" ? "Unknown" : `${context} tokens`]);
  if (model.vision) {
    facts.push(
      ["Max images", String(model.maxImages)],
      ["Auto resolution", `${resolveSheetResolution("auto", model).px} px`],
    );
  } else {
    facts.push(["Image input", "No"]);
  }
  facts.push(
    ["Reasoning effort", effort],
    [
      "Privacy",
      `${PRIVACY_TEXT[model.privacy]}${model.e2ee ? "; offers end-to-end encryption, which this app doesn't use" : ""}`,
    ],
  );
  if (model.quantization !== undefined) facts.push(["Quantization", model.quantization]);
  facts.push(
    ["Video input", model.videoInput ? "Yes" : "No"],
    ["Audio input", model.audioInput ? "Yes" : "No"],
  );
  return facts;
}

export function matchesQuery(model: ModelInfo, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [model.name, model.id, model.description ?? ""].join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function pickerSections(
  models: readonly ModelInfo[],
  view: PickerView,
  favouriteIds: readonly string[],
): ModelSection[] {
  const favourites = new Set(favouriteIds);
  const filters = [...view.filters].map((name) => FILTERS[name]);
  const visible = models.filter(
    (model) =>
      (view.textOnly === true || model.vision) &&
      filters.every((passes) => passes(model)) &&
      matchesQuery(model, view.query) &&
      (!view.favouritesOnly || favourites.has(model.id)),
  );
  if (view.sort !== "recommended") {
    return [{ label: "", models: visible.sort(COMPARE[view.sort]) }].filter(
      (section) => section.models.length > 0,
    );
  }
  const sorted = visible.sort(byName);
  const others = sorted.filter((model) => !favourites.has(model.id));
  return [
    { label: "Favourites", models: sorted.filter((model) => favourites.has(model.id)) },
    { label: "Recommended", models: others.filter(isRecommended) },
    { label: "Other models", models: others.filter((model) => !isRecommended(model)) },
  ].filter((section) => section.models.length > 0);
}

export function storedPickerSettings(state: AppState, storage?: Storage): PickerSettings {
  const save = (change: Partial<GlobalSettings>) => {
    const settings = { ...state.settings, ...change };
    saveSettings(settings, storage);
    setSettings(state, settings);
  };
  return {
    privateOnly: () => state.settings.privateOnly,
    setPrivateOnly: (privateOnly) => save({ privateOnly }),
    favourites: () => state.settings.favouriteModels,
    setFavourites: (ids) => save({ favouriteModels: [...ids] }),
  };
}
