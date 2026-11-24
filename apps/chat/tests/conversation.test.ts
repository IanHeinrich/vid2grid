import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initConversation } from "../src/ui/conversation/conversation";
import {
  beach,
  deps,
  els,
  list,
  look,
  resetConversation,
  setView,
  spies,
  userWithVideo,
} from "./support/conversation";
import { assistant, sheet, tool, user } from "./support/factories";

beforeEach(resetConversation);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("answers", () => {
  it("turns timestamps into buttons that seek the video", () => {
    const conversation = initConversation(els, deps());
    conversation.show(assistant("a1", "She waves at [1:42] and leaves at [1:02:03]."));
    const buttons = [...list().querySelectorAll<HTMLButtonElement>("button.timestamp")];
    expect(buttons.map((button) => button.textContent)).toEqual(["[1:42]", "[1:02:03]"]);
    buttons[0]?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(102, beach);
    expect(list().querySelector(".message.assistant .message-text")?.textContent).toBe(
      "She waves at [1:42] and leaves at [1:02:03].",
    );
  });

  it("renders action and dialogue markdown in assistant messages", () => {
    const conversation = initConversation(els, deps());
    conversation.show(assistant("a1", '*waves* "Hello" at [0:05]'));
    const text = list().querySelector(".message.assistant .message-text");
    expect(text?.querySelector("em.md-action")?.textContent).toBe("waves");
    expect(text?.querySelector(".md-dialogue")?.textContent).toBe('"Hello"');
    expect(text?.textContent).not.toContain("*");
  });

  it("renders markdown and seek buttons in user messages", () => {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "*nods* go to [1:42]"));
    const text = list().querySelector(".message.user .message-text");
    expect(text?.querySelector("em.md-action")?.textContent).toBe("nods");
    text?.querySelector<HTMLButtonElement>("button.timestamp")?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(102, beach);
  });

  it("renders model and user text as text, never as markup", () => {
    const conversation = initConversation(els, deps());
    const payload = '<img src=x onerror="alert(1)">';
    conversation.show(user("u1", payload));
    conversation.show(assistant("a1", payload));
    expect(list().querySelector("img")).toBeNull();
    expect(list().textContent).toContain(payload);
  });

  it("streams a reply into one element", () => {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Hi"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    conversation.apply({ type: "assistantDelta", message: assistant("a1", "Hel") });
    conversation.apply({ type: "assistantDone", message: assistant("a1", "Hello") });
    const answers = list().querySelectorAll(".message.assistant:not([hidden])");
    expect(answers).toHaveLength(1);
    expect(answers[0]?.querySelector(".message-text")?.textContent).toBe("Hello");
    expect(answers[0]?.classList.contains("is-streaming")).toBe(false);
  });

  it("shows errors and hides the empty state once there is content", () => {
    setView({ video: undefined, url: null });
    const conversation = initConversation(els, deps());
    conversation.reset([]);
    expect(els.conversation.empty.hidden).toBe(false);
    conversation.showError("401 Unauthorized");
    expect(list().querySelector(".error-line span")?.textContent).toBe("401 Unauthorized");
    expect(els.conversation.empty.hidden).toBe(true);
  });
});

describe("thinking", () => {
  it("reports thinking while reasoning streams with no answer text yet", () => {
    const onThinkingChanged = vi.fn();
    const conversation = initConversation(els, { ...deps(), onThinkingChanged });
    conversation.show(user("u1", "Go"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    expect(onThinkingChanged).not.toHaveBeenCalled();
    const thinking = assistant("a1", "", { reasoning: "Hm" });
    conversation.apply({ type: "assistantDelta", message: thinking });
    conversation.apply({ type: "assistantDelta", message: { ...thinking, reasoning: "Hmm" } });
    expect(onThinkingChanged.mock.calls).toEqual([[true]]);
    conversation.apply({ type: "assistantDelta", message: { ...thinking, text: "A dog" } });
    expect(onThinkingChanged.mock.calls).toEqual([[true], [false]]);
  });

  it("does not count a retry carrying reasoning that was cut short as thinking", () => {
    const onThinkingChanged = vi.fn();
    const conversation = initConversation(els, { ...deps(), onThinkingChanged });
    conversation.show(user("u1", "Go"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    const thinking = assistant("a1", "", { reasoning: "Hm" });
    conversation.apply({ type: "assistantDelta", message: thinking });
    const retry = { ...thinking, reasoningCutShort: true as const };
    conversation.apply({ type: "assistantDelta", message: retry });
    expect(onThinkingChanged.mock.calls).toEqual([[true], [false]]);
  });

  it("stops reporting thinking when the turn ends", () => {
    const onThinkingChanged = vi.fn();
    const conversation = initConversation(els, { ...deps(), onThinkingChanged });
    conversation.show(user("u1", "Go"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    conversation.apply({
      type: "assistantDelta",
      message: assistant("a1", "", { reasoning: "Hm" }),
    });
    conversation.endTurn();
    expect(onThinkingChanged.mock.calls).toEqual([[true], [false]]);
  });
});

describe("waiting for the model", () => {
  const request = { type: "requestStart", round: 1, images: 4, estimatedTokens: 38_000 } as const;
  const summary = () => list().querySelector(".activity-summary")?.textContent;

  function startWaiting() {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Go"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    conversation.apply(request);
    return conversation;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the seconds since the request went out", () => {
    startWaiting();
    expect(summary()).toBe("Sent 4 images (≈38k tokens) · waiting for the model · 0s");
    vi.advanceTimersByTime(18_000);
    expect(summary()).toBe("Sent 4 images (≈38k tokens) · waiting for the model · 18s");
  });

  it("suggests Stop and Retry after 90 seconds", () => {
    startWaiting();
    vi.advanceTimersByTime(89_000);
    expect(summary()).not.toContain("unusually long");
    vi.advanceTimersByTime(1000);
    expect(summary()).toBe(
      "Sent 4 images (≈38k tokens) · waiting for the model · 90s · this is taking unusually long; you can Stop and Retry",
    );
  });

  it("stops counting at the first delta", () => {
    const conversation = startWaiting();
    const reasoning = assistant("a1", "", { reasoning: "Hm" });
    conversation.apply({ type: "assistantDelta", message: reasoning });
    expect(summary()).toBe("Thinking…");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(summary()).toBe("Thinking…");
  });

  it("stops counting when the turn ends or the chat changes", () => {
    startWaiting().endTurn();
    expect(vi.getTimerCount()).toBe(0);
    expect(list().querySelector<HTMLElement>(".activity")?.hidden).toBe(true);
    startWaiting().reset([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a later round's wait more briefly", () => {
    const conversation = startWaiting();
    conversation.apply({ type: "requestStart", round: 2, images: 1, estimatedTokens: 40_000 });
    vi.advanceTimersByTime(6000);
    expect(summary()).toBe("Round 2 · waiting · 6s");
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe("announcements", () => {
  it("announces only the start and end of a turn", () => {
    const conversation = initConversation(els, deps());
    const announcer = els.conversation.scroller.querySelector(".turn-announcer");
    expect(list().hasAttribute("aria-live")).toBe(false);
    conversation.show(user("u1", "Go"));
    conversation.apply({ type: "requestStart", round: 1, images: 0, estimatedTokens: 10 });
    expect(announcer?.textContent).toBe("Waiting for the reply.");
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    conversation.apply({ type: "assistantDelta", message: assistant("a1", "Hel") });
    expect(announcer?.textContent).toBe("Waiting for the reply.");
    conversation.endTurn();
    expect(announcer?.textContent).toBe("Reply finished.");
  });
});

describe("coverage strip", () => {
  it("shades what the model has seen under the inline video and reports changes", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      userWithVideo(beach),
      assistant("a0", "", { toolCalls: [look("c1", 0, 45)] }),
      tool("t1", "c1", [sheet("s1", 0, 45)]),
      assistant("a1", "Seen."),
    ]);
    const segments = list().querySelectorAll<HTMLElement>(".inline-video .coverage-segment");
    expect(segments).toHaveLength(1);
    expect(segments[0]?.title).toBe("Seen 0:00 to 0:45, a frame every 11 s");
    expect(spies.onMessagesChanged).toHaveBeenCalled();
  });

  it("recomputes coverage when a step finishes, not on each streamed token", () => {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Hi"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    spies.onMessagesChanged.mockClear();
    conversation.apply({ type: "assistantDelta", message: assistant("a1", "Hel") });
    conversation.apply({ type: "assistantDelta", message: assistant("a1", "Hello") });
    expect(spies.onMessagesChanged).not.toHaveBeenCalled();
    conversation.apply({ type: "assistantDone", message: assistant("a1", "Hello") });
    expect(spies.onMessagesChanged).toHaveBeenCalledTimes(1);
  });
});

describe("while a looking model looks", () => {
  const summary = () => list().querySelector(".activity-summary")?.textContent;
  const onThinkingChanged = vi.fn();
  const looking = () =>
    initConversation(els, { ...deps(), lookingName: () => "Eyes", onThinkingChanged });

  beforeEach(() => onThinkingChanged.mockClear());

  it("says so before round one, and offers Answer now", () => {
    const conversation = looking();
    conversation.show(user("u1", "Hi"));
    conversation.apply({ type: "lookStart", images: 4, modelId: "eyes" });
    expect(summary()).toBe("Looking at 4 pictures with Eyes · 0s");
    expect(onThinkingChanged).toHaveBeenLastCalledWith(true);
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    expect(summary()).toBe("Thinking…");
    expect(onThinkingChanged).toHaveBeenLastCalledWith(false);
  });

  it("offers Answer now while a question is out, and not once the turn ends", () => {
    const conversation = looking();
    conversation.show(user("u1", "Hi"));
    const call = { id: "c", name: "ask", arguments: '{"question":"q","pictures":["a"]}' };
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    conversation.apply({
      type: "assistantDone",
      message: assistant("a1", "", { toolCalls: [call] }),
    });
    conversation.apply({ type: "toolStart", call });
    expect(summary()).toBe("Asking about 1 picture…");
    expect(onThinkingChanged).toHaveBeenLastCalledWith(true);
    conversation.apply({ type: "toolDone", message: tool("t1", "c", []) });
    expect(onThinkingChanged).toHaveBeenLastCalledWith(false);
    conversation.apply({ type: "lookStart", images: 1, modelId: "eyes" });
    conversation.endTurn();
    expect(onThinkingChanged).toHaveBeenLastCalledWith(false);
  });
});

describe("what a looking model saw", () => {
  const usage = { promptTokens: 2000, completionTokens: 100 };
  const note = {
    ...{ kind: "described" as const, imageIds: ["s1"], modelId: "eyes" },
    text: "A dog at [0:05].",
  };

  it("is on the user message and in its activity row, with its tokens", () => {
    const onLookAgain = vi.fn();
    const conversation = initConversation(els, {
      ...deps(),
      looking: () => true,
      lookingName: () => "Eyes",
      onLookAgain,
    });
    const seen = [{ ...note, usage }];
    conversation.reset([
      user("u1", "Hi", { images: [sheet("s1", 0, 1)], seen }),
      assistant("a1", "A dog.", { usage }),
    ]);
    const details = list().querySelector<HTMLDetailsElement>(".message.user .seen-details");
    expect(details?.querySelector("summary")?.textContent).toBe("1 picture described by Eyes");
    expect(details?.querySelector(".seen-text")?.textContent).toBe("A dog at [0:05].");
    details?.querySelector<HTMLButtonElement>(".timestamp")?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(5, beach);
    expect(list().querySelector(".activity-summary")?.textContent).toBe(
      "1 picture described · 4k in / 200 out",
    );
    details?.querySelector<HTMLButtonElement>(".look-again")?.click();
    expect(onLookAgain).toHaveBeenCalledWith("u1", seen[0]);
    conversation.show(user("u1", "Hi", { images: [sheet("s1", 0, 1)], seen: [], lookAgain: true }));
    expect(list().querySelector(".seen-pending")?.textContent).toContain("looked at again");
  });

  it("keeps focus on the message after Look again, and waits only with one on", () => {
    let on = true;
    const conversation = initConversation(els, {
      ...deps(),
      looking: () => on,
      onLookAgain: () => {
        const marked = { images: [sheet("s1", 0, 1)], seen: [], lookAgain: true as const };
        conversation.show(user("u1", "Hi", marked));
      },
    });
    conversation.reset([user("u1", "Hi", { images: [sheet("s1", 0, 1)], seen: [note] })]);
    list().querySelector<HTMLButtonElement>(".look-again")?.click();
    expect(list().querySelector(".seen-pending")).not.toBeNull();
    expect(document.activeElement?.closest(".message.user")).not.toBeNull();
    on = false;
    conversation.show(user("u1", "Hi", { images: [sheet("s1", 0, 1)], seen: [], lookAgain: true }));
    expect(list().querySelector(".seen-pending")).toBeNull();
  });

  it("shows an answer only while the message asks what it answers", () => {
    const conversation = initConversation(els, deps());
    const seen = [{ ...note, kind: "answered" as const, question: "Who?" }];
    conversation.reset([user("u1", "Who?", { seen })]);
    expect(list().querySelector(".seen-details summary")?.textContent).toBe(
      "Answered from earlier pictures by eyes",
    );
    conversation.reset([user("u1", "What?", { seen })]);
    expect(list().querySelector(".seen-details")).toBeNull();
  });

  it("pins on the newest copy of a message", () => {
    const conversation = initConversation(els, deps());
    const message = user("u1", "Hi", { images: [sheet("s1", 0, 1)] });
    conversation.show(message);
    const pin = list().querySelector<HTMLButtonElement>(".message.user .pin-toggle");
    list().querySelector<HTMLButtonElement>(".edit-action")?.click();
    conversation.apply({ type: "looked", messageId: "u1", seen: [note] });
    pin?.click();
    expect(spies.onMessageChanged).toHaveBeenCalledWith(expect.objectContaining({ seen: [note] }));
  });

  it("is on the message a later pin starts from", () => {
    const conversation = initConversation(els, deps());
    const note = { kind: "described" as const, imageIds: ["s1"], modelId: "eyes", text: "A dog." };
    const message = user("u1", "Hi", { images: [sheet("s1", 0, 1)] });
    conversation.show(message);
    conversation.apply({ type: "lookStart", images: 1, modelId: "eyes" });
    conversation.apply({ type: "looked", messageId: "u1", seen: [note] });
    list().querySelector<HTMLButtonElement>(".message.user .pin-toggle")?.click();
    expect(spies.onMessageChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", seen: [note] }),
    );
  });
});
