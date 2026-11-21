import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import type {
  AssistantMessage,
  ChatMessage,
  ChatStore,
  ImageRef,
  UserMessage,
  VideoAttachment,
} from "../src/types";
import { initConversation, type ConversationDeps } from "../src/ui/conversation";
import type { VideoView } from "../src/ui/videoPanel";
import { conversationDeps } from "./support/conversationDeps";
import { assistant, model, sheet, tool, user } from "./support/factories";
import { mountPage } from "./support/page";

let els: AppElements;
let store: ChatStore;
let view: VideoView;
let showThinking: boolean;
let running: boolean;
let spies: ReturnType<typeof makeSpies>;
let verifying: (
  message: AssistantMessage,
  signal: AbortSignal,
) => Promise<AssistantMessage | undefined>;

const MODELS = [
  model("chat-model", { name: "Chat Model", pricing: { inputPerMTok: 1, outputPerMTok: 2 } }),
  model("other-model", { name: "Other Model" }),
];

const beach: VideoAttachment = {
  name: "beach.mp4",
  fileKey: "beach-key",
  durationSeconds: 90,
  width: 640,
  height: 360,
};

function makeSpies() {
  return {
    onSeek: vi.fn(),
    onCue: vi.fn(),
    onMessageChanged: vi.fn(),
    onEdit: vi.fn(),
    onReplay: vi.fn(),
    onKeepGoing: vi.fn(),
    onBranch: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onPopOut: vi.fn(),
    onReattach: vi.fn(),
    onPrefill: vi.fn(),
    focusComposer: vi.fn(),
    onSwitchReply: vi.fn(),
    onCompare: vi.fn(),
    onMessagesChanged: vi.fn(),
  };
}

function deps(): ConversationDeps {
  return conversationDeps(store, {
    ...spies,
    isRunning: () => running,
    videoView: () => view,
    showThinking: () => showThinking,
    models: () => MODELS,
    chatModelId: () => "chat-model",
    onVerify: (message, signal) => verifying(message, signal),
  });
}

function look(id: string, start: number, end: number) {
  return { id, name: "look", arguments: JSON.stringify({ start, end }) };
}

function list(): HTMLElement {
  return els.conversation.list;
}

function buttonsLabelled(label: string): HTMLButtonElement[] {
  return [...list().querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.getAttribute("aria-label") === label || button.textContent === label,
  );
}

beforeEach(() => {
  els = mountPage();
  store = createMemoryStore();
  view = { video: beach, url: "blob:beach" };
  showThinking = false;
  running = false;
  spies = makeSpies();
  localStorage.clear();
  verifying = () => Promise.resolve(undefined);
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:image-${++next}`);
  URL.revokeObjectURL = vi.fn();
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  Element.prototype.setPointerCapture = vi.fn();
});

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
    view = { video: undefined, url: null };
    const conversation = initConversation(els, deps());
    conversation.reset([]);
    expect(els.conversation.empty.hidden).toBe(false);
    conversation.showError("401 Unauthorized");
    expect(list().querySelector(".error-line span")?.textContent).toBe("401 Unauthorized");
    expect(els.conversation.empty.hidden).toBe(true);
  });
});

function investigation(): ChatMessage[] {
  return [
    user("u1", "What happens?"),
    assistant("a1", "Let me look.", {
      reasoning: "Scan first.",
      toolCalls: [look("c1", 36, 39), { id: "c2", name: "frames", arguments: '{"times":[40,41]}' }],
    }),
    tool("t1", "c1", [sheet("s1", 36, 39)]),
    tool("t2", "c2", [sheet("s2", 40, 41)]),
    assistant("a2", "", {
      toolCalls: [{ id: "c3", name: "note", arguments: '{"t":40,"text":"x"}' }],
    }),
    tool(
      "t3",
      "c3",
      [],
      "Noted at 0:40. (Round 2 of 8. Batch several calls into one round when you can.)",
    ),
    assistant("a3", "She waves at [0:40].", { reasoning: "Done." }),
  ];
}

function openActivity(): HTMLDetailsElement {
  const details = list().querySelector<HTMLDetailsElement>(".activity details");
  if (!details) throw new Error("No activity row");
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
  return details;
}

describe("activity row", () => {
  it("groups every round into one collapsed row above the final answer", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(investigation());
    const rows = list().querySelectorAll<HTMLElement>(".activity:not([hidden])");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector("details")?.open).toBe(false);
    expect(rows[0]?.querySelector(".activity-summary")?.textContent).toBe(
      "Thought · 1 look · 2 frames · 1 note",
    );
    const answers = list().querySelectorAll(".message.assistant:not([hidden])");
    expect(answers).toHaveLength(1);
    expect(answers[0]?.querySelector(".message-text")?.textContent).toBe("She waves at [0:40].");
  });

  it("expands into a timeline of calls, thumbnails and reasoning", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(investigation());
    const details = openActivity();
    const calls = [...details.querySelectorAll(".activity-call-label")].map((el) => el.textContent);
    expect(calls).toEqual([
      "look 0:36.0 to 0:39.0 · 4 frames · 4 per sheet · 1 sheet",
      "frames 0:40, 0:41",
      "note 0:40 · x",
    ]);
    expect(details.querySelectorAll(".activity-thumbs .thumb-button")).toHaveLength(2);
    expect(details.textContent).not.toContain("Let me look.");
    const thinking = [...details.querySelectorAll(".activity-thinking")];
    expect(thinking.map((block) => block.textContent)).toEqual(["Scan first.", "Done."]);
    expect(details.querySelectorAll("details details")).toHaveLength(0);
  });
});

describe("before looking", () => {
  it("shows text written before tool calls above the answer, labelled and seekable", () => {
    const conversation = initConversation(els, deps());
    const messages = investigation();
    messages[1] = assistant("a1", "Checking [0:36] first.", {
      toolCalls: [look("c1", 36, 39), { id: "c2", name: "frames", arguments: '{"times":[40,41]}' }],
    });
    conversation.reset(messages);
    const reply = list().querySelector<HTMLElement>(".message.assistant:not([hidden])");
    const prefaces = [...(reply?.querySelectorAll(".reply-preface") ?? [])];
    expect(prefaces).toHaveLength(1);
    expect(prefaces[0]?.querySelector(".reply-preface-label")?.textContent).toBe("Before looking");
    expect(prefaces[0]?.querySelector(".reply-preface-text")?.textContent).toBe(
      "Checking [0:36] first.",
    );
    expect(reply?.querySelector(".message-text")?.textContent).toBe("She waves at [0:40].");
    prefaces[0]?.querySelector<HTMLButtonElement>("button.timestamp")?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(36, beach);
  });

  it("copies and checks the answer alone", () => {
    const conversation = initConversation(els, deps());
    const messages = investigation();
    messages[1] = assistant("a1", "Maybe at [0:10].", { toolCalls: [look("c1", 36, 39)] });
    conversation.reset(messages.filter((message) => message.id !== "t2"));
    buttonsLabelled("Copy message")[1]?.click();
    expect(spies.onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: "a3" }));
    const verify = vi.fn(() => Promise.resolve(undefined));
    verifying = verify;
    buttonsLabelled("Check timestamps")[0]?.click();
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ id: "a3" }), expect.anything());
  });

  it("turns the streamed round into a preface in place when its tool calls arrive", () => {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Go"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    conversation.apply({ type: "assistantDelta", message: assistant("a1", "Let me look.") });
    const reply = list().querySelector<HTMLElement>(".message.assistant");
    expect(reply?.querySelector(".message-text")?.textContent).toBe("Let me look.");
    expect(reply?.querySelector(".reply-preface")).toBeNull();
    const withCall = assistant("a1", "Let me look.", { toolCalls: [look("c1", 36, 39)] });
    conversation.apply({ type: "assistantDone", message: withCall });
    conversation.apply({ type: "toolStart", call: look("c1", 36, 39) });
    expect(reply?.hidden).toBe(false);
    expect(reply?.querySelector(".message-text")?.textContent).toBe("");
    expect(reply?.querySelector(".reply-preface-text")?.textContent).toBe("Let me look.");
    expect(reply?.querySelector(".message-actions")?.childElementCount).toBe(0);
    conversation.apply({ type: "toolDone", message: tool("t1", "c1", []) });
    conversation.apply({ type: "assistantStart", message: assistant("a2", "") });
    conversation.apply({ type: "assistantDelta", message: assistant("a2", "She waves.") });
    const preface = reply?.querySelector(".reply-preface");
    conversation.apply({ type: "assistantDelta", message: assistant("a2", "She waves twice.") });
    expect(reply?.querySelector(".reply-preface")).toBe(preface);
    expect(reply?.querySelector(".message-text")?.textContent).toBe("She waves twice.");
  });
});

describe("activity row state", () => {
  it("starts the row open when Show thinking is on", () => {
    showThinking = true;
    const conversation = initConversation(els, deps());
    conversation.reset(investigation());
    const details = list().querySelector<HTMLDetailsElement>(".activity details");
    expect(details?.open).toBe(true);
    expect(details?.querySelector(".activity-thinking")?.textContent).toBe("Scan first.");
  });

  it("remembers each opening reply's row apart, and forgets them in another chat", () => {
    const leads = [
      assistant("a1", "One.", { reasoning: "First." }),
      assistant("a2", "Two.", { reasoning: "Second." }),
    ];
    const conversation = initConversation(els, deps());
    conversation.reset(leads);
    const rows = () => [...list().querySelectorAll<HTMLDetailsElement>(".activity details")];
    rows()[0]?.querySelector<HTMLElement>(".activity-summary")?.click();
    conversation.reset(leads);
    expect(rows().map((row) => row.open)).toEqual([true, false]);
    conversation.reset([user("u9", "Elsewhere")]);
    conversation.reset(leads);
    expect(rows().map((row) => row.open)).toEqual([false, false]);
  });

  it("keeps a row the reader opened or closed that way across a re-render", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(investigation());
    const summary = () => list().querySelector<HTMLElement>(".activity-summary");
    const details = () => list().querySelector<HTMLDetailsElement>(".activity details");
    summary()?.click();
    expect(details()?.open).toBe(true);
    conversation.reset(investigation());
    expect(details()?.open).toBe(true);
    showThinking = true;
    summary()?.click();
    conversation.reset(investigation());
    expect(details()?.open).toBe(false);
  });
});

describe("thoroughness, reasoning and cut-short tags", () => {
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

  it("shows the notice on a reply whose thinking was cut short", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "Go"),
      assistant("a1", "Short answer", { reasoningCutShort: true }),
      user("u2", "More"),
      assistant("a2", "Full answer"),
    ]);
    const notices = [...list().querySelectorAll<HTMLElement>(".reply-notice")];
    expect(notices.map((notice) => notice.hidden)).toEqual([false, true]);
    expect(notices[0]?.textContent).toContain("thinking was cut short");
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

describe("live activity", () => {
  it("streams reasoning into the open row in place", () => {
    showThinking = true;
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Go"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    const thinking = assistant("a1", "", { reasoning: "Hm" });
    conversation.apply({ type: "assistantDelta", message: thinking });
    const block = list().querySelector(".activity-thinking");
    expect(block?.textContent).toBe("Hm");
    conversation.apply({
      type: "assistantDelta",
      message: { ...thinking, reasoning: "Hmm, a dog" },
    });
    expect(list().querySelector(".activity-thinking")).toBe(block);
    expect(block?.textContent).toBe("Hmm, a dog");
  });

  it("keeps showing a call that is still running when an earlier one finishes", () => {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Go"));
    const summary = () => list().querySelector(".activity-summary")?.textContent;
    const listen = { id: "c2", name: "listen", arguments: '{"start":0,"end":30}' };
    const calls = [look("c1", 0, 5), listen, look("c3", 10, 15)];
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    conversation.apply({
      type: "assistantDone",
      message: assistant("a1", "", { toolCalls: calls }),
    });
    for (const call of calls) conversation.apply({ type: "toolStart", call });
    expect(summary()).toBe("Looking at 0:10.0 to 0:15.0…");
    conversation.apply({ type: "toolDone", message: tool("t1", "c1", []) });
    expect(summary()).toBe("Looking at 0:10.0 to 0:15.0…");
    conversation.apply({ type: "toolDone", message: tool("t3", "c3", []) });
    expect(summary()).toBe("Running listen…");
    conversation.apply({ type: "toolDone", message: tool("t2", "c2", []) });
    expect(summary()).toBe("Thinking…");
  });

  it("shows live status while the turn runs and the summary once it ends", () => {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Go"));
    const summary = () => list().querySelector(".activity-summary")?.textContent;
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    expect(summary()).toBe("Thinking…");
    const withCall = assistant("a1", "", { toolCalls: [look("c1", 36, 39)] });
    conversation.apply({ type: "assistantDone", message: withCall });
    conversation.apply({ type: "toolStart", call: look("c1", 36, 39) });
    expect(summary()).toBe("Looking at 0:36.0 to 0:39.0…");
    conversation.endTurn();
    expect(summary()).toBe("1 look");
  });
});

describe("streaming beside an open row", () => {
  it("leaves the open row's body alone while the answer streams", () => {
    const conversation = initConversation(els, deps());
    conversation.show(user("u1", "Go"));
    conversation.apply({ type: "assistantStart", message: assistant("a1", "") });
    const withCall = assistant("a1", "", { toolCalls: [look("c1", 36, 39)] });
    conversation.apply({ type: "assistantDone", message: withCall });
    conversation.apply({ type: "toolDone", message: tool("t1", "c1", [sheet("s1", 36, 39)]) });
    conversation.apply({ type: "assistantStart", message: assistant("a2", "") });
    conversation.apply({ type: "assistantDelta", message: assistant("a2", "She") });
    const details = openActivity();
    const call = details.querySelector(".activity-call");
    const create = vi.fn(() => "blob:again");
    const revoke = vi.fn();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    conversation.apply({ type: "assistantDelta", message: assistant("a2", "She waves") });
    conversation.apply({ type: "assistantDelta", message: assistant("a2", "She waves at") });
    expect(details.querySelector(".activity-call")).toBe(call);
    expect(revoke).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("activity details", () => {
  it("links every moment a frames or note call names to the video", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(investigation());
    const links = [
      ...openActivity().querySelectorAll<HTMLButtonElement>(".activity-call .timestamp"),
    ];
    expect(links.map((link) => link.textContent)).toEqual(["0:40", "0:41", "0:40"]);
    links[1]?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(41, beach);
  });

  it("captions thumbnails by what produced them", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(investigation());
    const thumb = openActivity().querySelector<HTMLButtonElement>(".activity-thumbs .thumb-button");
    expect(thumb?.title).toBe("look · 0:36.0 to 0:39.0 · 4 frames");
    thumb?.click();
    expect(els.lightbox.label.textContent).toBe("look · 0:36.0 to 0:39.0 · 4 frames");
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

function exchanges(): ChatMessage[] {
  return [
    user("u1", "One"),
    assistant("a1", "First"),
    user("u2", "Two"),
    assistant("a2", "Second"),
    user("u3", "Three"),
    assistant("a3", "Third"),
  ];
}

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

function userWithVideo(video: VideoAttachment): UserMessage {
  return user("u1", "Look", { video });
}

describe("inline video", () => {
  it("plays the attached video in the message and pops it out at the current time", () => {
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    const player = list().querySelector<HTMLVideoElement>(".inline-video video");
    expect(player?.getAttribute("src")).toBe("blob:beach");
    expect(list().querySelector(".inline-video-caption")?.textContent).toBe("beach.mp4 · 1:30");
    buttonsLabelled("Pop out")[0]?.click();
    expect(spies.onPopOut).toHaveBeenCalledWith(0);
    expect(buttonsLabelled("Study video")).toHaveLength(0);
  });

  it("offers Reattach when the file is not loaded, and the player once it is", () => {
    view = { video: beach, url: null };
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    expect(list().querySelector(".inline-video video")).toBeNull();
    buttonsLabelled("Reattach video")[0]?.click();
    expect(spies.onReattach).toHaveBeenCalled();
    view = { video: beach, url: "blob:beach" };
    conversation.refreshVideos();
    expect(list().querySelector(".inline-video video")).not.toBeNull();
  });

  it("shows a replaced video by name only", () => {
    view = { video: { ...beach, name: "park.mp4", fileKey: "park-key" }, url: "blob:park" };
    const conversation = initConversation(els, deps());
    conversation.show(userWithVideo(beach));
    expect(list().querySelector(".inline-video video")).toBeNull();
    expect(list().querySelector(".inline-video")?.textContent).toBe("beach.mp4 · 1:30 (replaced)");
  });
});

async function seedImages(): Promise<UserMessage> {
  const ids = await Promise.all(["a", "b", "c"].map((name) => store.putImage(new Blob([name]))));
  const images: ImageRef[] = ids.map((id, index) => ({
    id,
    source: { kind: "upload", name: `photo-${index + 1}.png` },
    pinned: false,
  }));
  return user("u1", "", { images });
}

function pressKey(key: string): void {
  els.lightbox.dialog.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
}

describe("images and the lightbox", () => {
  it("toggles a pin on a user image and reports the changed message", async () => {
    const conversation = initConversation(els, deps());
    conversation.show(await seedImages());
    list().querySelector<HTMLButtonElement>(".pin-toggle")?.click();
    const changed = spies.onMessageChanged.mock.calls[0]?.[0] as UserMessage | undefined;
    expect(changed?.images[0]?.pinned).toBe(true);
    expect(list().querySelector(".pin-toggle")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens a thumbnail in the overlay with its label and position", async () => {
    const conversation = initConversation(els, deps());
    conversation.show(await seedImages());
    list().querySelectorAll<HTMLButtonElement>(".thumb-button")[1]?.click();
    expect(els.lightbox.dialog.open).toBe(true);
    expect(els.lightbox.label.textContent).toBe("photo-2.png");
    expect(els.lightbox.counter.textContent).toBe("2 of 3");
    expect(els.lightbox.pin.hidden).toBe(false);
    await vi.waitFor(() => expect(els.lightbox.image.getAttribute("src")).toMatch(/^blob:/));
  });

  it("moves with the arrow keys, stops at the ends and closes on Escape", async () => {
    const conversation = initConversation(els, deps());
    conversation.show(await seedImages());
    list().querySelector<HTMLButtonElement>(".thumb-button")?.click();
    pressKey("ArrowLeft");
    expect(els.lightbox.counter.textContent).toBe("1 of 3");
    pressKey("ArrowRight");
    pressKey("ArrowRight");
    pressKey("ArrowRight");
    expect(els.lightbox.counter.textContent).toBe("3 of 3");
    expect(els.lightbox.next.disabled).toBe(true);
    pressKey("Escape");
    expect(els.lightbox.dialog.open).toBe(false);
  });

  it("pins the shown image from the overlay", async () => {
    const conversation = initConversation(els, deps());
    conversation.show(await seedImages());
    list().querySelector<HTMLButtonElement>(".thumb-button")?.click();
    els.lightbox.pin.click();
    expect(els.lightbox.pin.getAttribute("aria-pressed")).toBe("true");
    const changed = spies.onMessageChanged.mock.calls[0]?.[0] as UserMessage | undefined;
    expect(changed?.images[0]?.pinned).toBe(true);
  });

  it("opens an activity thumbnail in the overlay at that image", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(investigation());
    const details = openActivity();
    details.querySelectorAll<HTMLButtonElement>(".activity-thumbs .thumb-button")[1]?.click();
    expect(els.lightbox.counter.textContent).toBe("2 of 2");
    expect(els.lightbox.pin.hidden).toBe(true);
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
    running = true;
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "One")]);
    expect(buttonsLabelled("Retry")).toHaveLength(0);
  });
});

function openSheet(messages: ChatMessage[] = investigation()): HTMLImageElement {
  const conversation = initConversation(els, deps());
  conversation.reset(messages);
  openActivity().querySelector<HTMLButtonElement>(".activity-thumbs .thumb-button")?.click();
  const { image } = els.lightbox;
  Object.defineProperty(image, "naturalWidth", { value: 1000 });
  Object.defineProperty(image, "naturalHeight", { value: 1000 });
  image.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 1000);
  return image;
}

function control(selector: string): HTMLButtonElement {
  const button = els.lightbox.dialog.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`No ${selector}`);
  return button;
}

function clickAt(image: HTMLElement, x: number, y: number): void {
  image.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }));
}

describe("seeking and zooming in the lightbox", () => {
  it("cues the clicked cell of a 2 by 2 sheet without playing, and ignores the margin", () => {
    vi.useFakeTimers();
    const image = openSheet();
    clickAt(image, 750, 600);
    vi.runAllTimers();
    expect(spies.onCue).toHaveBeenLastCalledWith(39);
    clickAt(image, 250, 300);
    vi.runAllTimers();
    expect(spies.onCue).toHaveBeenLastCalledWith(36);
    clickAt(image, 500, 100);
    vi.runAllTimers();
    expect(spies.onCue).toHaveBeenCalledTimes(2);
    expect(spies.onSeek).not.toHaveBeenCalled();
    expect(els.lightbox.dialog.open).toBe(true);
    vi.useRealTimers();
  });

  it("plays the clicked cell of a sheet from an earlier video in that video", () => {
    vi.useFakeTimers();
    const dunes: VideoAttachment = { ...beach, name: "dunes.mp4", fileKey: "dunes-key" };
    view = { video: dunes, url: "blob:dunes" };
    const [first, ...rest] = investigation();
    if (first?.role !== "user") throw new Error("No user message");
    const later = user("u2", "Now", { video: dunes });
    const image = openSheet([{ ...first, video: beach }, ...rest, later]);
    clickAt(image, 750, 600);
    vi.runAllTimers();
    expect(spies.onSeek).toHaveBeenCalledWith(39, beach);
    expect(spies.onCue).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("asks about the clicked frame and closes", () => {
    const image = openSheet();
    clickAt(image, 750, 600);
    expect(spies.onCue).not.toHaveBeenCalled();
    control(".lightbox-ask").click();
    expect(spies.onPrefill).toHaveBeenCalledWith("About [0:39]: ");
    expect(els.lightbox.dialog.open).toBe(false);
  });

  it("zooms with the buttons and double-click, and a drag does not seek", () => {
    const image = openSheet();
    expect(control(".lightbox-zoom-out").disabled).toBe(true);
    control(".lightbox-zoom-in").click();
    expect(image.style.transform).toContain("scale(1.25)");
    image.dispatchEvent(new MouseEvent("dblclick", { clientX: 500, clientY: 500 }));
    expect(image.style.transform).toBe("");
    image.dispatchEvent(new MouseEvent("dblclick", { clientX: 500, clientY: 500 }));
    expect(image.style.transform).toContain("scale(2.5)");
    image.dispatchEvent(new MouseEvent("pointerdown", { clientX: 700, clientY: 600, button: 0 }));
    image.dispatchEvent(new MouseEvent("pointermove", { clientX: 760, clientY: 600 }));
    image.dispatchEvent(new MouseEvent("pointerup", { clientX: 760, clientY: 600 }));
    clickAt(image, 760, 600);
    expect(spies.onSeek).not.toHaveBeenCalled();
  });
});

describe("double-clicks and pans in the lightbox", () => {
  it("zooms on a double-click without seeking", () => {
    vi.useFakeTimers();
    const image = openSheet();
    image.dispatchEvent(new MouseEvent("click", { clientX: 750, clientY: 600, detail: 1 }));
    image.dispatchEvent(new MouseEvent("click", { clientX: 750, clientY: 600, detail: 2 }));
    image.dispatchEvent(new MouseEvent("dblclick", { clientX: 750, clientY: 600 }));
    vi.runAllTimers();
    expect(image.style.transform).toContain("scale(2.5)");
    expect(spies.onCue).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("captures the pointer while panning, so a pan ending over the backdrop keeps it open", () => {
    const capture = vi.fn();
    Element.prototype.setPointerCapture = capture;
    const image = openSheet();
    image.dispatchEvent(new MouseEvent("dblclick", { clientX: 500, clientY: 500 }));
    image.dispatchEvent(new MouseEvent("pointerdown", { clientX: 700, clientY: 600, button: 0 }));
    expect(capture).toHaveBeenCalled();
    image.dispatchEvent(new MouseEvent("pointermove", { clientX: 900, clientY: 600 }));
    image.dispatchEvent(new MouseEvent("pointerup", { clientX: 900, clientY: 600 }));
    els.lightbox.dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(els.lightbox.dialog.open).toBe(true);
    els.lightbox.dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(els.lightbox.dialog.open).toBe(false);
  });
});

describe("ready and empty states", () => {
  it("shows the hint only for an empty chat with no video", () => {
    view = { video: undefined, url: null };
    const conversation = initConversation(els, deps());
    conversation.reset([]);
    expect(els.conversation.empty.hidden).toBe(false);
    view = { video: beach, url: "blob:beach" };
    conversation.refreshVideos();
    expect(els.conversation.empty.hidden).toBe(true);
  });

  it("offers starters once the overview is ready and fills the composer", () => {
    const conversation = initConversation(els, deps());
    const card = els.conversation.scroller.querySelector<HTMLElement>(".ready-card");
    expect(card?.hidden).toBe(true);
    conversation.setReady(beach);
    expect(card?.hidden).toBe(false);
    expect(card?.textContent).not.toContain("is ready");
    const starters = [...(card?.querySelectorAll<HTMLButtonElement>("button.starter") ?? [])];
    expect(starters.length).toBeGreaterThanOrEqual(2);
    starters[1]?.click();
    expect(spies.onPrefill).toHaveBeenCalledWith("Who is in this?");
    conversation.setReady(undefined);
    expect(card?.hidden).toBe(true);
  });

  it("shows the Study and thoroughness note once ever", () => {
    const card = els.conversation.readyCard;
    const note = () => card.querySelector<HTMLElement>(".ready-note");
    const conversation = initConversation(els, deps());
    conversation.setReady(beach);
    expect(note()?.hidden).toBe(false);
    conversation.refreshVideos();
    expect(note()?.hidden).toBe(false);
    conversation.setReady(undefined);
    const later = { ...beach, fileKey: "dunes-key", name: "dunes.mp4" };
    conversation.setReady(later);
    expect(note()?.hidden).toBe(true);
    expect(card.hidden).toBe(false);
  });

  it("drops the starters once the chat has messages, and hides a card left empty", () => {
    localStorage.setItem("vid2grid-chat-ready-note-seen", "seen");
    const card = els.conversation.readyCard;
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "Hi"), assistant("a1", "Hello")]);
    conversation.setReady(beach);
    expect(card.querySelector<HTMLElement>(".ready-suggestions")?.hidden).toBe(true);
    expect(card.hidden).toBe(true);
  });
});

describe("bare times and the video length", () => {
  it("leave bare times past the end of the message's video as text", () => {
    const long = { ...beach, name: "dunes.mp4", fileKey: "dunes-key", durationSeconds: 600 };
    view = { video: long, url: "blob:dunes" };
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "Look", { video: beach }),
      assistant("a1", "She waves at 1:00 and again at 5:00."),
      user("u2", "And this one?", { video: long }),
      assistant("a2", "He waves at 1:00 and again at 5:00."),
    ]);
    const replies = [...list().querySelectorAll(".message.assistant")];
    const linked = replies.map((reply) =>
      [...reply.querySelectorAll("button.timestamp")].map((link) => link.textContent),
    );
    expect(linked).toEqual([["1:00"], ["1:00", "5:00"]]);
  });
});

describe("timestamps in older messages", () => {
  const dunes: VideoAttachment = { ...beach, name: "dunes.mp4", fileKey: "dunes-key" };

  it("seek the video the message was about, not the chat's current one", () => {
    view = { video: dunes, url: "blob:dunes" };
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "At [0:05]?", { video: beach }),
      assistant("a1", "Yes, at [0:06]."),
      user("u2", "And [0:07]?", { video: dunes }),
      assistant("a2", "At [0:08]."),
    ]);
    const links = [...list().querySelectorAll<HTMLButtonElement>("button.timestamp")];
    links.forEach((link) => link.click());
    expect(spies.onSeek.mock.calls).toEqual([
      [5, beach],
      [6, beach],
      [7, dunes],
      [8, dunes],
    ]);
  });

  it("seek the current video from messages under the latest attachment after a reattach", () => {
    const changed = { ...dunes, fileKey: "dunes-changed" };
    view = { video: changed, url: "blob:dunes" };
    const conversation = initConversation(els, deps());
    conversation.reset([
      user("u1", "At [0:05]?", { video: beach }),
      user("u2", "And [0:07]?", { video: dunes }),
    ]);
    const links = [...list().querySelectorAll<HTMLButtonElement>("button.timestamp")];
    links.forEach((link) => link.click());
    expect(spies.onSeek.mock.calls).toEqual([
      [5, beach],
      [7, changed],
    ]);
  });

  it("seek the current video when no earlier message attached one", () => {
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "At [0:05]?")]);
    list().querySelector<HTMLButtonElement>("button.timestamp")?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(5, beach);
  });

  it("seek the older video from links inside that turn's activity row", () => {
    view = { video: dunes, url: "blob:dunes" };
    const conversation = initConversation(els, deps());
    const [first, ...rest] = investigation();
    if (first?.role !== "user") throw new Error("No user message");
    conversation.reset([{ ...first, video: beach }, ...rest, user("u2", "Now", { video: dunes })]);
    openActivity().querySelector<HTMLButtonElement>(".activity-call .timestamp")?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(40, beach);
  });
});

describe("editing", () => {
  function editor(): HTMLTextAreaElement | null {
    return list().querySelector<HTMLTextAreaElement>(".message-editor textarea");
  }

  it("edits the last message on request, but not while a turn runs", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(exchanges());
    running = true;
    expect(conversation.editLast()).toBe(false);
    running = false;
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
    running = true;
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
    running = true;
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
    verifying = () => new Promise((resolve) => (finish = resolve));
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
    verifying = (_message, given) => {
      signal = given;
      return new Promise(() => undefined);
    };
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
    verifying = (_message, given) => {
      signal = given;
      return new Promise(() => undefined);
    };
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
    verifying = onVerify;
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
    verifying = (_message, given) => {
      signal = given;
      return new Promise(() => undefined);
    };
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
