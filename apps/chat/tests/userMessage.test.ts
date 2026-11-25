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
import { described } from "./support/looking";

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

  it("says how far the transcript sent with a message went, on a continuation too", () => {
    const conversation = initConversation(els, deps());
    const transcript = { fileKey: "beach-key", spans: [{ startSeconds: 0, endSeconds: 2530 }] };
    conversation.reset([
      user("u1", "What is said?", { audio: true, transcript }),
      assistant("a1", "Plenty."),
      user("u2", "Keep going", { audio: true, continuation: true, transcript }),
      assistant("a2", "More."),
      user("u3", "And now?", { audio: true }),
    ]);
    const tags = [...list().querySelectorAll<HTMLElement>(".transcript-tag")];
    expect(tags.map((tag) => tag.textContent)).toEqual([
      "Transcript to 42:10 sent",
      "Transcript to 42:10 sent",
    ]);
    expect(tags[0]?.title).toContain("0:00 to 42:10");
  });

  it("keeps focus on the same control when the message is shown again", () => {
    const conversation = initConversation(els, deps());
    const message = user("u1", "What is said?", { audio: true });
    conversation.reset([message, assistant("a1", "Plenty.")]);
    const [before] = buttonsLabelled("Copy message");
    before?.focus();
    expect(document.activeElement).toBe(before);
    const transcript = { fileKey: "beach-key", spans: [{ startSeconds: 0, endSeconds: 60 }] };
    conversation.show({ ...message, transcript });
    const [after] = buttonsLabelled("Copy message");
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
  });

  it("leaves focus elsewhere alone when a message is shown again", () => {
    const conversation = initConversation(els, deps());
    const message = user("u1", "What is said?");
    conversation.reset([message]);
    els.composer.messageInput.focus();
    conversation.show({ ...message });
    expect(document.activeElement).toBe(els.composer.messageInput);
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

describe("a sent message with a transcript, a removed video and described pictures", () => {
  it("shows all three, the removed video where it was attached", () => {
    const removedVideo = {
      ...{ name: "beach.mp4", fileKey: "k" },
      ...{ durationSeconds: 60, width: 4, height: 3 },
    };
    const transcript = { fileKey: "k", spans: [{ startSeconds: 0, endSeconds: 60 }] };
    const seen = [described(["i"], "A dog.")];
    const message = { ...user("u1", "Who?"), audio: true as const, removedVideo, transcript, seen };
    initConversation(els, deps()).reset([message]);
    const parts = [...list().querySelectorAll(".transcript-tag, .inline-video, .seen-details")];
    expect(parts.map(({ classList }) => classList[0])).toEqual([
      "transcript-tag",
      "inline-video",
      "seen-details",
    ]);
    expect(parts[1]?.textContent).toContain("removed from this chat");
    expect(parts[2]?.textContent).toContain("A dog.");
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

  describe("that could not be saved", () => {
    function save(edit: number, text: string): void {
      buttonsLabelled("Edit message")[edit]?.click();
      const textarea = editor();
      if (!textarea) throw new Error("No editor");
      textarea.value = text;
      buttonsLabelled("Save")[0]?.click();
    }

    function refuse(call: number): void {
      const onUnsaved = spies.onEdit.mock.calls[call]?.[2] as (() => void) | undefined;
      onUnsaved?.();
    }

    it("comes back once the editor opened meanwhile closes, which keeps its own text", () => {
      const conversation = initConversation(els, deps());
      conversation.reset(exchanges());
      save(0, "One, edited");
      buttonsLabelled("Edit message")[1]?.click();
      const other = editor();
      if (!other) throw new Error("No editor");
      other.value = "First, half typed";
      refuse(0);
      expect(editor()?.value).toBe("First, half typed");
      buttonsLabelled("Cancel")[0]?.click();
      expect(editor()?.value).toBe("One, edited");
      buttonsLabelled("Cancel")[0]?.click();
      expect(editor()).toBeNull();
    });

    it("comes back after another edit is saved, then that one when it is refused too", () => {
      const conversation = initConversation(els, deps());
      conversation.reset(exchanges());
      save(0, "One, edited");
      save(1, "First, edited");
      refuse(0);
      expect(editor()?.value).toBe("One, edited");
      refuse(1);
      expect(editor()?.value).toBe("One, edited");
      buttonsLabelled("Cancel")[0]?.click();
      expect(editor()?.value).toBe("First, edited");
    });

    it("comes back each time its chat is shown, until it is saved or cancelled", () => {
      const conversation = initConversation(els, deps());
      conversation.reset(exchanges());
      save(0, "One, edited");
      conversation.reset([user("x1", "Another chat")]);
      refuse(0);
      expect(editor()).toBeNull();
      for (let shown = 0; shown < 2; shown++) {
        conversation.reset(exchanges());
        expect(editor()?.value).toBe("One, edited");
        conversation.reset([user("x1", "Another chat")]);
        expect(editor()).toBeNull();
      }
      conversation.reset(exchanges());
      buttonsLabelled("Save")[0]?.click();
      expect(spies.onEdit).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "u1" }),
        "One, edited",
        expect.any(Function),
      );
      conversation.reset(exchanges());
      expect(editor()).toBeNull();
    });
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
