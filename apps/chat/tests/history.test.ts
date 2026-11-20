import { describe, expect, it } from "vitest";
import {
  AUDIO_GUIDANCE,
  answerStyle,
  audioNote,
  applyPersonaNames,
  buildContext,
  buildRequest,
  ANSWER_NOW_NOTE,
  buildSystemPrompt,
  currentTurn,
  effectiveVideoReferences,
  estimateRequestTokens,
  EXHAUSTIVE_GUIDANCE,
  FINAL_ROUND_NOTE,
  imageLabel,
  imageStub,
  keptImages,
  pinsExceedCap,
  recallName,
  selectImages,
  THOROUGH_GUIDANCE,
  storyForBranch,
  visibleMessages,
  type BuildRequestInput,
} from "../src/chat/history";
import type {
  AssistantMessage,
  Chat,
  ChatMessage,
  ChatRequest,
  ImageRef,
  ModelInfo,
  ToolMessage,
  ToolSchema,
  UserMessage,
  VideoCast,
  VideoTimeline,
  WireMessage,
} from "../src/types";

function sheet(id: string, pinned = false): ImageRef {
  return {
    id,
    pinned,
    source: {
      kind: "sheet",
      call: "look(60, 90)",
      name: `grid_${id}`,
      startSeconds: 60,
      endSeconds: 90,
      frameCount: 16,
    },
  };
}

function overviewSheet(id: string): ImageRef {
  return {
    id,
    pinned: false,
    source: {
      kind: "sheet",
      call: "overview",
      name: id,
      startSeconds: 0,
      endSeconds: 125,
      frameCount: 20,
    },
  };
}

function upload(id: string, pinned = false): ImageRef {
  return { id, pinned, source: { kind: "upload", name: `${id}.jpg` } };
}

function user(id: string, text: string, images: ImageRef[] = []): UserMessage {
  return { id, createdAt: 0, role: "user", text, images };
}

function assistant(id: string, text: string, callIds: string[] = []): AssistantMessage {
  const toolCalls = callIds.map((callId) => ({ id: callId, name: "look", arguments: "{}" }));
  return { id, createdAt: 0, role: "assistant", text, toolCalls };
}

function tool(id: string, toolCallId: string, images: ImageRef[] = []): ToolMessage {
  return { id, createdAt: 0, role: "tool", toolCallId, text: `result ${toolCallId}`, images };
}

const baseChat: Chat = {
  id: "chat",
  title: "Chat",
  createdAt: 0,
  updatedAt: 0,
  settings: { systemPrompt: "Be brief.", modelId: "venice-model", sheetResolution: 1024 },
  sceneLog: [],
};

const videoChat: Chat = {
  ...baseChat,
  video: { name: "beach.mp4", fileKey: "k", durationSeconds: 125, width: 1920, height: 1080 },
  sceneLog: [
    { timeSeconds: 90, text: "wave hits" },
    { timeSeconds: 12, text: "dog runs" },
  ],
};

const model: ModelInfo = {
  id: "venice-model",
  name: "Venice",
  vision: true,
  tools: true,
  reasoning: false,
  reasoningEffortOptions: [],
  maxImages: 10,
  privacy: "private",
  traits: [],
  uncensored: false,
  recommended: false,
  beta: false,
  videoInput: false,
  audioInput: false,
  e2ee: false,
};

const lookTool: ToolSchema = {
  type: "function",
  function: { name: "look", description: "Look at a span", parameters: {} },
};

function input(overrides: Partial<BuildRequestInput>): BuildRequestInput {
  return {
    chat: baseChat,
    messages: [],
    model,
    kept: new Set(),
    dataUrls: new Map(),
    tools: [lookTool],
    toolGuidance: "Use look to see the video.",
    veniceParameters: false,
    allowTools: true,
    finalRound: false,
    ...overrides,
  };
}

describe("selectImages", () => {
  const history: ChatMessage[] = [
    user("u1", "first", [upload("a"), upload("b", true)]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", [sheet("c"), sheet("d")]),
    user("u2", "again", [upload("e")]),
  ];

  it("keeps pins plus the newest images across user and tool messages up to the cap", () => {
    expect(selectImages(history, 3, "send")).toEqual(new Set(["b", "e", "d"]));
  });

  it("keeps every pin even past the cap", () => {
    const pinned = [user("u", "", [upload("x", true), upload("y", true), upload("z")])];
    expect(selectImages(pinned, 1)).toEqual(new Set(["x", "y"]));
    expect(pinsExceedCap(pinned, 1)).toBe(true);
    expect(pinsExceedCap(pinned, 2)).toBe(false);
  });

  it("counts a reused image once", () => {
    const reused = [
      user("u", "", [upload("old")]),
      tool("t1", "c1", [sheet("s")]),
      tool("t2", "c2", [sheet("s")]),
    ];
    expect(selectImages(reused, 2)).toEqual(new Set(["s", "old"]));
  });
});

describe("selectImages overview", () => {
  const looks = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => sheet(`${prefix}${index}`));
  const history: ChatMessage[] = [
    user("u0", "", [overviewSheet("old-o1")]),
    user("u1", "watch", [overviewSheet("o1"), overviewSheet("o2"), overviewSheet("o3")]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", looks("l", 6)),
  ];

  it("keeps the latest overview in up to half the free slots before the newest images", () => {
    expect(selectImages(history, 4, "send")).toEqual(new Set(["o1", "o2", "l5", "l4"]));
    expect(selectImages(history, 10, "send")).toEqual(
      new Set(["o1", "o2", "o3", "l0", "l1", "l2", "l3", "l4", "l5", "old-o1"]),
    );
  });

  it("counts the free slots after pins", () => {
    const pinned = [user("p", "", [upload("pin", true)]), ...history];
    expect(selectImages(pinned, 5)).toEqual(new Set(["pin", "o1", "o2", "l5", "l4"]));
  });

  it("changes nothing when only one image fits", () => {
    expect(selectImages(history, 1)).toEqual(new Set(["l5"]));
  });

  it("leaves an overview from before the newest user message behind when describing", () => {
    expect(selectImages(history, 10)).toEqual(
      new Set(["o1", "o2", "o3", "l0", "l1", "l2", "l3", "l4", "l5"]),
    );
  });
});

describe("selectImages across Keep going", () => {
  const investigation: ChatMessage[] = [
    user("u0", "before", [upload("older")]),
    user("u1", "watch", [overviewSheet("ov")]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", [sheet("look")]),
    assistant("a2", "Partly seen."),
    { ...user("k1", "Keep going."), continuation: true },
    assistant("a3", "", ["c2"]),
    tool("t2", "c2", [sheet("more")]),
  ];

  it("keeps the investigation a continuation carries on as the current turn", () => {
    expect(currentTurn(investigation).map((message) => message.id)[0]).toBe("u1");
    expect(selectImages(investigation, 10)).toEqual(new Set(["ov", "look", "more"]));
  });

  it("sends the continued investigation's images and stubs only what came before it", () => {
    const ids = ["older", "ov", "look", "more"];
    const dataUrls = new Map(ids.map((id) => [id, `data:${id}`]));
    const kept = keptImages(baseChat, investigation, 10);
    const sent = JSON.stringify(buildRequest(input({ messages: investigation, kept, dataUrls })));
    expect(sent).toContain("data:ov");
    expect(sent).toContain("data:look");
    expect(sent).not.toContain("data:older");
  });
});

describe("selectImages describing earlier images", () => {
  const history: ChatMessage[] = [
    user("u1", "first", [upload("a"), upload("pin", true)]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", [sheet("old")]),
    assistant("a2", "Seen."),
    user("u2", "again", [upload("new")]),
    assistant("a3", "", ["c2"]),
    tool("t2", "c2", [sheet("turn")]),
  ];

  it("keeps pins, the newest user message's images and this turn's images only", () => {
    expect(selectImages(history, 10)).toEqual(new Set(["pin", "new", "turn"]));
    expect(selectImages(history, 10, "send")).toEqual(new Set(["pin", "a", "old", "new", "turn"]));
  });

  it("still caps the current turn at the image limit, newest first", () => {
    expect(selectImages(history, 2)).toEqual(new Set(["pin", "turn"]));
  });

  it("starts the current turn at the newest user message", () => {
    expect(currentTurn(history).map((message) => message.id)).toEqual(["u2", "a3", "t2"]);
    expect(currentTurn([])).toEqual([]);
  });

  it("follows the chat's setting, describing by default", () => {
    expect(keptImages(baseChat, history, 10)).toEqual(new Set(["pin", "new", "turn"]));
    const sending = {
      ...baseChat,
      settings: { ...baseChat.settings, earlierImages: "send" as const },
    };
    expect(keptImages(sending, history, 10)).toEqual(new Set(["pin", "a", "old", "new", "turn"]));
  });

  it("stubs earlier images with a recall hint and sends the current turn's", () => {
    const ids = ["pin", "a", "old", "new", "turn"];
    const dataUrls = new Map(ids.map((id) => [id, `data:${id}`]));
    const request = buildRequest(
      input({ messages: history, kept: keptImages(baseChat, history, 10), dataUrls }),
    );
    const sent = JSON.stringify(request.messages);
    expect(sent).toContain(JSON.stringify(imageStub(upload("a"), "earlier")));
    expect(sent).toContain(JSON.stringify(imageStub(sheet("old"), "earlier")));
    expect(sent).toContain("data:pin");
    expect(sent).toContain("data:new");
    expect(sent).toContain("data:turn");
    expect(sent).not.toContain("data:old");
  });
});

describe("imageLabel and imageStub", () => {
  it("labels and stubs a sheet", () => {
    const ref = sheet("0002");
    expect(imageLabel(ref)).toBe("grid_0002 from look(60, 90): 1:00 to 1:30, 16 frames");
    expect(imageStub(ref)).toBe(
      '[grid_0002 from look(60, 90): 1:00 to 1:30, 16 frames. Not attached, to stay within the image limit; call recall("grid_0002 from look(60, 90)") to see it again.]',
    );
    expect(imageStub(ref, "earlier")).toBe(
      '[grid_0002 from look(60, 90): 1:00 to 1:30, 16 frames. Sent earlier; call recall("grid_0002 from look(60, 90)") to see it again.]',
    );
  });

  it("recalls a sheet by its name and call, and an upload by its file name", () => {
    expect(recallName(sheet("0002"))).toBe("grid_0002 from look(60, 90)");
    expect(recallName(upload("beach"))).toBe("beach.jpg");
  });

  it("labels a single-frame sheet with one time", () => {
    const ref: ImageRef = {
      id: "f",
      pinned: false,
      source: {
        kind: "sheet",
        call: "frames(1:42)",
        name: "grid_0002",
        startSeconds: 102,
        endSeconds: 102,
        frameCount: 1,
      },
    };
    expect(imageStub(ref)).toBe(
      '[grid_0002 from frames(1:42): 1:42, 1 frame. Not attached, to stay within the image limit; call recall("grid_0002 from frames(1:42)") to see it again.]',
    );
  });

  it("points an overview stub at recall", () => {
    expect(imageStub(overviewSheet("grid_0001"), "earlier")).toContain(
      'Sent earlier; call recall("grid_0001 from overview") to see it again.]',
    );
  });

  it("labels and stubs an upload", () => {
    expect(imageLabel(upload("beach"))).toBe("image beach.jpg");
    const stub = '[image beach.jpg, sent earlier; call recall("beach.jpg") to see it again]';
    expect(imageStub(upload("beach"))).toBe(stub);
    expect(imageStub(upload("beach"), "earlier")).toBe(stub);
  });
});

describe("buildSystemPrompt", () => {
  it("is only the chat's prompt without a video", () => {
    expect(buildSystemPrompt(baseChat, "Use look.")).toBe("Be brief.");
  });

  it("adds tool guidance, the analyst answer style and video facts, but no scene log", () => {
    expect(buildSystemPrompt(videoChat, "Use look.")).toBe(
      [
        "Be brief.",
        "Use look.\nIf you write to the user before looking, keep it to one short line and claim nothing you have not seen yet.",
        answerStyle("analyst", "free"),
        "Attached video: beach.mp4, 2:05 long, 1920x1080.",
      ].join("\n\n"),
    );
  });

  it("leaves out the before looking line when there are no tools", () => {
    expect(buildSystemPrompt(videoChat, "")).not.toContain("before looking");
  });

  it("swaps the answer style for the chat's voice and keeps the tool guidance", () => {
    const voiced = (voice: "character" | "narrator") =>
      buildSystemPrompt({ ...videoChat, settings: { ...videoChat.settings, voice } }, "Use look.");
    const character = voiced("character");
    expect(character).toContain("Use look.");
    expect(character).toContain(answerStyle("character"));
    expect(character).not.toContain("Cite moments as [m:ss]");
    expect(voiced("narrator")).toContain(answerStyle("narrator"));
    expect(answerStyle("character")).toMatch(
      /never mention tools, sheets, frames, grids or rounds/i,
    );
    expect(answerStyle("narrator")).toContain("third-person");
    expect(answerStyle()).toBe(answerStyle("analyst"));
  });

  it("fills in persona names", () => {
    const settings = {
      ...baseChat.settings,
      systemPrompt: "You are {{char}}, talking to {{USER}}. {{Char}} is curious.",
      characterName: "Mira",
      userName: "Sam",
    };
    expect(buildSystemPrompt({ ...baseChat, settings }, "Use look.")).toBe(
      "You are Mira, talking to Sam. Mira is curious.",
    );
  });
});

describe("video references", () => {
  it("defaults video references to the voice, so older chats keep their meaning", () => {
    expect(effectiveVideoReferences({})).toBe("free");
    expect(effectiveVideoReferences({ voice: "analyst" })).toBe("free");
    expect(effectiveVideoReferences({ voice: "character" })).toBe("few");
    expect(effectiveVideoReferences({ voice: "narrator" })).toBe("few");
    expect(effectiveVideoReferences({ voice: "character", videoReferences: "free" })).toBe("free");
    expect(answerStyle("analyst")).toContain("Cite moments as [m:ss]");
    expect(answerStyle("character")).toContain("at most a few [m:ss] timestamps");
    expect(answerStyle("character")).toContain("Never mention the video as a recording");
    expect(answerStyle("narrator")).toContain("at most a few [m:ss] timestamps");
    expect(answerStyle("narrator")).not.toContain("recording");
  });

  it("combines the voice with the chosen video references", () => {
    const style = (videoReferences: "free" | "few" | "none") =>
      buildSystemPrompt(
        { ...videoChat, settings: { ...videoChat.settings, voice: "character", videoReferences } },
        "Use look.",
      );
    expect(style("free")).toContain(answerStyle("character", "free"));
    expect(answerStyle("character", "free")).toContain("Cite moments as [m:ss]");
    expect(answerStyle("character", "free")).not.toContain("recording");
    expect(answerStyle("character", "free")).toMatch(/never mention tools/i);
    expect(style("none")).toContain(answerStyle("character", "none"));
    expect(answerStyle("character", "none")).toContain("Write no timestamps.");
    expect(answerStyle("analyst", "none")).toContain("Never mention the video as a recording");
    expect(answerStyle("narrator", "none")).toContain("Never mention the video as a recording");
    expect(answerStyle("analyst", "few")).not.toContain("recording");
  });
});

describe("applyPersonaNames", () => {
  it("leaves placeholders alone when no name is set", () => {
    const prompt = "{{char}} meets {{user}}.";
    expect(applyPersonaNames(prompt, {})).toBe(prompt);
    expect(applyPersonaNames(prompt, { characterName: "  " })).toBe(prompt);
    expect(applyPersonaNames(prompt, { userName: "Sam" })).toBe("{{char}} meets Sam.");
  });

  it("inserts names literally", () => {
    expect(applyPersonaNames("{{char}}", { characterName: "$& $1" })).toBe("$& $1");
  });
});

const NOT_YET = { text: "not analysed yet", canListen: true };

describe("audio note", () => {
  it("adds the audio note only when audio is on, before thoroughness guidance", () => {
    const note = audioNote({
      text: "analysed 0:00 to 12:30 (speech and sounds)",
      canListen: true,
    });
    expect(note.split("\n")).toEqual([
      "Audio: analysed 0:00 to 12:30 (speech and sounds). Call listen(start, end) to read what is heard.",
      AUDIO_GUIDANCE,
    ]);
    expect(buildContext(baseChat, { audioCoverage: NOT_YET, thoroughness: "exhaustive" })).toBe(
      [audioNote(NOT_YET), EXHAUSTIVE_GUIDANCE].join("\n\n"),
    );
    expect(buildContext(baseChat, {})).not.toContain("Audio:");
    expect(AUDIO_GUIDANCE).toContain("on the user's machine");
    expect(AUDIO_GUIDANCE).toContain("score");
    expect(AUDIO_GUIDANCE).toContain("loudness relative to the surrounding few minutes of audio");
  });

  it("offers no listen call or guidance for a video with no audio track", () => {
    const note = audioNote({ text: "the video has no audio track", canListen: false });
    expect(note).toBe("Audio: the video has no audio track.");
  });
});

describe("buildContext", () => {
  const timeline: VideoTimeline = {
    fileKey: "k",
    modelId: "venice-model",
    entries: [
      { startSeconds: 60, endSeconds: 125, text: "a wave hits the dog" },
      { startSeconds: 0, endSeconds: 60, text: "a dog runs along the beach" },
    ],
    nextWindow: 2,
    windowCount: 2,
    updatedAt: 0,
  };

  it("is empty with nothing volatile to say", () => {
    expect(buildContext(baseChat, {})).toBe("");
  });

  it("holds the story, the timeline in order, the sorted scene log and deep guidance", () => {
    expect(
      buildContext(videoChat, { timeline, thoroughness: "exhaustive", story: "A dog came." }),
    ).toBe(
      [
        "Chat summary: A dog came.",
        "Video timeline (from a study pass):\n[0:00 to 1:00] a dog runs along the beach\n[1:00 to 2:05] a wave hits the dog",
        "Scene log:\n[0:12] dog runs\n[1:30] wave hits",
        EXHAUSTIVE_GUIDANCE,
      ].join("\n\n"),
    );
    expect(buildContext(videoChat, {})).not.toContain(EXHAUSTIVE_GUIDANCE);
  });

  it("says how far a partial timeline reaches", () => {
    const partial = { ...timeline, entries: timeline.entries.slice(1), nextWindow: 1 };
    expect(buildContext(baseChat, { timeline: partial })).toContain(
      "Video timeline (from a study pass):\n[0:00 to 1:00] a dog runs along the beach\nThe study stopped early, so this only covers up to 1:00.",
    );
  });

  it("leaves out an empty timeline", () => {
    const empty = { ...timeline, entries: [], nextWindow: 0 };
    expect(buildContext(baseChat, { timeline: empty })).toBe("");
  });

  const cast: VideoCast = {
    fileKey: "k",
    cards: [
      { id: "c1", name: "Mara ", description: "red coat", firstSeenSeconds: 72 },
      { id: "c2", name: "Rex", description: " " },
    ],
    updatedAt: 0,
  };

  it("lists the cast after the story, with first-seen times and no images", () => {
    expect(buildContext(videoChat, { cast, timeline, story: "A dog came." })).toBe(
      [
        "Chat summary: A dog came.",
        "Cast:\n- Mara: red coat (first seen [1:12])\n- Rex",
        "Video timeline (from a study pass):\n[0:00 to 1:00] a dog runs along the beach\n[1:00 to 2:05] a wave hits the dog",
        "Scene log:\n[0:12] dog runs\n[1:30] wave hits",
      ].join("\n\n"),
    );
  });

  it("leaves out an empty cast", () => {
    expect(buildContext(baseChat, { cast: { ...cast, cards: [] } })).toBe("");
  });
});

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

describe("buildContext thoroughness", () => {
  it("guides each tier differently and a normal reply not at all", () => {
    const thorough = buildContext(baseChat, { thoroughness: "thorough" });
    expect(thorough).toBe(THOROUGH_GUIDANCE);
    expect(thorough).toContain("unsure");
    expect(thorough).toContain("note");
    expect(thorough.startsWith("Thorough:")).toBe(true);
    expect(EXHAUSTIVE_GUIDANCE.startsWith("Exhaustive:")).toBe(true);
    expect(EXHAUSTIVE_GUIDANCE).toContain("stubs you can recall");
    expect(buildContext(baseChat, { thoroughness: "normal" })).toBe("");
  });
});

describe("buildContext unclear moments", () => {
  it("lists unzoomed unclear moments in order and asks the model to look there", () => {
    const flagged: VideoTimeline = {
      fileKey: "k",
      modelId: "venice-model",
      entries: [
        { startSeconds: 60, endSeconds: 125, text: "a wave hits the dog" },
        { startSeconds: 0, endSeconds: 60, text: "a dog runs along the beach" },
      ],
      nextWindow: 2,
      windowCount: 2,
      updatedAt: 0,
      unclear: [
        { startSeconds: 102, endSeconds: 107, reason: "a sign too small to read" },
        { startSeconds: 30, endSeconds: 32, reason: "already zoomed", zoomed: true },
      ],
    };
    expect(buildContext(baseChat, { timeline: flagged })).toBe(
      [
        "Video timeline (from a study pass):",
        "[0:00 to 1:00] a dog runs along the beach",
        "[1:00 to 2:05] a wave hits the dog",
        "[1:42.0 to 1:47.0] unclear: a sign too small to read",
        "Look at the moments marked unclear yourself before describing them.",
      ].join("\n"),
    );
  });
});

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

const storyHistory = [
  user("u1", "first", [upload("a")]),
  assistant("a1", "", ["c1"]),
  tool("t1", "c1", [sheet("s1")]),
  assistant("a2", "Seen."),
  user("u2", "next", [upload("b")]),
];

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

describe("storyForBranch", () => {
  const timed = storyHistory.map((message, index) => ({ ...message, createdAt: index + 1 }));
  const story = { text: "A dog ran.", throughMessageId: "t1", throughCreatedAt: 3, updatedAt: 0 };

  it("keeps the story when the branch copies its last message", () => {
    expect(storyForBranch(story, timed.slice(0, 3))).toBe(story);
  });

  it("keeps the story when its last message is gone but the branch reaches past it", () => {
    const copied = timed.filter((message) => message.id !== "t1").slice(0, 3);
    expect(storyForBranch(story, copied)).toBe(story);
  });

  it("drops the story when the branch ends before its last message", () => {
    expect(storyForBranch(story, timed.slice(0, 2))).toBeUndefined();
    const older = { text: "A dog ran.", throughMessageId: "t1", updatedAt: 0 };
    expect(storyForBranch(older, timed.slice(0, 2))).toBeUndefined();
    expect(storyForBranch(undefined, timed)).toBeUndefined();
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
  it("includes tools only when allowed, supported and present", () => {
    expect(buildRequest(input({})).tools).toEqual([lookTool]);
    expect(buildRequest(input({ allowTools: false }))).not.toHaveProperty("tools");
    expect(buildRequest(input({ model: { ...model, tools: false } }))).not.toHaveProperty("tools");
    expect(buildRequest(input({ tools: [] }))).not.toHaveProperty("tools");
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

describe("estimateRequestTokens", () => {
  const request: ChatRequest = {
    model: "m",
    stream: true,
    messages: [
      { role: "system", content: "a".repeat(40) },
      {
        role: "user",
        content: [
          { type: "text", text: "b".repeat(20) },
          { type: "image_url", image_url: { url: "data:x".repeat(1000) } },
          { type: "image_url", image_url: { url: "data:y" } },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "look", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "c".repeat(10) },
    ],
  };

  it("counts text at four characters a token and each image at the model's cost", () => {
    expect(estimateRequestTokens(request, 1024, (side) => side / 2)).toBe(19 + 2 * 512);
  });

  it("falls back to 1500 tokens an image when the cost is unknown", () => {
    expect(estimateRequestTokens(request, 1024)).toBe(19 + 2 * 1500);
  });

  it("counts the tool schemas", () => {
    const withTools = { ...request, tools: [lookTool] };
    const schemaChars = JSON.stringify([lookTool]).length;
    expect(estimateRequestTokens(withTools, 1024)).toBe(
      Math.ceil((76 + schemaChars) / 4) + 2 * 1500,
    );
  });
});
