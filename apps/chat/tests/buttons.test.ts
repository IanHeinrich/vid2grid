import { describe, expect, it, vi } from "vitest";
import { editKeys, iconButton, inlineEdit } from "../src/ui/shared/buttons";

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

  it("ignores the Enter that confirms an IME composition", () => {
    const input = document.createElement("input");
    const finish = vi.fn();
    inlineEdit(input, finish);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }));
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("editKeys", () => {
  function editRow() {
    const row = document.createElement("li");
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const button = document.createElement("button");
    row.append(input, textarea, button);
    const save = vi.fn();
    const cancel = vi.fn();
    editKeys(row, { save, cancel });
    const press = (target: HTMLElement, key: string, isComposing = false) => {
      const event = new KeyboardEvent("keydown", {
        key,
        isComposing,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    };
    return { input, textarea, button, save, cancel, press };
  }

  it("saves on Enter in a one-line input only", () => {
    const { input, textarea, button, save, press } = editRow();
    press(textarea, "Enter");
    press(button, "Enter");
    expect(save).not.toHaveBeenCalled();
    press(input, "Enter");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("ignores keys that confirm an IME composition", () => {
    const { input, save, cancel, press } = editRow();
    press(input, "Enter", true);
    press(input, "Escape", true);
    expect(save).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape anywhere in the row and claims the key", () => {
    const { button, cancel, press } = editRow();
    expect(press(button, "Escape").defaultPrevented).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
