import type { AppElements } from "../dom";
import type { AppState } from "../state";
import { headerLabel } from "./buttons";
import { icon, type IconName } from "./icons";

export const SETTINGS_TABS = ["persona", "model"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const KNOWLEDGE_TABS = ["summary", "scene", "timeline", "people"] as const;
export type KnowledgeTab = (typeof KNOWLEDGE_TABS)[number];

// Matches the styles/drawer.css breakpoint where a drawer sits beside the conversation.
const WIDE_QUERY = "(min-width: 1280px)";
const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

export interface Drawer<Tab extends string> {
  open(tab?: Tab): void;
  close(): void;
  isOpen(): boolean;
  render(): void;
}

export type ChatDrawer = Drawer<SettingsTab>;
export type KnowledgeDrawer = Drawer<KnowledgeTab>;

export interface DrawerDeps {
  onOpen?: () => void;
  onClose?: () => void;
  isWide?: () => boolean;
}

export interface DrawerParts {
  toggle: HTMLButtonElement;
  panel: HTMLElement;
  backdrop: HTMLElement;
  closeButton: HTMLButtonElement;
  tabList: HTMLElement;
  body: HTMLElement;
}

interface DrawerSpec<Tab extends string> {
  tabs: readonly Tab[];
  icon: IconName;
}

interface DrawerContext<Tab extends string> {
  parts: DrawerParts;
  spec: DrawerSpec<Tab>;
  state: AppState;
  deps: DrawerDeps;
  tabs: HTMLButtonElement[];
  tab: Tab;
  returnFocus: HTMLElement | null;
}

function matchesWide(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches;
}

export function initChatDrawer(
  els: Pick<AppElements, "header" | "chatSettings" | "drawer">,
  state: AppState,
  deps: DrawerDeps = {},
): ChatDrawer {
  const parts = { toggle: els.header.chatSettingsToggle, panel: els.chatSettings.panel };
  return initDrawer(
    { ...parts, ...els.drawer },
    { tabs: SETTINGS_TABS, icon: "sliders" },
    state,
    deps,
  );
}

export function initKnowledgeDrawer(
  els: Pick<AppElements, "header" | "knowledge">,
  state: AppState,
  deps: DrawerDeps = {},
): KnowledgeDrawer {
  const { panel, backdrop, closeButton, tabList, body } = els.knowledge;
  const parts = { toggle: els.header.knowledgeToggle, panel, backdrop, closeButton, tabList, body };
  return initDrawer(parts, { tabs: KNOWLEDGE_TABS, icon: "compare" }, state, deps);
}

function initDrawer<Tab extends string>(
  parts: DrawerParts,
  spec: DrawerSpec<Tab>,
  state: AppState,
  deps: DrawerDeps,
): Drawer<Tab> {
  const [first] = spec.tabs;
  if (first === undefined) throw new Error("A drawer needs at least one tab");
  const ctx: DrawerContext<Tab> = {
    parts,
    spec,
    state,
    deps,
    tabs: [...parts.tabList.querySelectorAll<HTMLButtonElement>("[role='tab']")],
    tab: first,
    returnFocus: null,
  };
  listen(ctx);
  selectTab(ctx, ctx.tab);
  render(ctx);
  return {
    open: (tab) => open(ctx, tab),
    close: () => close(ctx),
    isOpen: () => !parts.panel.hidden,
    render: () => render(ctx),
  };
}

function tabNamed<Tab extends string>(ctx: DrawerContext<Tab>, value: string | undefined) {
  return ctx.spec.tabs.find((tab) => tab === value);
}

function listen<Tab extends string>(ctx: DrawerContext<Tab>): void {
  const { toggle, panel, closeButton, backdrop, tabList } = ctx.parts;
  toggle.replaceChildren(icon(ctx.spec.icon), headerLabel(toggle.textContent.trim()));
  toggle.addEventListener("click", () => {
    if (panel.hidden) open(ctx);
    else close(ctx);
  });
  closeButton.addEventListener("click", () => close(ctx));
  backdrop.addEventListener("click", () => close(ctx));
  for (const tab of ctx.tabs) {
    tab.addEventListener("click", () => {
      const name = tabNamed(ctx, tab.dataset.tab);
      if (name !== undefined) selectTab(ctx, name);
    });
  }
  tabList.addEventListener("keydown", (event) => onTabKey(ctx, event));
  panel.addEventListener("keydown", (event) => onDrawerKey(ctx, event));
  window.addEventListener("resize", () => {
    if (!panel.hidden) applyMode(ctx);
  });
}

function isOverlay<Tab extends string>(ctx: DrawerContext<Tab>): boolean {
  return !(ctx.deps.isWide ?? matchesWide)();
}

function applyMode<Tab extends string>(ctx: DrawerContext<Tab>): void {
  const { panel, backdrop } = ctx.parts;
  const overlay = isOverlay(ctx) && !panel.hidden;
  backdrop.hidden = !overlay;
  panel.setAttribute("role", overlay ? "dialog" : "complementary");
  if (overlay) panel.setAttribute("aria-modal", "true");
  else panel.removeAttribute("aria-modal");
}

function open<Tab extends string>(ctx: DrawerContext<Tab>, tab?: Tab): void {
  const { panel, toggle } = ctx.parts;
  if (tab !== undefined) selectTab(ctx, tab);
  if (panel.hidden) {
    const active = document.activeElement;
    ctx.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    ctx.deps.onOpen?.();
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }
  applyMode(ctx);
  currentTab(ctx)?.focus();
}

function close<Tab extends string>(ctx: DrawerContext<Tab>): void {
  const { panel, toggle } = ctx.parts;
  if (panel.hidden) return;
  panel.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  applyMode(ctx);
  ctx.deps.onClose?.();
  const back = ctx.returnFocus;
  // Focus may have come from the other drawer, which has closed since.
  const target = back?.isConnected && back.closest("[hidden]") === null ? back : toggle;
  ctx.returnFocus = null;
  target.focus();
}

function currentTab<Tab extends string>(ctx: DrawerContext<Tab>): HTMLButtonElement | undefined {
  return ctx.tabs.find((tab) => tab.dataset.tab === ctx.tab);
}

function controlled(tab: HTMLButtonElement): string[] {
  return (tab.getAttribute("aria-controls") ?? "").split(" ").filter((id) => id !== "");
}

// A tab may control several regions, and a region shared by two tabs shows for either.
function selectTab<Tab extends string>(ctx: DrawerContext<Tab>, name: Tab): void {
  ctx.tab = name;
  const current = currentTab(ctx);
  const shown = new Set(current ? controlled(current) : []);
  for (const tab of ctx.tabs) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    for (const id of controlled(tab)) {
      const region = document.getElementById(id);
      if (region) region.hidden = !shown.has(id);
    }
  }
}

function onTabKey<Tab extends string>(ctx: DrawerContext<Tab>, event: KeyboardEvent): void {
  const index = ctx.tabs.findIndex((tab) => tab.dataset.tab === ctx.tab);
  const last = ctx.tabs.length - 1;
  const next: Record<string, number> = {
    ArrowRight: index === last ? 0 : index + 1,
    ArrowLeft: index === 0 ? last : index - 1,
    Home: 0,
    End: last,
  };
  const target = ctx.tabs[next[event.key] ?? -1];
  const name = tabNamed(ctx, target?.dataset.tab);
  if (!target || name === undefined) return;
  event.preventDefault();
  selectTab(ctx, name);
  target.focus();
}

function onDrawerKey<Tab extends string>(ctx: DrawerContext<Tab>, event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close(ctx);
  } else if (event.key === "Tab" && isOverlay(ctx)) {
    trapFocus(ctx, event);
  }
}

function trapFocus<Tab extends string>(ctx: DrawerContext<Tab>, event: KeyboardEvent): void {
  const focusable = [...ctx.parts.panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[hidden], [inert]"),
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function render<Tab extends string>(ctx: DrawerContext<Tab>): void {
  ctx.parts.body.inert = ctx.state.currentChat === null;
}
