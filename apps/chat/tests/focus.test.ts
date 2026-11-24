import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initConversation } from "../src/ui/conversation/conversation";
import { withVideoRemoved } from "../src/chat/messageVideo";
import { user } from "./support/factories";
import {
  beach,
  buttonsLabelled,
  deps,
  els,
  exchanges,
  list,
  resetConversation,
  spies,
} from "./support/conversation";

beforeEach(resetConversation);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("focus after removing a video", () => {
  it("lands on the message it was removed from when others lose it too", () => {
    const conversation = initConversation(els, deps());
    const messages = ["u1", "u2"].map((id) => user(id, id, { video: beach }));
    conversation.reset(messages);
    spies.onRemoveVideo.mockImplementation(() =>
      conversation.showAll(messages.map(withVideoRemoved)),
    );
    buttonsLabelled("Remove from chat")[1]?.click();
    expect(document.activeElement?.isConnected).toBe(true);
    expect(document.activeElement?.closest(".message")?.textContent).toContain("u2");
    expect(list().querySelectorAll(".is-removed")).toHaveLength(2);
  });
});

describe("focus after deleting", () => {
  it("moves to the next message, then the last one, then the composer", () => {
    const conversation = initConversation(els, deps());
    const messages = exchanges();
    conversation.reset(messages);
    buttonsLabelled("Delete message")[2]?.click();
    conversation.reset(messages.filter((message) => message.id !== "u2"));
    expect(document.activeElement?.closest(".message")?.textContent).toContain("Second");
    buttonsLabelled("Delete message")[4]?.click();
    conversation.reset(messages.filter((message) => !["u2", "a3"].includes(message.id)));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Retry");
    buttonsLabelled("Delete message")[0]?.click();
    conversation.reset([]);
    expect(spies.focusComposer).toHaveBeenCalled();
  });
});
