import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, UserMessage } from "../src/types";
import { initConversation } from "../src/ui/conversation/conversation";
import {
  beach,
  buttonsLabelled,
  deps,
  els,
  exchanges,
  list,
  look,
  resetConversation,
  setRunning,
  setVerifying,
  spies,
} from "./support/conversation";
import { assistant, sheet, tool, user } from "./support/factories";

beforeEach(resetConversation);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("message actions", () => {
  it("puts Replay only on the latest reply and Edit on every message", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    const replays = buttonsLabelled("Replay: get a new reply");
    expect(replays).toHaveLength(1);
    expect(replays[0]?.closest(".message")?.textContent).toContain("Third");
    expect(buttonsLabelled("Edit message")).toHaveLength(6);
    expect(buttonsLabelled("Branch: new chat from here")).toHaveLength(6);
    expect(buttonsLabelled("Delete message")).toHaveLength(6);
    replays[0]?.click();
    expect(spies.onReplay).toHaveBeenCalled();
  });

  it("moves Replay when a newer reply arrives", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges().slice(0, 2));
    conversation.show(user("u2", "Two"));
    conversation.show(assistant("a2", "Second"));
    const replays = buttonsLabelled("Replay: get a new reply");
    expect(replays).toHaveLength(1);
    expect(replays[0]?.closest(".message")?.textContent).toContain("Second");
  });

  it("edits a message inline and reports the new text", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    buttonsLabelled("Edit message")[0]?.click();
    const textarea = list().querySelector<HTMLTextAreaElement>(".message-editor textarea");
    if (!textarea) throw new Error("No editor");
    textarea.value = "One, edited";
    buttonsLabelled("Save")[0]?.click();
    expect(spies.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "One, edited");
  });

  it("branches and deletes from a message", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    buttonsLabelled("Branch: new chat from here")[1]?.click();
    expect(spies.onBranch).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
    buttonsLabelled("Delete message")[2]?.click();
    expect(spies.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }));
  });
});

describe("replaying cut-off turns", () => {
  it("offers Replay on a reply stopped mid-stream", () => {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Go"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    conversation.apply({ type: "assistantDelta", message: assistant("a1", "Half an ans") });
    conversation.apply({ type: "assistantDone", message: assistant("a1", "Half an ans") });
    conversation.endTurn();
    expect(buttonsLabelled("Replay: get a new reply")).toHaveLength(1);
  });

  it("offers Replay on a turn stopped during its tool rounds", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "Go"),
      assistant("a1", "", { toolCalls: [look("c1", 0, 5)] }),
      tool("t1", "c1", []),
    ]);
    const replays = buttonsLabelled("Replay: get a new reply");
    expect(replays).toHaveLength(1);
    replays[0]?.click();
    expect(spies.onReplay).toHaveBeenCalled();
  });

  it("offers Retry under an unanswered last message and on the error line", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "One"), assistant("a1", "First"), user("u2", "Two")]);
    expect(buttonsLabelled("Retry")).toHaveLength(1);
    expect(buttonsLabelled("Replay: get a new reply")).toHaveLength(0);
    conversation.showError("Network error");
    const retries = buttonsLabelled("Retry");
    expect(retries).toHaveLength(2);
    retries[1]?.click();
    expect(spies.onReplay).toHaveBeenCalled();
    conversation.clearErrors();
    expect(list().querySelector(".error-line")).toBeNull();
  });

  it("hides Retry while a turn runs", () => {
    setRunning(true);
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "One")]);
    expect(buttonsLabelled("Retry")).toHaveLength(0);
  });
});

describe("lead turns and copying", () => {
  it("offers neither Replay nor Keep going on replies before any user message", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([assistant("a0", "Welcome.", { stoppedAtRoundLimit: true })]);
    expect(buttonsLabelled("Replay: get a new reply")).toHaveLength(0);
    expect(buttonsLabelled("Keep going")).toHaveLength(0);
    conversation.reset([assistant("a0", "")]);
    expect(buttonsLabelled("Replay: get a new reply")).toHaveLength(0);
  });

  it("copies any message, even while a turn runs", () => {
    setRunning(true);
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    conversation.setRunning(true);
    const copies = buttonsLabelled("Copy message");
    expect(copies).toHaveLength(6);
    expect(copies.every((button) => !button.disabled)).toBe(true);
    expect(buttonsLabelled("Edit message").every((button) => button.disabled)).toBe(true);
    copies[1]?.click();
    expect(spies.onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
  });
});

describe("receipts", () => {
  const receipt = { rounds: 2, imagesSent: 3, durationMs: 4200, unseenCitations: [] };

  it("shows the turn's rounds, images, tokens, cost and time under the finished reply", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "Look"),
      assistant("a0", "", {
        toolCalls: [look("c1", 0, 30)],
        usage: { promptTokens: 1000, completionTokens: 100, cachedTokens: 500 },
      }),
      tool("t1", "c1", [sheet("s1", 0, 30)]),
      assistant("a1", "Done.", { usage: { promptTokens: 200, completionTokens: 200 }, receipt }),
    ]);
    expect(list().querySelector(".reply-receipt-line")?.textContent).toBe(
      "2 rounds · 3 images · 1.2k in (42% cached) / 300 out · ≈ < $0.01 · 4.2 s",
    );
    expect(list().querySelector(".unseen-flag")).toBeNull();
  });

  it("flags citations of moments the model never looked at, with seek links and Check", () => {
    const conversation = initConversation(els, deps());
    const flagged = { ...receipt, unseenCitations: [102, 125] };
    conversation.reset([
      user("u1", "When?"),
      assistant("a1", "At [1:42] and [2:05].", { receipt: flagged }),
    ]);
    const flag = list().querySelector(".unseen-flag");
    expect(flag?.textContent).toContain("Cited 1:42, 2:05 without looking");
    expect(flag?.querySelector(".unseen-check")?.textContent).toBe("Check");
    flag?.querySelector<HTMLButtonElement>("button.timestamp")?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(102, beach);
  });
});

describe("checking timestamps", () => {
  const claimed = assistant("a1", "She waves at [1:42].");
  const verified = {
    ...claimed,
    verification: [
      {
        claim: "She waves at [1:42].",
        seconds: [102],
        verdict: "confirmed" as const,
        reason: "She waves.",
      },
    ],
  };

  it("offers Check timestamps only on replies that cite a moment", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "Hi"),
      assistant("a0", "No times here."),
      user("u2", "When?"),
      claimed,
    ]);
    const checks = buttonsLabelled("Check timestamps");
    expect(checks).toHaveLength(1);
    expect(checks[0]?.closest(".message")?.textContent).toContain("She waves");
  });

  it("shows progress, then each verdict with seek links, saved on the reply", async () => {
    let finish: (message: AssistantMessage) => void = () => undefined;
    setVerifying(() => new Promise((resolve) => (finish = resolve)));
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "When?"), claimed]);
    buttonsLabelled("Check timestamps")[0]?.click();
    expect(list().querySelector(".claim-checks.is-running")?.textContent).toContain(
      "Checking 1 claim against the video",
    );
    expect(buttonsLabelled("Check timestamps")).toHaveLength(0);
    finish(verified);
    await vi.waitFor(() =>
      expect(list().querySelector(".claim-check.is-confirmed")).not.toBeNull(),
    );
    const item = list().querySelector(".claim-check");
    expect(item?.querySelector(".claim-mark")?.textContent).toBe("✓");
    expect(item?.querySelector(".claim-reason")?.textContent).toBe("She waves.");
    item?.querySelector<HTMLButtonElement>("button.timestamp")?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(102, beach);
    expect(list().querySelector(".claim-checks-heading")?.textContent).toBe(
      "Timestamp check: 1 confirmed",
    );
  });
});

describe("checking timestamps from the receipt and after a reload", () => {
  const claimed = assistant("a1", "She waves at [1:42].");
  const verified = {
    ...claimed,
    verification: [
      {
        claim: "She waves at [1:42].",
        seconds: [102],
        verdict: "confirmed" as const,
        reason: "She waves.",
      },
    ],
  };

  it("shows saved verdicts after a reload", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "When?"), verified]);
    expect(list().querySelector(".claim-check.is-confirmed")).not.toBeNull();
  });

  it("aborts the check on Stop", () => {
    let signal: AbortSignal | undefined;
    setVerifying((_message, given) => {
      signal = given;
      return new Promise(() => undefined);
    });
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "When?"), claimed]);
    buttonsLabelled("Check timestamps")[0]?.click();
    buttonsLabelled("Stop")[0]?.click();
    expect(signal?.aborted).toBe(true);
    expect(list().querySelector(".claim-checks.is-running")).toBeNull();
    expect(buttonsLabelled("Check timestamps")).toHaveLength(1);
  });

  it("stops a running check from stopChecks and reports it through isChecking", () => {
    let signal: AbortSignal | undefined;
    setVerifying((_message, given) => {
      signal = given;
      return new Promise(() => undefined);
    });
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "When?"), claimed]);
    expect(conversation.isChecking()).toBe(false);
    buttonsLabelled("Check timestamps")[0]?.click();
    expect(conversation.isChecking()).toBe(true);
    conversation.stopChecks();
    expect(signal?.aborted).toBe(true);
    expect(conversation.isChecking()).toBe(false);
    expect(list().querySelector(".claim-checks.is-running")).toBeNull();
  });

  it("runs the check from the receipt's flag", () => {
    const onVerify = vi.fn(() => new Promise<undefined>(() => undefined));
    setVerifying(onVerify);
    const conversation = initConversation(els, deps());
    const receipt = { rounds: 1, imagesSent: 0, durationMs: 1000, unseenCitations: [102] };
    conversation.reset([user("u1", "When?"), { ...claimed, receipt }]);
    buttonsLabelled("Check")[0]?.click();
    expect(onVerify).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), expect.anything());
    expect(list().querySelector(".unseen-check")).toBeNull();
  });
});

describe("checks across chats", () => {
  const claimed = assistant("a1", "She waves at [1:42].");

  it("stops a running check when the conversation is reset for another chat", () => {
    let signal: AbortSignal | undefined;
    setVerifying((_message, given) => {
      signal = given;
      return new Promise(() => undefined);
    });
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "When?"), claimed]);
    buttonsLabelled("Check timestamps")[0]?.click();
    conversation.reset([user("u9", "Other chat")]);
    expect(signal?.aborted).toBe(true);
    expect(conversation.isChecking()).toBe(false);
  });
});

describe("swipes and compare", () => {
  const older = assistant("old", "Older reply");
  function swiped(extra: Partial<UserMessage> = {}): UserMessage {
    return user("u2", "Two", {
      alternates: [{ messages: [older], createdAt: 1 }],
      replyIndex: 1,
      ...extra,
    });
  }

  it("shows which reply is shown on the latest turn and switches between them", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "One"),
      assistant("a1", "First"),
      swiped(),
      assistant("a2", "Newer"),
    ]);
    expect(list().querySelectorAll(".reply-swipe")).toHaveLength(1);
    expect(list().querySelector(".reply-swipe-position")?.textContent).toBe("2 / 2");
    const [previous] = buttonsLabelled("Previous reply");
    const [next] = buttonsLabelled("Next reply");
    expect(next?.disabled).toBe(true);
    previous?.click();
    expect(spies.onSwitchReply).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }), 0);
  });

  it("disables swiping while a turn runs and keeps the end arrow disabled after", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([swiped(), assistant("a2", "Newer")]);
    conversation.setRunning(true);
    expect(buttonsLabelled("Previous reply")[0]?.disabled).toBe(true);
    expect(buttonsLabelled("Compare with another model…")[0]?.disabled).toBe(true);
    conversation.setRunning(false);
    expect(buttonsLabelled("Previous reply")[0]?.disabled).toBe(false);
    expect(buttonsLabelled("Next reply")[0]?.disabled).toBe(true);
  });

  it("hides the swipe control with a single reply and names a model other than the chat's", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "One", { replyModelId: "other-model" }),
      assistant("a1", "First"),
    ]);
    expect(list().querySelector(".reply-swipe")).toBeNull();
    expect(list().querySelector(".reply-model")?.textContent).toBe("Other Model");
    conversation.reset([
      user("u1", "One", { replyModelId: "chat-model" }),
      assistant("a1", "First"),
    ]);
    expect(list().querySelector(".reply-model")).toBeNull();
  });
});

describe("comparing with another model", () => {
  it("compares the latest reply with a model picked in a popover", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "One"),
      assistant("a1", "First"),
      user("u2", "Two"),
      assistant("a2", "Second"),
    ]);
    const compares = buttonsLabelled("Compare with another model…");
    expect(compares).toHaveLength(1);
    compares[0]?.click();
    const popover = list().querySelector(".compare-popover");
    expect(popover?.querySelector(".model-panel")?.hasAttribute("hidden")).toBe(false);
    popover?.querySelector<HTMLElement>('.model-row[data-id="other-model"]')?.click();
    expect(spies.onCompare).toHaveBeenCalledWith(expect.objectContaining({ id: "other-model" }));
    expect(list().querySelector(".compare-popover")).toBeNull();
  });

  it("closes the compare popover on Escape and when a turn starts", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "One"), assistant("a1", "First")]);
    buttonsLabelled("Compare with another model…")[0]?.click();
    list()
      .querySelector(".compare-popover")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(list().querySelector(".compare-popover")).toBeNull();
    buttonsLabelled("Compare with another model…")[0]?.click();
    conversation.setRunning(true);
    expect(list().querySelector(".compare-popover")).toBeNull();
  });
});
