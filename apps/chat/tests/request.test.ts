import { describe, expect, it } from "vitest";
import { pinsExceedCap, selectImages } from "../src/chat/imageSelection";
import {
  audioNote,
  ANSWER_NOW_NOTE,
  EXHAUSTIVE_GUIDANCE,
  FINAL_ROUND_NOTE,
  NO_TOOLS_LOOKING_GUIDANCE,
} from "../src/chat/prompts";
import { buildRequest, type BuildRequestInput } from "../src/chat/request";
import { keptImages, visibleMessages } from "../src/chat/story";
import { estimateRequestTokens } from "../src/chat/tokenEstimate";
import { imageLabel, imageStub } from "../src/imageRefs";
import type {
  Chat,
  ChatMessage,
  UserMessage,
  VideoCast,
  VideoTimeline,
  WireMessage,
} from "../src/types";
import { answered, described } from "./support/looking";
import {
  sheet,
  overviewSheet,
  upload,
  user,
  assistant,
  tool,
  baseChat,
  videoChat,
  model,
  lookTool,
  input,
  NOT_YET,
  storyHistory,
} from "./support/requestFixtures";

function isContext(message: WireMessage): boolean {
  return (
    message.role === "user" &&
    typeof message.content === "string" &&
    message.content.startsWith("Context for this reply")
  );
}

const contextHistory = [
  user("u1", "look"),
  assistant("a1", "Looking.", ["c1"]),
  tool("t1", "c1", [sheet("s1")]),
  assistant("a2", "A dog."),
  user("u2", "and then?"),
];

describe("buildRequest context block", () => {
  const history = contextHistory;
  const timeline: VideoTimeline = {
    fileKey: "k",
    modelId: "venice-model",
    entries: [{ startSeconds: 0, endSeconds: 60, text: "a dog runs along the beach" }],
    nextWindow: 1,
    windowCount: 1,
    updatedAt: 0,
  };

  it("sends volatile context as a labelled user message before the newest user message", () => {
    const request = buildRequest(
      input({ chat: videoChat, messages: history, timeline, thoroughness: "exhaustive" }),
    );
    const at = request.messages.findIndex(isContext);
    expect(request.messages[at + 1]).toEqual({ role: "user", content: "and then?" });
    expect(at).toBe(request.messages.length - 2);
    const content = request.messages[at]?.content;
    expect(content).toBe(
      [
        "Context for this reply, from the app (not written by the user):",
        "Video timeline (from a study pass):\n[0:00 to 1:00] a dog runs along the beach",
        "Scene log:\n[0:12] dog runs\n[1:30] wave hits",
        EXHAUSTIVE_GUIDANCE,
      ].join("\n\n"),
    );
    expect(request.messages[0]?.content).not.toContain("Scene log");
    expect(request.messages[0]?.content).not.toContain(EXHAUSTIVE_GUIDANCE);
  });

  it("carries the audio note in the context, never in the system prompt", () => {
    const request = buildRequest(
      input({ chat: videoChat, messages: history, audioCoverage: NOT_YET }),
    );
    const context = request.messages.find(isContext)?.content;
    expect(context).toContain(audioNote(NOT_YET));
    expect(request.messages[0]?.content).not.toContain("listen");
  });

  it("stays before the turn's user message across tool rounds", () => {
    const messages = [...history, assistant("a3", "", ["c2"]), tool("t2", "c2")];
    const request = buildRequest(input({ chat: videoChat, messages }));
    const at = request.messages.findIndex(isContext);
    expect(request.messages[at + 1]).toEqual({ role: "user", content: "and then?" });
  });

  it("is left out when there is nothing volatile", () => {
    const request = buildRequest(input({ messages: history }));
    expect(request.messages.some(isContext)).toBe(false);
  });
});

describe("buildRequest transcript", () => {
  const listenTool = { ...lookTool, function: { ...lookTool.function, name: "listen" } };
  const speech = {
    fileKey: "k",
    speechSpans: [{ startSeconds: 0, endSeconds: 125 }],
    speech: [{ start: 12, end: 15, text: "Hello there." }],
  };
  const carrier: UserMessage = {
    ...user("u1", "what is said?"),
    audio: true,
    transcript: { fileKey: "k", spans: speech.speechSpans },
  };
  const audioCoverage = {
    text: "analysed 0:00 to 2:05 (speech and sounds)",
    besideTranscript: "the speech heard is in the transcript; sounds analysed 0:00 to 2:05",
    canListen: true,
  };

  function build(messages: ChatMessage[], extra: Partial<BuildRequestInput> = {}) {
    return buildRequest(
      input({
        chat: videoChat,
        messages,
        tools: [lookTool, listenTool],
        speech,
        audioCoverage,
        ...extra,
      }),
    ).messages;
  }

  it("sends it after the overview, in the message that carries it", () => {
    const overview = overviewSheet("ov");
    const wire = build([{ ...carrier, images: [overview] }], {
      kept: new Set(["ov"]),
      dataUrls: new Map([["ov", "data:ov"]]),
    }).at(-1);
    expect(wire?.content).toEqual([
      { type: "text", text: "what is said?" },
      { type: "text", text: imageLabel(overview) },
      { type: "image_url", image_url: { url: "data:ov" } },
      { type: "text", text: expect.stringContaining("[0:12] Hello there.") as string },
    ]);
  });

  it("stays plain text without images", () => {
    expect(build([carrier]).at(-1)?.content).toMatch(
      /^what is said\?\n\nTranscript of[\s\S]*\n\[0:12\] Hello there\.$/,
    );
  });

  it("is the same on every round of the turn", () => {
    const round = [assistant("a1", "", ["c1"]), tool("t1", "c1")];
    const sent = build([carrier]);
    expect(build([carrier, ...round]).slice(0, sent.length)).toEqual(sent);
  });

  it("keeps the audio note from repeating the speech heard", () => {
    const context = build([carrier]).find(isContext)?.content;
    expect(context).toContain(audioNote({ text: audioCoverage.besideTranscript, canListen: true }));
    expect(context).not.toContain("speech and sounds");
    const plain = build([user("u1", "hi")]).find(isContext)?.content;
    expect(plain).toContain(audioNote(audioCoverage));
  });

  it("becomes a stub on later turns, whatever happens to earlier images", () => {
    const settings = { ...videoChat.settings, earlierImages: "send" as const };
    const later = [carrier, assistant("a1", "Hello."), user("u2", "and then?")];
    const [, first] = build(later, { chat: { ...videoChat, settings } });
    expect(first?.content).toBe(
      "what is said?\n\n[Transcript of the video's speech up to 2:05. Sent earlier; call listen(start, end) to read any range again.]",
    );
    const [, off] = buildRequest(input({ chat: videoChat, messages: later })).messages;
    expect(off?.content).not.toContain("listen");
    expect(off?.content).not.toContain("Hello there.");
  });

  it("stays in full on later turns for a model without tools, and never names listen", () => {
    const noTools = { model: { ...model, tools: false } };
    const [, , first] = build([carrier], noTools);
    expect(first?.content).toContain("[0:12] Hello there.");
    const later = build([carrier, assistant("a1", "Hello."), user("u2", "and then?")], noTools);
    expect(later[1]).toEqual(first);
    const context = later.find(isContext)?.content;
    expect(context).toContain(`Audio: ${audioCoverage.besideTranscript}.`);
    expect(JSON.stringify([first, later])).not.toContain("listen");
  });

  it("never tells a model without tools to call listen, transcript or not", () => {
    const wire = build([user("u1", "hi")], { model: { ...model, tools: false } });
    expect(wire.find(isContext)?.content).toContain(`Audio: ${audioCoverage.text}.`);
    expect(JSON.stringify(wire)).not.toContain("listen");
  });
});

describe("buildRequest cast", () => {
  it("puts the cast in the context block, never in the system prompt", () => {
    const cast: VideoCast = {
      fileKey: "k",
      cards: [{ id: "c1", name: "Mara", description: "red coat" }],
      updatedAt: 0,
    };
    const request = buildRequest(input({ messages: contextHistory, cast }));
    const context = request.messages.find(isContext);
    expect(context?.content).toContain("Cast:\n- Mara: red coat");
    expect(request.messages[0]?.content).not.toContain("Cast:");
    expect(JSON.stringify(request)).not.toContain("img");
  });
});

describe("buildRequest alternates", () => {
  const alternateReply = {
    messages: [
      assistant("old-a", "An old answer.", ["old-c"]),
      tool("old-t", "old-c", [sheet("old-s", true)]),
    ],
    modelId: "other-model",
    createdAt: 0,
  };
  const answer = assistant("a1", "A dog.");
  const plain: ChatMessage[] = [user("u1", "look"), answer];
  const swiped: ChatMessage[] = [
    { ...user("u1", "look"), alternates: [alternateReply], replyIndex: 1 },
    answer,
  ];

  it("never sends alternate replies or counts their images", () => {
    const kept = selectImages(swiped, 10);
    expect(kept.size).toBe(0);
    const plainRequest = buildRequest(input({ messages: plain, kept }));
    const swipedRequest = buildRequest(input({ messages: swiped, kept }));
    expect(swipedRequest).toEqual(plainRequest);
    expect(JSON.stringify(swipedRequest)).not.toContain("old answer");
    expect(estimateRequestTokens(swipedRequest, 1024)).toBe(
      estimateRequestTokens(plainRequest, 1024),
    );
    expect(pinsExceedCap(swiped, 0)).toBe(false);
  });
});

describe("buildRequest prompt prefix", () => {
  const history = contextHistory;

  it("keeps every message before the context block identical when a note is added", () => {
    const kept = new Set(["s1"]);
    const dataUrls = new Map([["s1", "data:s1"]]);
    const first = buildRequest(input({ chat: videoChat, messages: history, kept, dataUrls }));
    const noted = {
      ...videoChat,
      sceneLog: [...videoChat.sceneLog, { timeSeconds: 40, text: "a gull lands" }],
    };
    const second = buildRequest(input({ chat: noted, messages: history, kept, dataUrls }));
    const firstAt = first.messages.findIndex(isContext);
    const secondAt = second.messages.findIndex(isContext);
    expect(firstAt).toBeGreaterThan(0);
    expect(secondAt).toBe(firstAt);
    expect(JSON.stringify(second.messages.slice(0, secondAt))).toBe(
      JSON.stringify(first.messages.slice(0, firstAt)),
    );
    expect(second.messages[secondAt]?.content).toContain("[0:40] a gull lands");
  });
});
function summarised(throughMessageId: string): Chat {
  return { ...baseChat, storySoFar: { text: "A dog ran.", throughMessageId, updatedAt: 0 } };
}

describe("buildRequest story so far", () => {
  const history = storyHistory;

  it("drops messages up to the summary and sends the summary as context", () => {
    const chat = summarised("a2");
    const request = buildRequest(
      input({
        chat,
        messages: history,
        kept: new Set(["a", "s1", "b"]),
        dataUrls: new Map([
          ["a", "data:a"],
          ["s1", "data:s1"],
          ["b", "data:b"],
        ]),
      }),
    );
    expect(request.messages).toEqual([
      { role: "system", content: "Be brief." },
      {
        role: "user",
        content:
          "Context for this reply, from the app (not written by the user):\n\nChat summary: A dog ran.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "next" },
          { type: "text", text: "image b.jpg" },
          { type: "image_url", image_url: { url: "data:b" } },
        ],
      },
    ]);
    expect(visibleMessages(chat, history)).toEqual(history.slice(4));
  });
});

describe("buildRequest story so far edges", () => {
  const history = storyHistory;

  it("drops orphaned tool replies when the summary ends mid-turn", () => {
    const request = buildRequest(input({ chat: summarised("a1"), messages: history }));
    expect(request.messages.map((message) => message.role)).toEqual([
      "system",
      "assistant",
      "user",
      "user",
    ]);
  });

  it("ignores an older summary whose message is gone", () => {
    const chat = summarised("missing");
    const request = buildRequest(input({ chat, messages: history }));
    expect(JSON.stringify(request.messages)).not.toContain("Chat summary");
    expect(request.messages[1]).toMatchObject({ role: "user" });
    expect(visibleMessages(chat, history)).toBe(history);
  });

  it("cuts by time once the summary's last message is deleted", () => {
    const timed = history.map((message, index) => ({ ...message, createdAt: index + 1 }));
    const story = { text: "A dog ran.", throughMessageId: "a2", throughCreatedAt: 4, updatedAt: 0 };
    const chat = { ...baseChat, storySoFar: story };
    const withoutThrough = timed.filter((message) => message.id !== "a2");
    expect(visibleMessages(chat, withoutThrough).map((message) => message.id)).toEqual(["u2"]);
  });
});

describe("buildRequest images from before the story's cut", () => {
  const history: ChatMessage[] = [
    user("u1", "first", [upload("pin", true), upload("old")]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", [overviewSheet("ov1"), overviewSheet("ov2")]),
    assistant("a2", "Seen."),
    user("u2", "next", [upload("b")]),
  ];
  const summary = summarised("a2");
  const chat: Chat = { ...summary, settings: { ...summary.settings, earlierImages: "send" } };
  const dataUrls = new Map(["pin", "old", "ov1", "ov2", "b"].map((id) => [id, `data:${id}`]));

  it("sends pins and the latest overview in one message right after the system prompt", () => {
    const kept = keptImages(chat, history, 10);
    expect([...kept].sort()).toEqual(["b", "ov1", "ov2", "pin"]);
    const request = buildRequest(input({ chat, messages: history, kept, dataUrls }));
    expect(request.messages[1]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "Images from earlier in the conversation, kept after the chat summary replaced it:",
        },
        { type: "text", text: "image pin.jpg" },
        { type: "image_url", image_url: { url: "data:pin" } },
        { type: "text", text: "ov1 from overview: 0:00 to 2:05, 20 frames" },
        { type: "image_url", image_url: { url: "data:ov1" } },
        { type: "text", text: "ov2 from overview: 0:00 to 2:05, 20 frames" },
        { type: "image_url", image_url: { url: "data:ov2" } },
      ],
    });
    expect(JSON.stringify(request.messages)).not.toContain("old.jpg");
  });

  it("budgets the carried images with the visible ones", () => {
    expect([...keptImages(chat, history, 3)].sort()).toEqual(["b", "ov1", "pin"]);
  });

  it("leaves the earlier overview behind once a newer one is visible", () => {
    const newer = [
      ...history,
      assistant("a3", "", ["c2"]),
      tool("t2", "c2", [overviewSheet("ov3")]),
    ];
    const request = buildRequest(
      input({ chat, messages: newer, kept: keptImages(chat, newer, 10), dataUrls }),
    );
    expect(JSON.stringify(request.messages[1])).not.toContain("ov1");
    expect(JSON.stringify(request.messages[1])).toContain("data:pin");
  });

  it("sends no extra message when nothing before the cut is pinned or an overview", () => {
    const request = buildRequest(input({ chat, messages: storyHistory }));
    expect(request.messages.map((message) => message.role)).toEqual(["system", "user", "user"]);
  });
});

describe("buildRequest images from before the story's cut when describing", () => {
  const history: ChatMessage[] = [
    user("u1", "first", [upload("pin", true)]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", [overviewSheet("ov1")]),
    assistant("a2", "Seen."),
    user("u2", "next"),
  ];
  const chat = summarised("a2");
  const dataUrls = new Map(["pin", "ov1"].map((id) => [id, `data:${id}`]));

  it("carries only the pins it still sends, leaving the earlier overview behind", () => {
    const kept = keptImages(chat, history, 10);
    expect([...kept]).toEqual(["pin"]);
    const request = buildRequest(input({ chat, messages: history, kept, dataUrls }));
    const carried = JSON.stringify(request.messages[1]);
    expect(carried).toContain("kept after the chat summary replaced it");
    expect(carried).toContain("data:pin");
    expect(JSON.stringify(request.messages)).not.toContain("ov1");
  });

  it("sends no carried message when nothing before the cut is pinned", () => {
    const unpinned = history.map((message) =>
      message.id === "u1" ? user("u1", "first", [upload("pin")]) : message,
    );
    const request = buildRequest(input({ chat, messages: unpinned }));
    expect(request.messages.map((message) => message.role)).toEqual(["system", "user", "user"]);
  });
});

describe("buildRequest messages", () => {
  it("sends kept images with labels and stubs the rest, in order", () => {
    const messages = [user("u1", "compare", [upload("a"), upload("b"), upload("c")])];
    const request = buildRequest(
      input({
        messages,
        kept: new Set(["a", "c"]),
        dataUrls: new Map([
          ["a", "data:a"],
          ["c", "data:c"],
        ]),
      }),
    );
    expect(request.messages).toEqual([
      { role: "system", content: "Be brief." },
      {
        role: "user",
        content: [
          { type: "text", text: "compare" },
          { type: "text", text: "image a.jpg" },
          { type: "image_url", image_url: { url: "data:a" } },
          { type: "text", text: imageStub(upload("b")) },
          { type: "text", text: "image c.jpg" },
          { type: "image_url", image_url: { url: "data:c" } },
        ],
      },
    ]);
  });

  it("sends a Keep going continuation as plain user text", () => {
    const keepGoing: UserMessage = { ...user("u2", "Keep going."), continuation: true };
    const request = buildRequest(input({ messages: [user("u1", "hi"), keepGoing] }));
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "Keep going." });
  });

  it("sends a user message without images as a string and skips an empty system prompt", () => {
    const chat = { ...baseChat, settings: { ...baseChat.settings, systemPrompt: "" } };
    const request = buildRequest(input({ chat, messages: [user("u", "hi")] }));
    expect(request.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("buildRequest tool replies", () => {
  it("puts tool images in one user message after the consecutive tool replies", () => {
    const messages = [
      user("u1", "look"),
      assistant("a1", "Looking.", ["c1", "c2"]),
      tool("t1", "c1", [sheet("s1")]),
      tool("t2", "c2", [sheet("s2")]),
      assistant("a2", "Done."),
    ];
    const request = buildRequest(
      input({ messages, kept: new Set(["s1"]), dataUrls: new Map([["s1", "data:s1"]]) }),
    );
    expect(request.messages.slice(1)).toEqual([
      { role: "user", content: "look" },
      {
        role: "assistant",
        content: "Looking.",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "look", arguments: "{}" } },
          { id: "c2", type: "function", function: { name: "look", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "result c1" },
      { role: "tool", tool_call_id: "c2", content: "result c2" },
      {
        role: "user",
        content: [
          { type: "text", text: imageLabel(sheet("s1")) },
          { type: "image_url", image_url: { url: "data:s1" } },
          { type: "text", text: imageStub(sheet("s2")) },
        ],
      },
      { role: "assistant", content: "Done." },
    ]);
  });

  it("sends a reused image only at its latest appearance", () => {
    const messages = [
      assistant("a1", "", ["c1"]),
      tool("t1", "c1", [sheet("s")]),
      assistant("a2", "", ["c2"]),
      tool("t2", "c2", [sheet("s")]),
    ];
    const request = buildRequest(
      input({ messages, kept: new Set(["s"]), dataUrls: new Map([["s", "data:s"]]) }),
    );
    const imageMessages = request.messages.filter((m) => m.role === "user");
    expect(imageMessages.map((m) => m.content)).toEqual([
      [{ type: "text", text: imageStub(sheet("s")) }],
      [
        { type: "text", text: imageLabel(sheet("s")) },
        { type: "image_url", image_url: { url: "data:s" } },
      ],
    ]);
  });
});

describe("buildRequest sanitising", () => {
  it("drops tool calls without replies and replies without calls", () => {
    const messages = [
      user("u1", "look"),
      assistant("a1", "", ["c1", "c2"]),
      tool("t1", "c1"),
      tool("stray", "c9"),
      user("u2", "stop"),
      tool("orphan", "c2"),
      assistant("a2", "Partial answer", ["c3"]),
      assistant("a3", "", ["c4"]),
    ];
    const request = buildRequest(input({ messages }));
    expect(request.messages.slice(1)).toEqual([
      { role: "user", content: "look" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "look", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "result c1" },
      { role: "user", content: "stop" },
      { role: "assistant", content: "Partial answer" },
    ]);
  });

  it("keeps the text of an assistant stopped before any tool replied", () => {
    const messages = [
      user("u1", "look"),
      assistant("a1", "Let me look.", ["c1", "c2"]),
      user("u2", "never mind"),
    ];
    expect(buildRequest(input({ messages })).messages.slice(1)).toEqual([
      { role: "user", content: "look" },
      { role: "assistant", content: "Let me look." },
      { role: "user", content: "never mind" },
    ]);
  });
});

describe("buildRequest without vision", () => {
  it("stubs every image, kept or not", () => {
    const messages = [
      user("u1", "what is this", [upload("a")]),
      assistant("a1", "", ["c1"]),
      tool("t1", "c1", [sheet("s")]),
    ];
    const request = buildRequest(
      input({
        messages,
        model: { ...model, vision: false },
        kept: new Set(["a", "s"]),
        dataUrls: new Map([
          ["a", "data:a"],
          ["s", "data:s"],
        ]),
      }),
    );
    const parts = request.messages.flatMap((m) =>
      m.role === "user" && Array.isArray(m.content) ? m.content : [],
    );
    expect(parts).toEqual([
      { type: "text", text: "what is this" },
      { type: "text", text: imageStub(upload("a"), "noVision") },
      { type: "text", text: imageStub(sheet("s"), "noVision") },
    ]);
    expect(imageStub(upload("a"), "noVision")).toBe(
      "[image a.jpg. Not attached: this model cannot see images.]",
    );
  });
});

describe("buildRequest options", () => {
  it("names the model it was given, even when the chat names none", () => {
    const chat = { ...baseChat, settings: { ...baseChat.settings, modelId: "" } };
    expect(buildRequest(input({ chat })).model).toBe(model.id);
  });

  it("includes tools only when allowed, supported and present", () => {
    expect(buildRequest(input({})).tools).toEqual([lookTool]);
    expect(buildRequest(input({ allowTools: false }))).not.toHaveProperty("tools");
    expect(buildRequest(input({ model: { ...model, tools: false } }))).not.toHaveProperty("tools");
    expect(buildRequest(input({ tools: [] }))).not.toHaveProperty("tools");
  });

  it("sends the tool guidance exactly when it lists tools", () => {
    const guided = { toolGuidance: "Use look to see the video." };
    const systemOf = (overrides: Parameters<typeof input>[0]) =>
      buildRequest(input({ ...guided, ...overrides })).messages[0]?.content;
    expect(systemOf({ chat: videoChat })).toContain(guided.toolGuidance);
    expect(systemOf({})).toContain(guided.toolGuidance);
    expect(systemOf({ chat: videoChat, finalRound: true })).toContain(guided.toolGuidance);
    expect(systemOf({ chat: videoChat, allowTools: false })).not.toContain(guided.toolGuidance);
    expect(systemOf({ chat: videoChat, model: { ...model, tools: false } })).not.toContain(
      guided.toolGuidance,
    );
  });

  it("keeps tools listed on the final round but forbids calling them", () => {
    expect(buildRequest(input({}))).not.toHaveProperty("tool_choice");
    const final = buildRequest(input({ finalRound: true }));
    expect(final).toMatchObject({ tools: [lookTool], tool_choice: "none" });
    const noTools = buildRequest(input({ finalRound: true, allowTools: false }));
    expect(noTools).not.toHaveProperty("tools");
    expect(noTools).not.toHaveProperty("tool_choice");
  });

  it("ends the final round with a note to answer, without touching the history", () => {
    const messages = [user("u1", "look")];
    const final = buildRequest(input({ messages, finalRound: true }));
    expect(final.messages.slice(1)).toEqual([
      { role: "user", content: "look" },
      { role: "user", content: FINAL_ROUND_NOTE },
    ]);
    expect(messages).toEqual([user("u1", "look")]);
    expect(buildRequest(input({ messages })).messages.at(-1)).toEqual({
      role: "user",
      content: "look",
    });
  });

  it("includes temperature and reasoning effort only when set", () => {
    const bare = buildRequest(input({}));
    expect(bare).not.toHaveProperty("temperature");
    expect(bare).not.toHaveProperty("reasoning_effort");
    const settings = { ...baseChat.settings, temperature: 0.3, reasoningEffort: "high" };
    const reasoner = { ...model, reasoning: true, reasoningEffortOptions: ["low", "high"] };
    const tuned = buildRequest(input({ chat: { ...baseChat, settings }, model: reasoner }));
    expect(tuned).toMatchObject({ temperature: 0.3, reasoning_effort: "high" });
  });

  it("clamps a reasoning effort to the model's levels and sends none without levels", () => {
    const settings = { ...baseChat.settings, reasoningEffort: "high" };
    const lowOnly = { ...model, reasoning: true, reasoningEffortOptions: ["low"] };
    const chat = { ...baseChat, settings };
    expect(buildRequest(input({ chat, model: lowOnly }))).toMatchObject({
      reasoning_effort: "low",
    });
    expect(buildRequest(input({ chat }))).not.toHaveProperty("reasoning_effort");
  });
});

describe("buildRequest reasoning effort", () => {
  it("takes the effort from the message, then the chat, then the tier", () => {
    const reasoner = { ...model, reasoningEffortOptions: ["none", "low", "medium", "high"] };
    const asked: UserMessage = { ...user("u1", "hi"), reasoningEffort: "low" };
    const settings = { ...baseChat.settings, reasoningEffort: "medium" };
    const chat = { ...baseChat, settings };
    const effort = (overrides: Partial<BuildRequestInput>) =>
      buildRequest(input({ model: reasoner, ...overrides })).reasoning_effort;
    expect(effort({ chat, messages: [asked], thoroughness: "exhaustive" })).toBe("low");
    expect(effort({ chat, messages: [user("u1", "hi")], thoroughness: "exhaustive" })).toBe(
      "medium",
    );
    expect(effort({ thoroughness: "exhaustive" })).toBe("high");
    expect(effort({ thoroughness: "thorough" })).toBe("medium");
    expect(effort({ thoroughness: "normal" })).toBeUndefined();
  });

  it("answers now with tools forbidden, the lowest effort and its own note", () => {
    const reasoner = { ...model, reasoningEffortOptions: ["low", "medium", "high"] };
    const settings = { ...baseChat.settings, reasoningEffort: "high" };
    const request = buildRequest(
      input({
        chat: { ...baseChat, settings },
        model: reasoner,
        messages: [user("u1", "hi")],
        answerNow: true,
        finalRound: true,
      }),
    );
    expect(request).toMatchObject({
      tools: [lookTool],
      tool_choice: "none",
      reasoning_effort: "low",
    });
    expect(request.messages.at(-1)).toEqual({ role: "user", content: ANSWER_NOW_NOTE });
    expect(JSON.stringify(request.messages)).not.toContain(FINAL_ROUND_NOTE);
  });

  it("always asks for usage in the stream", () => {
    expect(buildRequest(input({}))).toMatchObject({ stream_options: { include_usage: true } });
  });

  it("adds the Venice flag only when asked and always streams the chat's model", () => {
    expect(buildRequest(input({}))).not.toHaveProperty("venice_parameters");
    expect(buildRequest(input({}))).not.toHaveProperty("prompt_cache_key");
    const venice = input({ veniceParameters: true });
    expect(buildRequest(venice)).toMatchObject({
      model: "venice-model",
      stream: true,
      venice_parameters: { include_venice_system_prompt: false },
      prompt_cache_key: venice.chat.id,
    });
  });
});

describe("with a looking model", () => {
  const seen = [described(["a"], "A dog.")];
  const looked = { ...user("u1", "Look.", [upload("a")]), seen };
  const looking: Chat = {
    ...baseChat,
    settings: { ...baseChat.settings, lookingModelId: "eyes" },
  };
  const sendable = { kept: new Set(["a"]), dataUrls: new Map([["a", "data:a"]]) };

  it("sends words in place of every picture, whatever the writer sees", () => {
    const request = buildRequest(input({ chat: looking, messages: [looked], ...sendable }));
    expect(request.messages.at(-1)).toEqual({
      role: "user",
      content:
        "Look.\n\n[Note from the app, not written by the user: what the looking model saw in the pictures named here.]\n[image a.jpg]\nA dog.\n[End of the app's note.]",
    });
  });

  it("sends the same in later turns and in both earlier image modes", () => {
    const later = [looked, assistant("a1", "Nice."), user("u2", "And?")];
    const sent = (earlierImages: "send" | "describe") => {
      const chat = { ...looking, settings: { ...looking.settings, earlierImages } };
      return buildRequest(input({ chat, messages: later, ...sendable })).messages;
    };
    expect(sent("send")).toEqual(sent("describe"));
    expect(JSON.stringify(sent("send"))).toContain("A dog.");
    expect(JSON.stringify(sent("send"))).not.toContain("image_url");
  });

  it("puts what a tool's pictures show in its reply", () => {
    const reply = { ...tool("t1", "c1", [sheet("s1")]), seen: [described(["s1"], "A wave.")] };
    const messages = [user("u1", "Look."), assistant("a1", "", ["c1"]), reply];
    const request = buildRequest(input({ chat: looking, messages }));
    expect(request.messages.at(-1)).toMatchObject({ role: "tool" });
    expect(request.messages.at(-1)?.content).toMatch(/^result c1\n\n[^]*A wave\.\n\[End/);
  });

  it("carries the words for a pinned picture past a summary", () => {
    const pinned = { ...looked, images: [upload("a", true)] };
    const messages = [pinned, assistant("a1", "Nice."), user("u2", "And?")];
    const storySoFar = { text: "They met.", throughMessageId: "a1", updatedAt: 1 };
    const request = buildRequest(input({ chat: { ...looking, storySoFar }, messages }));
    expect(JSON.stringify(request.messages[1])).toContain("A dog.");
  });

  it("tells a writer without tools that it cannot see, once there are pictures", () => {
    const system = (messages: UserMessage[]) =>
      buildRequest(input({ chat: looking, messages, allowTools: false, toolGuidance: "Tools." }))
        .messages[0]?.content;
    expect(system([looked])).toContain(NO_TOOLS_LOOKING_GUIDANCE);
    expect(system([looked])).not.toContain("Tools.");
    expect(system([user("u1", "Hi.")])).not.toContain(NO_TOOLS_LOOKING_GUIDANCE);
  });

  it("does not tell the writer to ask in a round that may call nothing", () => {
    const unseen = user("u1", "Look.", [upload("a")]);
    const sent = (extra: Partial<BuildRequestInput>) =>
      JSON.stringify(buildRequest(input({ chat: looking, messages: [unseen], ...extra })));
    expect(sent({})).toContain("call ask");
    expect(sent({ finalRound: true })).toContain("Not looked at yet.]");
    expect(sent({ answerNow: true })).not.toContain("call ask");
  });

  describe("and a transcript", () => {
    const listenTool = { ...lookTool, function: { ...lookTool.function, name: "listen" } };
    const heard = [{ startSeconds: 0, endSeconds: 125 }];
    const carrier: UserMessage = {
      ...looked,
      audio: true,
      transcript: { fileKey: "k", spans: heard },
    };
    const reply = assistant("a1", "Nice.");
    const asked = answered(["a"], "Red.", { question: "And?" });

    function build(messages: ChatMessage[], extra: Partial<BuildRequestInput> = {}) {
      return buildRequest(
        input({
          chat: { ...videoChat, settings: looking.settings },
          messages,
          tools: [lookTool, listenTool],
          speech: {
            fileKey: "k",
            speechSpans: heard,
            speech: [{ start: 12, end: 15, text: "Hello there." }],
          },
          audioCoverage: { text: "analysed", canListen: true },
          ...sendable,
          ...extra,
        }),
      ).messages;
    }

    it("sends one string: the message, what its pictures show, then the transcript", () => {
      expect(build([carrier]).at(-1)?.content).toMatch(
        /^Look\.\n\n\[Note from the app[^]*\[image a\.jpg\]\nA dog\.\n\[End of the app's note\.\]\n\nTranscript of[^]*\n\[0:12\] Hello there\.$/,
      );
    });

    it("sends the same on every round of the turn, its last included", () => {
      const first = build([carrier]);
      const round = [assistant("a0", "", ["c1"]), tool("t1", "c1")];
      for (const extra of [{}, { finalRound: true }, { answerNow: true }]) {
        expect(build([carrier, ...round], extra).slice(0, first.length)).toEqual(first);
      }
    });

    it("puts the stub in its place on later turns", () => {
      const [, sent] = build([carrier, reply, user("u2", "And?")]);
      expect(sent?.content).toMatch(
        /A dog\.\n\[End of the app's note\.\]\n\n\[Transcript of the video's speech up to 2:05\. Sent earlier; call listen[^]*\]$/,
      );
      expect(sent?.content).not.toContain("Hello there.");
    });

    it("keeps it in full for a writer without tools, beside what it was answered", () => {
      const noTools = { model: { ...model, tools: false } };
      const later = { ...user("u2", "And?"), seen: [asked] };
      const wire = build([carrier, reply, later], noTools);
      const [, , first] = build([carrier], noTools);
      expect(first?.content).toContain("[0:12] Hello there.");
      expect(wire[1]).toEqual(first);
      expect(wire.at(-1)?.content).toMatch(/^And\?\n\n\[Note from the app[^]*\nRed\.\n\[End/);
      expect(JSON.stringify(wire)).not.toContain("listen");
    });

    it("sends it after the answer when one message has both", () => {
      const both = { ...carrier, text: "And?", images: [], seen: [asked] };
      const [, , sent] = build([both], { model: { ...model, tools: false } });
      expect(sent?.content).toMatch(/^And\?\n\n[^]*Red\.\n\[End[^]*\]\n\nTranscript of/);
    });
  });

  it("ignores what was seen once it is off, so the request is what it always was", () => {
    const plain = user("u1", "Look.", [upload("a")]);
    const note = { ...plain, seen: [...seen, answered(["a"], "Red.", { question: "Look." })] };
    const request = (message: UserMessage) =>
      JSON.stringify(buildRequest(input({ messages: [message], ...sendable })));
    expect(request(note)).toBe(request(plain));
    expect(request(note)).toContain("data:a");
  });
});
