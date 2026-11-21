export interface MenuParts {
  control: HTMLElement;
  button: HTMLButtonElement;
  // A built list is made on each open and removed on close; a static one is hidden instead.
  list: HTMLElement | (() => HTMLElement);
  items: string;
  onPick(item: HTMLElement): void;
  onToggle?: (open: boolean) => void;
}

export interface MenuHandle {
  close(returnFocus?: boolean): void;
}

export function dismissOnOutside(
  inside: HTMLElement | readonly HTMLElement[],
  close: () => void,
): () => void {
  const areas = inside instanceof HTMLElement ? [inside] : inside;
  const listening = new AbortController();
  const onPress = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Node) || !areas.some((area) => area.contains(target))) close();
  };
  document.addEventListener("pointerdown", onPress, { capture: true, signal: listening.signal });
  return () => listening.abort();
}

function menuTarget(key: string, at: number, count: number): number | undefined {
  switch (key) {
    case "ArrowDown":
      return (at + 1) % count;
    case "ArrowUp":
      return at <= 0 ? count - 1 : at - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

interface MenuState {
  parts: MenuParts;
  shown: HTMLElement | null;
  stopOutside: (() => void) | null;
}

export function attachMenu(parts: MenuParts): MenuHandle {
  const menu: MenuState = { parts, shown: null, stopOutside: null };
  const { control, button } = parts;
  button.addEventListener("click", () => {
    if (menu.shown) closeMenu(menu, false);
    else openMenu(menu);
  });
  control.addEventListener("click", (event) => {
    const item = event.target instanceof Element ? event.target.closest(parts.items) : null;
    if (!(item instanceof HTMLElement)) return;
    closeMenu(menu, true);
    parts.onPick(item);
  });
  control.addEventListener("keydown", (event) => onMenuKey(menu, event));
  // Safari and Firefox on macOS do not focus a clicked button, so a click blurs to nothing.
  control.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !control.contains(next)) closeMenu(menu, false);
  });
  return { close: (returnFocus = false) => closeMenu(menu, returnFocus) };
}

function menuItems(menu: MenuState): HTMLElement[] {
  const items = menu.shown?.querySelectorAll<HTMLElement>(menu.parts.items) ?? [];
  return [...items].filter((item) => !item.hidden);
}

function openMenu(menu: MenuState): void {
  const { parts } = menu;
  const list = typeof parts.list === "function" ? parts.list() : parts.list;
  if (typeof parts.list === "function") parts.control.append(list);
  list.hidden = false;
  menu.shown = list;
  menu.stopOutside = dismissOnOutside(parts.control, () => closeMenu(menu, false));
  parts.button.setAttribute("aria-expanded", "true");
  parts.onToggle?.(true);
  const items = menuItems(menu);
  (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
}

// Cleared before the list goes, since removing a focused list fires focusout, which closes again.
function closeMenu(menu: MenuState, returnFocus: boolean): void {
  const { parts } = menu;
  const shown = menu.shown;
  if (!shown) return;
  menu.shown = null;
  menu.stopOutside?.();
  menu.stopOutside = null;
  if (typeof parts.list === "function") shown.remove();
  else shown.hidden = true;
  parts.button.setAttribute("aria-expanded", "false");
  parts.onToggle?.(false);
  if (returnFocus) parts.button.focus();
}

// The Escape is claimed so it closes only the menu, not a drawer around it or the running turn.
function onMenuKey(menu: MenuState, event: KeyboardEvent): void {
  if (!menu.shown) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(menu, true);
    return;
  }
  const items = menuItems(menu);
  const at = items.findIndex((item) => item === document.activeElement);
  const target = menuTarget(event.key, at, items.length);
  if (target === undefined) return;
  event.preventDefault();
  items[target]?.focus();
}
