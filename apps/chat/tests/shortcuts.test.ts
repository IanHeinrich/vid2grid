import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { queryElements, type AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import { blankChat, createAppState, setCurrentChat } from "../src/state";
import {
  initChatDrawer,
  initKnowledgeDrawer,
  type ChatDrawer,
  type KnowledgeDrawer,
} from "../src/ui/chatDrawer";
import { initShortcuts } from "../src/ui/shortcuts";

let els: AppElements;
let running: boolean;
let deps: {
  isRunning: () => boolean;
  stop: () => void;
  editLastMessage: () => boolean;
  chatDrawer: ChatDrawer;
  knowledge: KnowledgeDrawer;
};
let dispose: () => void;

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = indexHtml;
  els = queryElements();
  running = true;
  const state = createAppState(DEFAULT_SETTINGS);
  setCurrentChat(state, blankChat("m", "chat", 1), []);
  deps = {
    isRunning: () => running,
    stop: vi.fn(),
    editLastMessage: vi.fn(() => true),
    chatDrawer: initChatDrawer(els, state, { isWide: () => true }),
    knowledge: initKnowledgeDrawer(els, state, { isWide: () => true }),
  };
  dispose = initShortcuts(els, deps);
});

afterEach(() => dispose());

describe("Escape", () => {
  it("stops a running turn", () => {
    press({ key: "Escape" });
    expect(deps.stop).toHaveBeenCalledTimes(1);
  });

  it("leaves an open dialog or an idle chat alone", () => {
    els.lightbox.dialog.setAttribute("open", "");
    press({ key: "Escape" });
    els.lightbox.dialog.removeAttribute("open");
    running = false;
    press({ key: "Escape" });
    expect(deps.stop).not.toHaveBeenCalled();
  });
});

describe("ArrowUp", () => {
  it("edits the last message from an empty composer only", () => {
    const input = els.composer.messageInput;
    expect(press({ key: "ArrowUp" }, input).defaultPrevented).toBe(true);
    expect(deps.editLastMessage).toHaveBeenCalledTimes(1);
    input.value = "draft";
    press({ key: "ArrowUp" }, input);
    expect(deps.editLastMessage).toHaveBeenCalledTimes(1);
  });
});

describe("chat shortcuts", () => {
  it("starts a new chat on Ctrl+Alt+N", () => {
    const newChat = vi.fn();
    els.sidebar.newChatButton.addEventListener("click", newChat);
    expect(press({ code: "KeyN", key: "n", ctrlKey: true, altKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(newChat).toHaveBeenCalledTimes(1);
  });

  it("leaves a focused field before Ctrl+Alt+N, so its edit saves into the chat it was typed in", () => {
    const order: string[] = [];
    const prompt = els.chatSettings.systemPromptInput;
    prompt.focus();
    prompt.addEventListener("blur", () => order.push("blur"));
    els.sidebar.newChatButton.addEventListener("click", () => order.push("new chat"));
    press({ code: "KeyN", key: "n", ctrlKey: true, altKey: true }, prompt);
    expect(order).toEqual(["blur", "new chat"]);
    expect(document.activeElement).toBe(prompt);
  });

  it("opens chat settings on the Instructions tab with the prompt focused on Ctrl+,", () => {
    els.drawer.tabList.querySelector<HTMLButtonElement>("[data-tab='model']")?.click();
    press({ key: ",", ctrlKey: true });
    expect(els.chatSettings.panel.hidden).toBe(false);
    expect(els.chatSettings.systemPromptInput.closest("[hidden]")).toBeNull();
    expect(document.activeElement).toBe(els.chatSettings.systemPromptInput);
  });
});

describe("knowledge shortcut", () => {
  it("opens the Knowledge drawer on Ctrl+Alt+K", () => {
    const opened = press({ code: "KeyK", key: "k", ctrlKey: true, altKey: true });
    expect(opened.defaultPrevented).toBe(true);
    expect(els.knowledge.panel.hidden).toBe(false);
  });

  it("waits while a modal dialog is open", () => {
    els.settingsDialog.dialog.setAttribute("open", "");
    press({ code: "KeyK", key: "k", ctrlKey: true, altKey: true });
    expect(els.knowledge.panel.hidden).toBe(true);
  });
});

describe("chat shortcuts under a modal dialog", () => {
  it("leaves Ctrl+Alt+N and Ctrl+, alone while a modal dialog is open", () => {
    const newChat = vi.fn();
    els.sidebar.newChatButton.addEventListener("click", newChat);
    els.settingsDialog.dialog.setAttribute("open", "");
    const created = press({ code: "KeyN", key: "n", ctrlKey: true, altKey: true });
    const settings = press({ key: ",", ctrlKey: true });
    expect(created.defaultPrevented).toBe(false);
    expect(settings.defaultPrevented).toBe(false);
    expect(newChat).not.toHaveBeenCalled();
    expect(els.chatSettings.panel.hidden).toBe(true);
  });
});

describe("the shortcut list", () => {
  it("opens from its button and closes on Escape or a click elsewhere", () => {
    const { toggle, popover } = els.shortcuts;
    toggle.click();
    expect(popover.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(popover.textContent).toContain("New chat");
    press({ key: "Escape" });
    expect(popover.hidden).toBe(true);
    expect(deps.stop).not.toHaveBeenCalled();
    toggle.click();
    document.body.click();
    expect(popover.hidden).toBe(true);
  });
});
