import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initConversation } from "../src/ui/conversation/conversation";
import {
  buttonsLabelled,
  deps,
  els,
  exchanges,
  list,
  resetConversation,
  setRunning,
  spies,
} from "./support/conversation";
import { assistant, user } from "./support/factories";

beforeEach(resetConversation);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("thoroughness and reasoning tags", () => {
  it("tags an exhaustive reply, an old deep one as exhaustive, and a picked reasoning level", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "Go", { thoroughness: "exhaustive", reasoningEffort: "high" }),
      user("u2", "Again", { deep: true }),
      user("u3", "Plain"),
    ]);
    const tags = [...list().querySelectorAll(".deep-tag")].map((tag) => tag.textContent);
    expect(tags).toEqual(["Exhaustive", "Exhaustive"]);
    const efforts = [...list().querySelectorAll(".effort-tag")].map((tag) => tag.textContent);
    expect(efforts).toEqual(["Reasoning: high"]);
  });
});

describe("keep going, continuations and running", () => {
  it("shows Keep going under the latest reply that stopped at the round limit", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "Go"),
      assistant("a1", "So far…", { stoppedAtRoundLimit: true }),
    ]);
    const keepGoing = buttonsLabelled("Keep going");
    expect(keepGoing).toHaveLength(1);
    keepGoing[0]?.click();
    expect(spies.onKeepGoing).toHaveBeenCalled();
  });

  it("renders continuations as a marker without Edit, and tags thorough replies", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "Go", { thoroughness: "thorough" }),
      assistant("a1", "Partial", { stoppedAtRoundLimit: true }),
      user("u2", "Keep going: continue", { continuation: true, deep: true }),
      assistant("a2", "Done"),
    ]);
    const marker = list().querySelector(".continuation-marker");
    expect(marker?.textContent).toContain("↻ Kept going");
    expect(marker?.querySelector('[aria-label="Edit message"]')).toBeNull();
    expect(marker?.querySelector('[aria-label="Delete message"]')).not.toBeNull();
    expect(list().querySelector(".deep-tag")?.textContent).toBe("Thorough");
    expect(buttonsLabelled("Keep going")).toHaveLength(0);
  });

  it("tags a message sent with audio", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "What is said?", { audio: true }), user("u2", "And now?")]);
    const tags = [...list().querySelectorAll(".audio-tag")];
    expect(tags.map((tag) => tag.textContent)).toEqual(["Audio"]);
  });

  it("disables the actions while a turn runs", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    conversation.setRunning(true);
    expect(buttonsLabelled("Edit message").every((button) => button.disabled)).toBe(true);
    expect(buttonsLabelled("Replay: get a new reply")[0]?.disabled).toBe(true);
    expect(buttonsLabelled("Delete message").every((button) => button.disabled)).toBe(true);
    expect(buttonsLabelled("Branch: new chat from here").every((button) => button.disabled)).toBe(
      true,
    );
  });
});

describe("editing", () => {
  function editor(): HTMLTextAreaElement | null {
    return list().querySelector<HTMLTextAreaElement>(".message-editor textarea");
  }

  it("edits the last message on request, but not while a turn runs", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    setRunning(true);
    expect(conversation.editLast()).toBe(false);
    setRunning(false);
    expect(conversation.editLast()).toBe(true);
    expect(editor()?.value).toBe("Three");
  });

  it("keeps an open editor's draft across a re-render and blocks Save while running", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    buttonsLabelled("Edit message")[0]?.click();
    const first = editor();
    if (!first) throw new Error("No editor");
    first.value = "One, half typed";
    setRunning(true);
    conversation.setRunning(true);
    conversation.reset(exchanges());
    expect(editor()?.value).toBe("One, half typed");
    expect(editor()?.closest(".message")?.textContent).toContain("One");
    expect(buttonsLabelled("Save")[0]?.disabled).toBe(true);
  });

  it("refuses to save an assistant reply as empty", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    buttonsLabelled("Edit message")[1]?.click();
    const textarea = editor();
    if (!textarea) throw new Error("No editor");
    textarea.value = "  ";
    buttonsLabelled("Save")[0]?.click();
    expect(spies.onEdit).not.toHaveBeenCalled();
    expect(editor()).not.toBeNull();
    expect(list().querySelector(".message-editor-problem")?.textContent).toContain(
      "needs some text",
    );
  });

  it("returns focus to the edited message", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    buttonsLabelled("Edit message")[1]?.click();
    buttonsLabelled("Cancel")[0]?.click();
    expect(document.activeElement?.closest(".message")?.textContent).toContain("First");
    buttonsLabelled("Edit message")[1]?.click();
    const textarea = editor();
    if (!textarea) throw new Error("No editor");
    textarea.value = "First, edited";
    buttonsLabelled("Save")[0]?.click();
    conversation.show(assistant("a1", "First, edited"));
    expect(document.activeElement?.closest(".message")?.textContent).toContain("First, edited");
  });
});
