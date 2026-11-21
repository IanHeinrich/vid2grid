import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoAttachment } from "../src/types";
import { initConversation } from "../src/ui/conversation/conversation";
import {
  beach,
  buttonsLabelled,
  deps,
  els,
  investigation,
  list,
  look,
  openActivity,
  resetConversation,
  setShowThinking,
  setVerifying,
  setView,
  spies,
} from "./support/conversation";
import { assistant, sheet, tool, user } from "./support/factories";

beforeEach(resetConversation);

afterEach(() => {
  vi.restoreAllMocks();
});

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
    setVerifying(verify);
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
    setShowThinking(true);
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
    setShowThinking(true);
    summary()?.click();
    conversation.reset(investigation());
    expect(details()?.open).toBe(false);
  });
});

describe("live activity", () => {
  it("streams reasoning into the open row in place", () => {
    setShowThinking(true);
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

describe("bare times and the video length", () => {
  it("leave bare times past the end of the message's video as text", () => {
    const long = { ...beach, name: "dunes.mp4", fileKey: "dunes-key", durationSeconds: 600 };
    setView({ video: long, url: "blob:dunes" });
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
    setView({ video: dunes, url: "blob:dunes" });
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
    setView({ video: changed, url: "blob:dunes" });
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
    setView({ video: dunes, url: "blob:dunes" });
    const conversation = initConversation(els, deps());
    const [first, ...rest] = investigation();
    if (first?.role !== "user") throw new Error("No user message");
    conversation.reset([{ ...first, video: beach }, ...rest, user("u2", "Now", { video: dunes })]);
    openActivity().querySelector<HTMLButtonElement>(".activity-call .timestamp")?.click();
    expect(spies.onSeek).toHaveBeenCalledWith(40, beach);
  });
});

describe("cut-short notice", () => {
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
