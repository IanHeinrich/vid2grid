import { part } from "../dom";
import { saveSettings, type GlobalSettings } from "../settings";
import { reportsPrivacy, setSettings, type AppState } from "../state";
import type { ModelInfo } from "../types";
import { resolveSheetResolution } from "../video/resolution";
import { icon } from "./icons";

export type SortOrder = "recommended" | "price" | "context" | "name";
export type FilterName = "private" | "uncensored" | "recommended" | "reasoning" | "audio" | "beta";

export interface PickerSettings {
  privateOnly(): boolean;
  setPrivateOnly(privateOnly: boolean): void;
  favourites(): readonly string[];
  setFavourites(ids: readonly string[]): void;
}

export interface ModelPickerElements {
  mount: HTMLElement;
  modelPicker: HTMLTemplateElement;
  modelRow: HTMLTemplateElement;
}

export interface ModelPickerDeps {
  models(): readonly ModelInfo[];
  current(): string | undefined;
  onPick(id: string): void;
  settings: PickerSettings;
}

export interface ModelPicker {
  render(): void;
  close(): void;
}

export interface PickerView {
  query: string;
  favouritesOnly: boolean;
  filters: ReadonlySet<FilterName>;
  sort: SortOrder;
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
const PANEL_WIDTH = 960;
const PANEL_GAP = 6;
const VIEWPORT_EDGE = 8;

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

function isFilterName(value: string | undefined): value is FilterName {
  return value !== undefined && Object.hasOwn(FILTERS, value);
}

function isSortOrder(value: string | undefined): value is SortOrder {
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
    `${model.maxImages} image${model.maxImages === 1 ? "" : "s"}`,
    `Auto ${resolveSheetResolution("auto", model).px} px`,
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
  facts.push(
    ["Context", context === "" ? "Unknown" : `${context} tokens`],
    ["Max images", String(model.maxImages)],
    ["Auto resolution", `${resolveSheetResolution("auto", model).px} px`],
    ["Reasoning effort", effort],
    ["Privacy", `${PRIVACY_TEXT[model.privacy]}${model.e2ee ? ", end-to-end encrypted" : ""}`],
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
      model.vision &&
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

interface PickerParts {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  triggerMonogram: HTMLElement;
  triggerName: HTMLElement;
  triggerPrivacy: HTMLElement;
  panel: HTMLElement;
  search: HTMLInputElement;
  favouritesToggle: HTMLButtonElement;
  filterToggle: HTMLButtonElement;
  sortToggle: HTMLButtonElement;
  filterChips: HTMLElement;
  sortChips: HTMLElement;
  list: HTMLUListElement;
  empty: HTMLElement;
  pane: PaneParts;
}

interface PaneParts {
  monogram: HTMLElement;
  name: HTMLElement;
  id: HTMLElement;
  tags: HTMLElement;
  description: HTMLElement;
  facts: HTMLDListElement;
}

interface PickerContext {
  parts: PickerParts;
  rowTemplate: HTMLTemplateElement;
  deps: ModelPickerDeps;
  query: string;
  favouritesOnly: boolean;
  filters: Set<FilterName>;
  sort: SortOrder;
  rows: HTMLLIElement[];
  active: number;
  hovered: string | undefined;
  paneModelId: string | undefined;
  open: boolean;
  onOutside: (event: Event) => void;
  onReflow: () => void;
}

function mountParts(els: ModelPickerElements): PickerParts {
  els.mount.replaceChildren(document.importNode(els.modelPicker.content, true));
  const root = part(els.mount, ".model-picker", HTMLElement);
  part(root, ".model-search-icon", HTMLElement).replaceChildren(icon("search", 16));
  part(root, ".model-trigger-chevron", HTMLElement).replaceChildren(icon("chevron", 16));
  const button = (selector: string, iconName: "star" | "filter" | "sort") => {
    const found = part(root, selector, HTMLButtonElement);
    found.replaceChildren(icon(iconName, 16));
    return found;
  };
  return {
    root,
    trigger: part(root, ".model-trigger", HTMLButtonElement),
    triggerMonogram: part(root, ".model-trigger .model-monogram", HTMLElement),
    triggerName: part(root, ".model-trigger-name", HTMLElement),
    triggerPrivacy: part(root, ".model-trigger-privacy", HTMLElement),
    panel: part(root, ".model-panel", HTMLElement),
    search: part(root, ".model-search-input", HTMLInputElement),
    favouritesToggle: button(".model-favourites-toggle", "star"),
    filterToggle: button(".model-filter-toggle", "filter"),
    sortToggle: button(".model-sort-toggle", "sort"),
    filterChips: part(root, ".model-filter-chips", HTMLElement),
    sortChips: part(root, ".model-sort-chips", HTMLElement),
    list: part(root, ".model-list", HTMLUListElement),
    empty: part(root, ".model-empty", HTMLElement),
    pane: {
      monogram: part(root, ".model-pane .model-monogram", HTMLElement),
      name: part(root, ".model-pane-name", HTMLElement),
      id: part(root, ".model-pane-id", HTMLElement),
      tags: part(root, ".model-pane-tags", HTMLElement),
      description: part(root, ".model-pane-description", HTMLElement),
      facts: part(root, ".model-pane-facts", HTMLDListElement),
    },
  };
}

export function createModelPicker(els: ModelPickerElements, deps: ModelPickerDeps): ModelPicker {
  const parts = mountParts(els);
  const ctx: PickerContext = {
    parts,
    rowTemplate: els.modelRow,
    deps,
    query: "",
    favouritesOnly: false,
    filters: new Set(),
    sort: "recommended",
    rows: [],
    active: 0,
    hovered: undefined,
    paneModelId: undefined,
    open: false,
    onOutside: (event) => {
      const inside = event.target instanceof Node && parts.root.contains(event.target);
      if (!inside) closePanel(ctx, false);
    },
    onReflow: () => positionPanel(parts),
  };
  listen(ctx);
  renderTrigger(ctx);
  return {
    render: () => {
      renderTrigger(ctx);
      if (ctx.open) refreshList(ctx, activeId(ctx));
    },
    close: () => closePanel(ctx, false),
  };
}

function listen(ctx: PickerContext): void {
  const { parts } = ctx;
  parts.trigger.addEventListener("click", () =>
    ctx.open ? closePanel(ctx, true) : openPanel(ctx),
  );
  parts.search.addEventListener("input", () => {
    ctx.query = parts.search.value;
    refreshList(ctx, undefined);
  });
  parts.favouritesToggle.addEventListener("click", () => {
    ctx.favouritesOnly = !ctx.favouritesOnly;
    refreshList(ctx, activeId(ctx));
  });
  parts.filterToggle.addEventListener("click", () => toggleRow(ctx, parts.filterChips));
  parts.sortToggle.addEventListener("click", () => toggleRow(ctx, parts.sortChips));
  parts.filterChips.addEventListener("click", (event) => {
    const name = chipValue(event, "filter");
    if (isFilterName(name)) toggleFilter(ctx, name);
  });
  parts.sortChips.addEventListener("click", (event) => {
    const sort = chipValue(event, "sort");
    if (!isSortOrder(sort)) return;
    ctx.sort = sort;
    refreshList(ctx, activeId(ctx));
  });
  parts.list.addEventListener("click", (event) => onListClick(ctx, event));
  parts.list.addEventListener("mouseover", (event) => {
    const row = event.target instanceof Element ? event.target.closest(".model-row") : null;
    ctx.hovered = row instanceof HTMLElement ? row.dataset.id : undefined;
    renderPane(ctx);
  });
  parts.list.addEventListener("mouseleave", () => {
    ctx.hovered = undefined;
    renderPane(ctx);
  });
  parts.root.addEventListener("keydown", (event) => onKeydown(ctx, event));
}

function chipValue(event: Event, key: "filter" | "sort"): string | undefined {
  const chip = event.target instanceof Element ? event.target.closest("button") : null;
  return chip instanceof HTMLElement ? chip.dataset[key] : undefined;
}

function toggleRow(ctx: PickerContext, row: HTMLElement): void {
  row.hidden = !row.hidden;
  renderControls(ctx);
}

function toggleFilter(ctx: PickerContext, name: FilterName): void {
  if (name === "private") {
    const { settings } = ctx.deps;
    settings.setPrivateOnly(!settings.privateOnly());
  } else if (!ctx.filters.delete(name)) {
    ctx.filters.add(name);
  }
  refreshList(ctx, activeId(ctx));
}

function onListClick(ctx: PickerContext, event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const row = event.target.closest(".model-row");
  const id = row instanceof HTMLElement ? row.dataset.id : undefined;
  if (id === undefined) return;
  if (event.target.closest(".model-star")) toggleFavourite(ctx, id);
  else pick(ctx, id);
}

function toggleFavourite(ctx: PickerContext, id: string): void {
  const { settings } = ctx.deps;
  const favourites = settings.favourites();
  settings.setFavourites(
    favourites.includes(id) ? favourites.filter((entry) => entry !== id) : [...favourites, id],
  );
  refreshList(ctx, id);
}

function pick(ctx: PickerContext, id: string): void {
  closePanel(ctx, true);
  ctx.deps.onPick(id);
  renderTrigger(ctx);
}

function activeId(ctx: PickerContext): string | undefined {
  return ctx.rows[ctx.active]?.dataset.id;
}

function view(ctx: PickerContext): PickerView {
  const filters = new Set(ctx.filters);
  if (ctx.deps.settings.privateOnly() && reportsPrivacy(ctx.deps.models())) filters.add("private");
  return { query: ctx.query, favouritesOnly: ctx.favouritesOnly, filters, sort: ctx.sort };
}

function openPanel(ctx: PickerContext): void {
  const { parts } = ctx;
  ctx.open = true;
  ctx.query = "";
  parts.search.value = "";
  parts.panel.hidden = false;
  parts.trigger.setAttribute("aria-expanded", "true");
  renderList(ctx, ctx.deps.current());
  positionPanel(parts);
  parts.search.focus();
  scrollToActive(ctx);
  document.addEventListener("pointerdown", ctx.onOutside, true);
  window.addEventListener("resize", ctx.onReflow);
  window.addEventListener("scroll", ctx.onReflow, true);
}

function closePanel(ctx: PickerContext, returnFocus: boolean): void {
  if (!ctx.open) return;
  ctx.open = false;
  ctx.parts.panel.hidden = true;
  ctx.parts.trigger.setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", ctx.onOutside, true);
  window.removeEventListener("resize", ctx.onReflow);
  window.removeEventListener("scroll", ctx.onReflow, true);
  if (returnFocus) ctx.parts.trigger.focus();
}

function positionPanel(parts: PickerParts): void {
  const rect = parts.trigger.getBoundingClientRect();
  const { innerWidth, innerHeight } = window;
  const width = Math.min(PANEL_WIDTH, innerWidth - VIEWPORT_EDGE * 2);
  const cap = innerHeight * 0.7;
  const spaceBelow = innerHeight - rect.bottom - PANEL_GAP - VIEWPORT_EDGE;
  const spaceAbove = rect.top - PANEL_GAP - VIEWPORT_EDGE;
  const below = spaceBelow >= Math.min(cap, 360) || spaceBelow >= spaceAbove;
  const left = Math.min(Math.max(VIEWPORT_EDGE, rect.left), innerWidth - width - VIEWPORT_EDGE);
  const { style } = parts.panel;
  style.width = `${width}px`;
  style.left = `${left}px`;
  // A fixed height keeps the list still while the details pane changes length.
  style.height = `${Math.min(cap, below ? spaceBelow : spaceAbove)}px`;
  style.top = below ? `${rect.bottom + PANEL_GAP}px` : "";
  style.bottom = below ? "" : `${innerHeight - rect.top + PANEL_GAP}px`;
}

function scrollToActive(ctx: PickerContext): void {
  const row = ctx.rows[ctx.active];
  if (!row) return;
  const { list } = ctx.parts;
  list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
}

function onKeydown(ctx: PickerContext, event: KeyboardEvent): void {
  const { parts } = ctx;
  if (!ctx.open) {
    if (event.target === parts.trigger && event.key === "ArrowDown") {
      event.preventDefault();
      openPanel(ctx);
    }
    return;
  }
  if (event.key === "Escape") {
    // Stops the Escape from also closing a surrounding dialog.
    event.preventDefault();
    event.stopPropagation();
    closePanel(ctx, true);
  } else if (event.target === parts.search) {
    onSearchKey(ctx, event);
  } else if (event.target instanceof HTMLElement && event.target.matches(".model-row")) {
    onRowKey(ctx, event);
  }
}

function onSearchKey(ctx: PickerContext, event: KeyboardEvent): void {
  if (event.key === "ArrowDown") focusRow(ctx, ctx.active);
  else if (event.key === "ArrowUp") focusRow(ctx, ctx.rows.length - 1);
  else if (event.key === "Enter") pickActive(ctx);
  else return;
  // Enter would otherwise submit the dialog form around the picker.
  event.preventDefault();
}

function onRowKey(ctx: PickerContext, event: KeyboardEvent): void {
  const moves: Partial<Record<string, number>> = {
    ArrowDown: ctx.active + 1,
    ArrowUp: ctx.active - 1,
    Home: 0,
    End: ctx.rows.length - 1,
  };
  const target = moves[event.key];
  if (target !== undefined) {
    event.preventDefault();
    if (target < 0) ctx.parts.search.focus();
    else focusRow(ctx, target);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    pickActive(ctx);
  } else if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    const id = activeId(ctx);
    if (id !== undefined) toggleFavourite(ctx, id);
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    ctx.parts.search.focus();
  }
}

function pickActive(ctx: PickerContext): void {
  const id = activeId(ctx);
  if (id !== undefined) pick(ctx, id);
}

function setActive(ctx: PickerContext, index: number): void {
  ctx.rows[ctx.active]?.classList.remove("is-active");
  ctx.rows[ctx.active]?.setAttribute("tabindex", "-1");
  ctx.active = Math.min(Math.max(index, 0), Math.max(ctx.rows.length - 1, 0));
  ctx.rows[ctx.active]?.classList.add("is-active");
  ctx.rows[ctx.active]?.setAttribute("tabindex", "0");
  renderPane(ctx);
}

function focusRow(ctx: PickerContext, index: number): void {
  setActive(ctx, index);
  ctx.rows[ctx.active]?.focus();
}

function refreshList(ctx: PickerContext, keepId: string | undefined): void {
  const focused = ctx.parts.list.contains(document.activeElement);
  renderList(ctx, keepId);
  if (focused) ctx.rows[ctx.active]?.focus();
}

function renderList(ctx: PickerContext, activeModelId: string | undefined): void {
  renderControls(ctx);
  const { settings } = ctx.deps;
  const favourites = new Set(settings.favourites());
  const current = ctx.deps.current();
  const items: HTMLLIElement[] = [];
  ctx.rows = [];
  ctx.hovered = undefined;
  ctx.paneModelId = undefined;
  for (const section of pickerSections(ctx.deps.models(), view(ctx), [...favourites])) {
    if (section.label !== "") items.push(sectionHeading(section.label));
    for (const model of section.models) {
      const row = modelRow(ctx.rowTemplate, model, favourites.has(model.id), model.id === current);
      ctx.rows.push(row);
      items.push(row);
    }
  }
  ctx.parts.list.replaceChildren(...items);
  ctx.parts.empty.hidden = ctx.rows.length > 0;
  setActive(
    ctx,
    ctx.rows.findIndex((row) => row.dataset.id === activeModelId),
  );
}

function renderControls(ctx: PickerContext): void {
  const { parts } = ctx;
  const filters = view(ctx).filters;
  const privacyKnown = reportsPrivacy(ctx.deps.models());
  for (const chip of parts.filterChips.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
    const name = chip.dataset.filter;
    chip.setAttribute("aria-pressed", String(isFilterName(name) && filters.has(name)));
    chip.hidden = name === "private" && !privacyKnown;
  }
  for (const chip of parts.sortChips.querySelectorAll<HTMLButtonElement>("[data-sort]")) {
    chip.setAttribute("aria-checked", String(chip.dataset.sort === ctx.sort));
  }
  parts.favouritesToggle.setAttribute("aria-pressed", String(ctx.favouritesOnly));
  parts.filterToggle.setAttribute("aria-expanded", String(!parts.filterChips.hidden));
  parts.filterToggle.classList.toggle("is-on", filters.size > 0);
  parts.sortToggle.setAttribute("aria-expanded", String(!parts.sortChips.hidden));
  parts.sortToggle.classList.toggle("is-on", ctx.sort !== "recommended");
}

function sectionHeading(label: string): HTMLLIElement {
  const heading = document.createElement("li");
  heading.className = "model-section";
  heading.setAttribute("role", "presentation");
  heading.textContent = label;
  return heading;
}

function fillMonogram(el: HTMLElement, model: Pick<ModelInfo, "id" | "name">): void {
  const { initials, tone } = monogram(model);
  el.textContent = initials;
  el.className = `model-monogram tone-${tone}`;
}

function pill(badge: Badge): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `model-pill pill-${badge.kind}`;
  span.textContent = badge.label;
  return span;
}

function modelRow(
  template: HTMLTemplateElement,
  model: ModelInfo,
  favourite: boolean,
  current: boolean,
): HTMLLIElement {
  const row = document.importNode(template.content, true).firstElementChild;
  if (!(row instanceof HTMLLIElement)) throw new Error("Missing model picker row template");
  row.dataset.id = model.id;
  row.classList.toggle("is-current", current);
  row.classList.toggle("is-favourite", favourite);
  row.setAttribute("aria-selected", String(current));
  fillMonogram(part(row, ".model-monogram", HTMLElement), model);
  part(row, ".model-row-name", HTMLElement).textContent = model.name;
  part(row, ".model-badges", HTMLElement).replaceChildren(...modelBadges(model).map(pill));
  part(row, ".model-row-meta", HTMLElement).textContent = modelDetails(model);
  const star = part(row, ".model-star", HTMLButtonElement);
  star.replaceChildren(icon("star", 14));
  star.setAttribute("aria-pressed", String(favourite));
  star.setAttribute("aria-label", `${favourite ? "Remove from" : "Add to"} favourites`);
  star.title = favourite ? "Remove from favourites" : "Add to favourites";
  return row;
}

function renderPane(ctx: PickerContext): void {
  const id = ctx.hovered ?? activeId(ctx) ?? ctx.deps.current();
  const model = ctx.deps.models().find((entry) => entry.id === id);
  if (model !== undefined && model.id === ctx.paneModelId) return;
  ctx.paneModelId = model?.id;
  const pane = ctx.parts.pane;
  pane.monogram.hidden = model === undefined;
  if (model) fillMonogram(pane.monogram, model);
  pane.name.textContent = model?.name ?? "";
  pane.id.textContent = model?.id ?? "";
  pane.tags.replaceChildren(...(model ? modelTags(model).map(pill) : []));
  pane.description.textContent = model?.description ?? "";
  pane.description.hidden = !model?.description;
  pane.facts.replaceChildren(
    ...(model ? modelFacts(model) : []).flatMap(([label, value]) => {
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      return [term, detail];
    }),
  );
}

function renderTrigger(ctx: PickerContext): void {
  const { trigger, triggerMonogram, triggerName, triggerPrivacy } = ctx.parts;
  const id = ctx.deps.current() ?? "";
  const model = ctx.deps.models().find((entry) => entry.id === id);
  fillMonogram(triggerMonogram, model ?? { id, name: id });
  triggerMonogram.hidden = id === "";
  triggerName.textContent = model?.name ?? (id || "Choose a model");
  trigger.title = model?.name ?? id;
  const privacy = model?.privacy ?? "unknown";
  triggerPrivacy.hidden = privacy === "unknown";
  triggerPrivacy.textContent = privacy === "private" ? "Private" : "Anon";
  triggerPrivacy.className = `model-pill model-trigger-privacy pill-${privacy === "private" ? "private" : "anon"}`;
}
