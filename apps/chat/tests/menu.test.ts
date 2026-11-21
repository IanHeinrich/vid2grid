import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachMenu, dismissOnOutside, type MenuParts } from "../src/ui/menu";

let control: HTMLDivElement;
let button: HTMLButtonElement;
let outside: HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = "";
  control = document.createElement("div");
  button = document.createElement("button");
  outside = document.createElement("button");
  control.append(button);
  document.body.append(control, outside);
});

function listOf(checked: string): HTMLDivElement {
  const list = document.createElement("div");
  list.hidden = true;
  for (const value of ["one", "two", "three"]) {
    const item = document.createElement("button");
    item.className = "item";
    item.dataset["value"] = value;
    item.setAttribute("aria-checked", String(value === checked));
    item.textContent = value;
    list.append(item);
  }
  return list;
}

function item(value: string): HTMLElement | null {
  return control.querySelector<HTMLElement>(`[data-value="${value}"]`);
}

function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function attach(overrides: Partial<MenuParts> = {}) {
  const onPick = vi.fn();
  const list = listOf("two");
  control.append(list);
  const handle = attachMenu({ control, button, list, items: ".item", onPick, ...overrides });
  return { list, onPick, handle };
}

describe("attachMenu", () => {
  it("opens on the checked item and moves with the arrow keys, Home and End", () => {
    const { list } = attach();
    button.click();
    expect(list.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(item("two"));
    press(item("two") ?? list, "ArrowDown");
    expect(document.activeElement).toBe(item("three"));
    press(item("three") ?? list, "ArrowDown");
    expect(document.activeElement).toBe(item("one"));
    press(item("one") ?? list, "ArrowUp");
    expect(document.activeElement).toBe(item("three"));
    press(item("three") ?? list, "Home");
    expect(document.activeElement).toBe(item("one"));
    press(item("one") ?? list, "End");
    expect(document.activeElement).toBe(item("three"));
  });

  it("skips hidden items", () => {
    const { list } = attach();
    const hidden = item("one");
    if (hidden) hidden.hidden = true;
    button.click();
    press(item("two") ?? list, "ArrowDown");
    press(item("three") ?? list, "ArrowDown");
    expect(document.activeElement).toBe(item("two"));
  });

  it("closes on Escape, returns focus to its button and claims the key", () => {
    const { list } = attach();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    button.click();
    const escape = press(item("two") ?? list, "Escape");
    document.removeEventListener("keydown", outer);
    expect(escape.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(list.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("leaves Escape alone while closed", () => {
    attach();
    expect(press(button, "Escape").defaultPrevented).toBe(false);
  });

  it("picks an item, closing first and returning focus", () => {
    const { list, onPick } = attach();
    button.click();
    item("three")?.click();
    expect(onPick).toHaveBeenCalledWith(item("three"));
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it("closes on a press outside, but not on one inside", () => {
    const { list } = attach();
    button.click();
    item("one")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(list.hidden).toBe(false);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(list.hidden).toBe(true);
  });

  it("closes when focus moves to an element outside, not when it moves to nothing", () => {
    const { list } = attach();
    button.click();
    const from = item("two") ?? list;
    from.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(list.hidden).toBe(false);
    from.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: button }));
    expect(list.hidden).toBe(false);
    from.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    expect(list.hidden).toBe(true);
  });

  it("builds a list on each open and removes it on close, reporting each toggle", () => {
    const onToggle = vi.fn();
    const built = () => Object.assign(listOf("one"), { className: "built" });
    attachMenu({ control, button, list: built, items: ".item", onPick: vi.fn(), onToggle });
    expect(control.querySelector(".built")).toBeNull();
    button.click();
    expect(control.querySelector(".built")).not.toBeNull();
    expect(onToggle).toHaveBeenLastCalledWith(true);
    button.click();
    expect(control.querySelector(".built")).toBeNull();
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("closes from its handle", () => {
    const { list, handle } = attach();
    button.click();
    handle.close(true);
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });
});

describe("dismissOnOutside", () => {
  it("closes on a press outside every area until removed", () => {
    const close = vi.fn();
    const stop = dismissOnOutside([control, button], close);
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
    stop();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
