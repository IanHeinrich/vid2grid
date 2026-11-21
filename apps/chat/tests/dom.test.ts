import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import { queryElements } from "../src/dom";

describe("queryElements", () => {
  it("finds every element the app needs in index.html", () => {
    document.body.innerHTML = indexHtml;
    expect(() => queryElements()).not.toThrow();
  });

  it("fails fast naming a missing element", () => {
    document.body.innerHTML = "";
    expect(() => queryElements()).toThrow("#mainColumn");
  });

  it("fails fast on an element of the wrong type", () => {
    document.body.innerHTML = indexHtml;
    document
      .getElementById("miniPlayerVideo")
      ?.replaceWith(Object.assign(document.createElement("div"), { id: "miniPlayerVideo" }));
    expect(() => queryElements()).toThrow("#miniPlayerVideo");
  });

  it("finds an empty model picker mount for each of the three model choices", () => {
    document.body.innerHTML = indexHtml;
    const els = queryElements();
    const mounts = [
      els.chatSettings.modelPicker,
      els.settingsDialog.defaultModelPicker,
      els.study.modelPicker,
    ];
    expect(mounts.every((mount) => mount.childElementCount === 0)).toBe(true);
    expect(document.querySelectorAll("select[id$='odelSelect']")).toHaveLength(0);
    expect(els.templates.modelPicker.content.querySelector(".model-picker")).not.toBeNull();
    expect(els.templates.modelRow.content.querySelector(".model-row")).not.toBeNull();
  });
});

describe("drawer markup", () => {
  it("splits the instructions and model from the knowledge sections", () => {
    document.body.innerHTML = indexHtml;
    const els = queryElements();
    const settings = [
      els.chatSettings.systemPromptInput,
      els.chatSettings.videoReferencesSelect,
      els.chatSettings.characterNames,
      els.chatSettings.modelPicker,
    ];
    const knowledge = [
      els.memory.storyInput,
      els.sceneLog.list,
      els.cast.list,
      els.study.list,
      els.study.audioList,
      els.knowledge.videoSelect,
    ];
    expect(settings.every((el) => els.chatSettings.panel.contains(el))).toBe(true);
    expect(knowledge.every((el) => els.knowledge.panel.contains(el))).toBe(true);
    expect(els.header.chatSettingsToggle.getAttribute("aria-controls")).toBe(
      els.chatSettings.panel.id,
    );
    expect(els.header.knowledgeToggle.getAttribute("aria-controls")).toBe(els.knowledge.panel.id);
  });
});

describe("conversation view markup", () => {
  it("finds the ready card with its title and starters, and the turn announcer", () => {
    document.body.innerHTML = indexHtml;
    const { conversation } = queryElements();
    expect(conversation.scroller.contains(conversation.readyCard)).toBe(true);
    expect(conversation.readyStarters.querySelectorAll("button.starter").length).toBeGreaterThan(0);
    expect(conversation.announcer.getAttribute("role")).toBe("status");
  });

  it("finds the lightbox stage, zoom, ask and hint, and the shortcuts popover", () => {
    document.body.innerHTML = indexHtml;
    const { lightbox, shortcuts } = queryElements();
    expect(lightbox.stage.contains(lightbox.image)).toBe(true);
    const controls = [lightbox.zoomIn, lightbox.zoomOut, lightbox.ask, lightbox.hint];
    expect(controls.every((el) => lightbox.dialog.contains(el))).toBe(true);
    expect(lightbox.zoomIn).toBeInstanceOf(HTMLButtonElement);
    expect(lightbox.ask).toBeInstanceOf(HTMLButtonElement);
    expect(shortcuts.toggle.getAttribute("aria-controls")).toBe(shortcuts.popover.id);
  });
});
