import { beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { queryElements, type AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  blankChat,
  createAppState,
  replaceChat,
  setCurrentChat,
  type AppState,
} from "../src/state";
import {
  initChatDrawer,
  initKnowledgeDrawer,
  KNOWLEDGE_TABS,
  SETTINGS_TABS,
  type ChatDrawer,
  type KnowledgeDrawer,
} from "../src/ui/chatDrawer";

let els: AppElements;
let state: AppState;

function drawer(wide = false, onClose = vi.fn()): ChatDrawer {
  return initChatDrawer(els, state, { isWide: () => wide, onClose });
}

function knowledgeDrawer(wide = false): KnowledgeDrawer {
  return initKnowledgeDrawer(els, state, { isWide: () => wide });
}

function tab(name: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[role="tab"][data-tab="${name}"]`);
  if (!found) throw new Error(`No tab ${name}`);
  return found;
}

function panelFor(name: string): HTMLElement {
  const panel = document.getElementById(
    tab(name).getAttribute("aria-controls")?.split(" ").at(-1) ?? "",
  );
  if (!panel) throw new Error(`No panel for ${name}`);
  return panel;
}

function press(target: HTMLElement, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = indexHtml;
  els = queryElements();
  state = createAppState(DEFAULT_SETTINGS);
  const chat = blankChat("model", "chat", 1);
  replaceChat(state, chat);
  setCurrentChat(state, chat, []);
});

describe("chat drawer", () => {
  it("has a tab and a panel for each section", () => {
    drawer();
    knowledgeDrawer();
    for (const name of SETTINGS_TABS) {
      expect(els.drawer.tabList.contains(tab(name))).toBe(true);
      expect(panelFor(name).getAttribute("role")).toBe("tabpanel");
    }
    for (const name of KNOWLEDGE_TABS) {
      expect(els.knowledge.tabList.contains(tab(name))).toBe(true);
      expect(els.knowledge.body.contains(panelFor(name))).toBe(true);
    }
  });

  it("opens from the Chat settings button and closes from it again", () => {
    drawer();
    const { chatSettingsToggle } = els.header;
    chatSettingsToggle.click();
    expect(els.chatSettings.panel.hidden).toBe(false);
    expect(chatSettingsToggle.getAttribute("aria-expanded")).toBe("true");
    chatSettingsToggle.click();
    expect(els.chatSettings.panel.hidden).toBe(true);
    expect(chatSettingsToggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on the asked-for tab and shows only its panel", () => {
    const chatDrawer = drawer();
    chatDrawer.open("model");
    expect(tab("model").getAttribute("aria-selected")).toBe("true");
    expect(panelFor("model").hidden).toBe(false);
    expect(panelFor("persona").hidden).toBe(true);
    expect(document.activeElement).toBe(tab("model"));
  });

  it("switches tabs by click and by arrow keys", () => {
    knowledgeDrawer().open();
    tab("scene").click();
    expect(panelFor("scene").hidden).toBe(false);
    press(tab("scene"), "ArrowRight");
    expect(tab("timeline").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("timeline"));
    press(tab("timeline"), "End");
    expect(tab("people").getAttribute("aria-selected")).toBe("true");
    press(tab("people"), "ArrowRight");
    expect(tab("summary").getAttribute("aria-selected")).toBe("true");
  });
});

describe("knowledge drawer", () => {
  it("opens from its own header button, apart from chat settings", () => {
    drawer();
    knowledgeDrawer();
    const { knowledgeToggle } = els.header;
    knowledgeToggle.click();
    expect(els.knowledge.panel.hidden).toBe(false);
    expect(knowledgeToggle.getAttribute("aria-expanded")).toBe("true");
    expect(els.chatSettings.panel.hidden).toBe(true);
    knowledgeToggle.click();
    expect(els.knowledge.panel.hidden).toBe(true);
  });

  it("shows the video picker only beside the per-video sections", () => {
    const knowledge = knowledgeDrawer();
    const picker = document.getElementById("knowledgeVideo");
    knowledge.open("summary");
    expect(picker?.hidden).toBe(true);
    knowledge.open("timeline");
    expect(picker?.hidden).toBe(false);
    tab("people").click();
    expect(picker?.hidden).toBe(false);
    expect(panelFor("people").hidden).toBe(false);
    expect(panelFor("timeline").hidden).toBe(true);
    tab("scene").click();
    expect(picker?.hidden).toBe(true);
  });

  it("closes the other drawer when one opens", () => {
    const settings = initChatDrawer(els, state, { onOpen: () => knowledge.close() });
    const knowledge = initKnowledgeDrawer(els, state, { onOpen: () => settings.close() });
    settings.open();
    knowledge.open("timeline");
    expect(settings.isOpen()).toBe(false);
    expect(knowledge.isOpen()).toBe(true);
    expect(document.activeElement).toBe(tab("timeline"));
    settings.open();
    expect(knowledge.isOpen()).toBe(false);
  });
});

describe("chat drawer dismissal", () => {
  it("closes on Escape and gives focus back to where it was", () => {
    const onClose = vi.fn();
    const chatDrawer = drawer(false, onClose);
    els.composer.messageInput.focus();
    chatDrawer.open();
    const event = press(tab("persona"), "Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(chatDrawer.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(els.composer.messageInput);
  });

  it("leaves an Escape another control has handled alone", () => {
    const chatDrawer = drawer();
    chatDrawer.open();
    els.chatSettings.systemPromptInput.addEventListener("keydown", (event) =>
      event.preventDefault(),
    );
    press(els.chatSettings.systemPromptInput, "Escape");
    expect(chatDrawer.isOpen()).toBe(true);
  });

  it("closes from the close button and the backdrop", () => {
    const chatDrawer = drawer();
    chatDrawer.open();
    els.drawer.closeButton.click();
    expect(chatDrawer.isOpen()).toBe(false);
    chatDrawer.open();
    expect(els.drawer.backdrop.hidden).toBe(false);
    els.drawer.backdrop.click();
    expect(chatDrawer.isOpen()).toBe(false);
    expect(els.drawer.backdrop.hidden).toBe(true);
  });
});

describe("chat drawer layout", () => {
  it("is a modal dialog that keeps Tab inside it on narrow screens", () => {
    drawer(false).open("model");
    const { panel } = els.chatSettings;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    els.drawer.closeButton.focus();
    const back = press(els.drawer.closeButton, "Tab", true);
    expect(back.defaultPrevented).toBe(true);
    const last = [...panel.querySelectorAll<HTMLElement>("button, input, select, textarea")]
      .filter((button) => !button.closest("[hidden]"))
      .at(-1);
    expect(document.activeElement).toBe(last);
    if (last) press(last, "Tab");
    expect(document.activeElement).toBe(els.drawer.closeButton);
  });

  it("sits beside the conversation without a backdrop or trap on wide screens", () => {
    drawer(true).open();
    const { panel } = els.chatSettings;
    expect(els.drawer.backdrop.hidden).toBe(true);
    expect(panel.getAttribute("role")).toBe("complementary");
    expect(panel.hasAttribute("aria-modal")).toBe(false);
    els.drawer.closeButton.focus();
    expect(press(els.drawer.closeButton, "Tab", true).defaultPrevented).toBe(false);
  });

  it("makes the settings and knowledge inert while no chat is open", () => {
    setCurrentChat(state, null, []);
    drawer().render();
    knowledgeDrawer().render();
    expect(els.drawer.body.inert).toBe(true);
    expect(els.knowledge.body.inert).toBe(true);
  });
});
