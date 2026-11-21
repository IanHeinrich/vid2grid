import { formatTimestamp } from "../time";
import { icon } from "./icons";

export function smallButton(
  className: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

export function iconButton(
  className: string,
  label: string,
  glyph: string | Node,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(glyph);
  button.addEventListener("click", onClick);
  return button;
}

// The label hides when the header is narrow, and stays the button's accessible name.
export function headerLabel(text: string): HTMLSpanElement {
  const label = document.createElement("span");
  label.className = "header-label";
  label.textContent = text;
  return label;
}

export function seekButton(
  seconds: number,
  onSeek: (seconds: number) => void,
  label = formatTimestamp(seconds, seconds % 1 !== 0),
): HTMLButtonElement {
  const button = smallButton("timestamp", label, () => onSeek(seconds));
  button.title = `Play from ${formatTimestamp(seconds)}`;
  return button;
}

export function setPinState(button: HTMLButtonElement, pinned: boolean): void {
  if (!button.querySelector(".icon-pin")) button.replaceChildren(icon("pin", 14));
  button.title = pinned ? "Pinned: always sent. Click to unpin" : "Pin: always send this image";
  button.setAttribute("aria-label", pinned ? "Unpin image" : "Pin image");
  button.setAttribute("aria-pressed", String(pinned));
}

export function pinToggle(pinned: boolean, onToggle: () => void): HTMLButtonElement {
  const button = smallButton("pin-toggle", "", onToggle);
  setPinState(button, pinned);
  return button;
}

// Enter and blur save, Escape cancels; the Escape is claimed so a drawer around it stays open.
export function inlineEdit(input: HTMLInputElement, finish: (save: boolean) => void): void {
  let settled = false;
  const settle = (save: boolean) => {
    if (settled) return;
    settled = true;
    finish(save);
  };
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") settle(true);
    if (event.key !== "Escape") return;
    event.preventDefault();
    settle(false);
  });
  input.addEventListener("blur", () => settle(true));
}
