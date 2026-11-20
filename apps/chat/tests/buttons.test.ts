import { describe, expect, it, vi } from "vitest";
import { iconButton, inlineEdit } from "../src/ui/buttons";

describe("iconButton", () => {
  it("names the button by its label for both the tooltip and screen readers", () => {
    const onClick = vi.fn();
    const button = iconButton("note-delete", "Delete this note", "×", onClick);
    expect(button.type).toBe("button");
    expect(button.title).toBe("Delete this note");
    expect(button.getAttribute("aria-label")).toBe("Delete this note");
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("inlineEdit", () => {
  it("cancels once on Escape and claims the key", () => {
    const input = document.createElement("input");
    const finish = vi.fn();
    inlineEdit(input, finish);
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    input.dispatchEvent(escape);
    input.dispatchEvent(new FocusEvent("blur"));
    expect(escape.defaultPrevented).toBe(true);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(false);
  });

  it("saves on Enter or blur", () => {
    const input = document.createElement("input");
    const finish = vi.fn();
    inlineEdit(input, finish);
    input.dispatchEvent(new FocusEvent("blur"));
    expect(finish).toHaveBeenCalledWith(true);
  });
});
