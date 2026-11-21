import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initConversation } from "../src/ui/conversation/conversation";
import {
  buttonsLabelled,
  deps,
  els,
  exchanges,
  resetConversation,
  spies,
} from "./support/conversation";

beforeEach(resetConversation);

afterEach(() => {
  vi.restoreAllMocks();
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
