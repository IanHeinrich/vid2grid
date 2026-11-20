import { describe, expect, it } from "vitest";
import {
  DEEP_MAX_ROUNDS,
  DEFAULT_MAX_ROUNDS,
  LOOP_SENTENCE_REPEATS,
  LOOP_WINDOW_SENTENCES,
  REASONING_LIMIT_CHARS,
  reasoningLimit,
  reasoningLoopWatch,
  runTurn,
  stripToolMarkup,
  type TurnDeps,
  type TurnEvent,
} from "../src/chat/agentLoop";
import {
  ANSWER_NOW_NOTE,
  audioNote,
  estimateRequestTokens,
  EXHAUSTIVE_GUIDANCE,
  FINAL_ROUND_NOTE,
} from "../src/chat/history";
import type {
  Chat,
  ChatMessage,
  ChatRequest,
  ImageRef,
  ImageStore,
  ModelInfo,
  RunTool,
  StreamChat,
  StreamEvent,
  ToolCall,
  ToolResult,
  ToolSchema,
  VideoTimeline,
} from "../src/types";

type Round = (signal: AbortSignal, controller: AbortController) => AsyncGenerator<StreamEvent>;

const chat: Chat = {
  id: "chat",
  title: "Chat",
  createdAt: 0,
  updatedAt: 0,
  settings: { systemPrompt: "Be brief.", modelId: "model", sheetResolution: 1024 },
  video: { name: "beach.mp4", fileKey: "k", durationSeconds: 120, width: 640, height: 360 },
  sceneLog: [],
};

const model: ModelInfo = {
  id: "model",
  name: "Model",
  vision: true,
  tools: true,
  reasoning: true,
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
  function: { name: "look", description: "Look", parameters: {} },
};

const lookCall: ToolCall = { id: "call-1", name: "look", arguments: '{"start":60,"end":90}' };

const sheet: ImageRef = {
  id: "sheet-1",
  pinned: false,
  source: {
    kind: "sheet",
    call: "look(60, 90)",
    name: "grid_0001",
    startSeconds: 60,
    endSeconds: 90,
    frameCount: 16,
  },
};

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function events(...script: StreamEvent[]): Round {
  return async function* () {
    await Promise.resolve();
    yield* script;
  };
}

function setup(rounds: Round[], overrides: Partial<TurnDeps> = {}) {
  const controller = new AbortController();
  const requests: ChatRequest[] = [];
  const persisted: ChatMessage[] = [];
  const emitted: TurnEvent[] = [];
  const store: ImageStore = {
    putImage: () => Promise.resolve("unused"),
    getImage: () => Promise.resolve(new Blob(["x"], { type: "image/jpeg" })),
  };
  const streamChat: StreamChat = (_api, request, signal) => {
    requests.push(request);
    const round = rounds[requests.length - 1];
    if (round === undefined) throw new Error("No scripted round left");
    return round(signal, controller);
  };
  let nextId = 0;
  const deps: TurnDeps = {
    chat,
    messages: [{ id: "u1", createdAt: 0, role: "user", text: "What happens?", images: [] }],
    model,
    api: { baseUrl: "https://example.test", apiKey: "test" },
    streamChat,
    runTool: undefined,
    store,
    tools: [lookTool],
    toolGuidance: "Use look.",
    veniceParameters: true,
    signal: controller.signal,
    resolution: 1024,
    persist: (message) => {
      persisted.push(message);
      return Promise.resolve();
    },
    onEvent: (event) => emitted.push(event),
    now: () => 100,
    newId: () => `m${++nextId}`,
    ...overrides,
  };
  return { deps, controller, requests, persisted, emitted };
}

function sheetNamed(id: string): ImageRef {
  return { ...sheet, id, source: { ...sheet.source, name: id } };
}

function attachedNames(request: ChatRequest | undefined): string[] {
  const parts = (request?.messages ?? []).flatMap((m) =>
    m.role === "user" && Array.isArray(m.content) ? m.content : [],
  );
  return parts.flatMap((part, index) => {
    const label = parts[index - 1];
    if (part.type !== "image_url" || label?.type !== "text") return [];
    return [label.text.split(" ")[0] ?? ""];
  });
}

const SUFFIX_1_OF_8 = " (Round 1 of 8. Batch several calls into one round when you can.)";
const FINAL_NOTE = FINAL_ROUND_NOTE;

function contextOf(request: ChatRequest | undefined): string | undefined {
  const found = request?.messages.find(
    (m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      m.content.startsWith("Context for this reply"),
  );
  return typeof found?.content === "string" ? found.content : undefined;
}

function lookRunner(result: ToolResult = { text: "Sheet grid_0001.", images: [sheet] }): RunTool {
  return () => Promise.resolve(result);
}

describe("runTurn answers", () => {
  it("streams a plain answer and persists it", async () => {
    const { deps, requests, persisted, emitted } = setup([
      events(
        { type: "reasoning", delta: "Think." },
        { type: "text", delta: "A dog " },
        { type: "text", delta: "runs." },
        { type: "done", finishReason: "stop" },
      ),
    ]);
    expect(await runTurn(deps)).toEqual({ status: "done" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("tools");
    expect(persisted).toEqual([
      {
        id: "m1",
        createdAt: 100,
        role: "assistant",
        text: "A dog runs.",
        reasoning: "Think.",
        toolCalls: [],
        receipt: { rounds: 1, imagesSent: 0, durationMs: 0, unseenCitations: [] },
      },
    ]);
    expect(emitted.map((event) => event.type)).toEqual([
      "assistantStart",
      "requestStart",
      "assistantDelta",
      "assistantDelta",
      "assistantDelta",
      "assistantDone",
    ]);
  });
});

describe("runTurn round limit", () => {
  it("forbids tools on the last allowed round and flags the forced answer", async () => {
    const { deps, requests, persisted } = setup(
      [
        events({ type: "toolCalls", calls: [lookCall] }),
        events({ type: "text", delta: "Final answer." }),
      ],
      { runTool: lookRunner(), maxRounds: 2 },
    );
    expect(await runTurn(deps)).toEqual({ status: "done", hitRoundLimit: true });
    expect(requests[0]).not.toHaveProperty("tool_choice");
    expect(requests[0]?.messages.at(-1)).toEqual({ role: "user", content: "What happens?" });
    expect(requests[1]).toMatchObject({ tools: [lookTool], tool_choice: "none" });
    expect(requests[1]?.messages.at(-1)).toEqual({ role: "user", content: FINAL_NOTE });
    expect(persisted.at(-1)).toMatchObject({ text: "Final answer.", stoppedAtRoundLimit: true });
    expect(JSON.stringify(persisted)).not.toContain(FINAL_NOTE);
  });

  it("leaves tool calls on the final round unrun", async () => {
    const { deps, requests, persisted } = setup(
      [
        events({ type: "toolCalls", calls: [lookCall] }),
        events({ type: "text", delta: "Partly seen." }, { type: "toolCalls", calls: [lookCall] }),
      ],
      { runTool: lookRunner(), maxRounds: 2 },
    );
    expect(await runTurn(deps)).toEqual({ status: "done", hitRoundLimit: true });
    expect(requests).toHaveLength(2);
    expect(persisted.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(persisted.at(-1)).toMatchObject({ toolCalls: [], stoppedAtRoundLimit: true });
  });

  it("does not flag an answer given before the limit", async () => {
    const { deps, persisted } = setup(
      [events({ type: "toolCalls", calls: [lookCall] }), events({ type: "text", delta: "Done." })],
      { runTool: lookRunner(), maxRounds: 3 },
    );
    expect(await runTurn(deps)).toEqual({ status: "done" });
    expect(persisted.at(-1)).not.toHaveProperty("stoppedAtRoundLimit");
  });

  it("does not flag a one-round turn that answered straight away", async () => {
    const { deps, requests, persisted } = setup([events({ type: "text", delta: "Hi." })], {
      runTool: lookRunner(),
      maxRounds: 1,
    });
    expect(await runTurn(deps)).toEqual({ status: "done" });
    expect(requests[0]?.messages.at(-1)).toEqual({ role: "user", content: FINAL_NOTE });
    expect(persisted[0]).not.toHaveProperty("stoppedAtRoundLimit");
  });
});

describe("runTurn round budgets", () => {
  it("uses eight rounds by default and thirty for a deep dive", async () => {
    expect(DEFAULT_MAX_ROUNDS).toBe(8);
    expect(DEEP_MAX_ROUNDS).toBe(30);
    const looping = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        events({ type: "toolCalls", calls: [{ ...lookCall, id: `c${index}` }] }),
      );
    const normal = setup(looping(DEFAULT_MAX_ROUNDS), { runTool: lookRunner() });
    expect(await runTurn(normal.deps)).toMatchObject({ hitRoundLimit: true });
    expect(normal.requests).toHaveLength(DEFAULT_MAX_ROUNDS);
    const deep = setup(looping(DEEP_MAX_ROUNDS), {
      runTool: lookRunner(),
      thoroughness: "exhaustive",
    });
    expect(await runTurn(deep.deps)).toMatchObject({ hitRoundLimit: true });
    expect(deep.requests).toHaveLength(DEEP_MAX_ROUNDS);
    const toolTexts = deep.persisted.flatMap((m) => (m.role === "tool" ? [m.text] : []));
    expect(toolTexts[0]).toBe(
      "Sheet grid_0001. (Round 1 of 30. Batch several calls into one round when you can.)",
    );
    expect(toolTexts.at(-1)).toContain("(Round 29 of 30.");
  });
});

describe("runTurn deep dives and timelines", () => {
  const timeline: VideoTimeline = {
    fileKey: "k",
    modelId: "model",
    entries: [{ startSeconds: 0, endSeconds: 60, text: "a dog runs" }],
    nextWindow: 1,
    windowCount: 1,
    updatedAt: 0,
  };

  it("sends deep guidance and the timeline as context, not in the system prompt", async () => {
    const { deps, requests } = setup([events({ type: "text", delta: "Seen." })], {
      thoroughness: "exhaustive",
      timeline,
    });
    await runTurn(deps);
    const context = contextOf(requests[0]);
    expect(context).toContain(EXHAUSTIVE_GUIDANCE);
    expect(context).toContain("Video timeline (from a study pass):\n[0:00 to 1:00] a dog runs");
    expect(requests[0]?.messages[0]?.content).not.toContain(EXHAUSTIVE_GUIDANCE);
  });

  const HEARD_MINUTE = { text: "analysed 0:00 to 1:00 (speech and sounds)", canListen: true };

  it("sends the audio note as context when audio is on", async () => {
    const { deps, requests } = setup([events({ type: "text", delta: "Heard." })], {
      audioCoverage: HEARD_MINUTE,
    });
    await runTurn(deps);
    expect(contextOf(requests[0])).toContain(audioNote(HEARD_MINUTE));
    expect(requests[0]?.messages[0]?.content).not.toContain("Audio:");
  });

  it("leaves both out of a normal turn", async () => {
    const { deps, requests } = setup([events({ type: "text", delta: "Seen." })]);
    await runTurn(deps);
    expect(contextOf(requests[0])).toBeUndefined();
  });
});

describe("stripToolMarkup", () => {
  it("strips DeepSeek DSML calls, fullwidth or ASCII bars, with or without a closing tag", () => {
    const leaked =
      'Let me check.\n\n<｜DSML｜calls> <｜DSML｜invoke name="look"> <｜DSML｜parameter name="start">60</｜DSML｜parameter> </｜DSML｜invoke> </｜DSML｜calls>';
    expect(stripToolMarkup(leaked)).toEqual({ text: "Let me check.", stripped: true });
    const ascii = 'Before.\n<|DSML|function_calls>\n<|DSML|invoke name="frame">';
    expect(stripToolMarkup(ascii)).toEqual({ text: "Before.", stripped: true });
    expect(stripToolMarkup("A < ｜ DSML ｜ calls >x</ ｜ DSML ｜ calls > B").text).toBe("A  B");
  });

  it("strips stray DSML tags", () => {
    expect(stripToolMarkup("Answer.</｜DSML｜invoke><｜DSML｜parameter>")).toEqual({
      text: "Answer.",
      stripped: true,
    });
  });

  it("strips DeepSeek native tool call tokens", () => {
    const leaked =
      "Two dogs.<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>look\n{}<｜tool▁call▁end｜><｜tool▁calls▁end｜>";
    expect(stripToolMarkup(leaked)).toEqual({ text: "Two dogs.", stripped: true });
    expect(stripToolMarkup("Ok.<｜tool▁sep｜>").text).toBe("Ok.");
  });

  it("strips tool_call and function_calls blocks", () => {
    expect(stripToolMarkup('<tool_call>{"name": "look"}</tool_call>Seen.').text).toBe("Seen.");
    expect(
      stripToolMarkup('Seen.<function_calls><invoke name="look"></invoke></function_calls>').text,
    ).toBe("Seen.");
    expect(stripToolMarkup('Seen.\n<tool_call>{"name": "look"').text).toBe("Seen.");
  });

  it("strips <|tool_call|>-style tags and blocks", () => {
    expect(stripToolMarkup('Seen.<|tool_call|>[{"name": "look"}]<|/tool_call|>').text).toBe(
      "Seen.",
    );
    expect(stripToolMarkup("Seen.<|tool_call_begin|>look:0<|tool_call_end|>").text).toBe("Seen.");
    expect(stripToolMarkup("<|tool_calls_section_begin|>Seen.").text).toBe("Seen.");
  });

  it("keeps the text around markup in the middle", () => {
    const leaked =
      'First part.\n\n<｜DSML｜calls><｜DSML｜invoke name="look"></｜DSML｜invoke></｜DSML｜calls>\n\nSecond part.';
    expect(stripToolMarkup(leaked)).toEqual({
      text: "First part.\n\nSecond part.",
      stripped: true,
    });
  });

  it("leaves ordinary text, including its whitespace, untouched", () => {
    const text = "  A | B <b>bold</b> and x < y > z.\n\n\n";
    expect(stripToolMarkup(text)).toEqual({ text, stripped: false });
  });
});

describe("runTurn leaked tool markup", () => {
  it("persists the stripped answer and offers Keep going", async () => {
    const { deps, persisted, emitted } = setup([
      events({
        type: "text",
        delta: 'Checking.<｜DSML｜calls><｜DSML｜invoke name="look">',
      }),
    ]);
    expect(await runTurn(deps)).toEqual({ status: "done", strippedToolMarkup: true });
    expect(persisted).toEqual([
      expect.objectContaining({ text: "Checking.", stoppedAtRoundLimit: true }),
    ]);
    expect(emitted.at(-1)).toEqual({ type: "assistantDone", message: persisted[0] });
  });

  it("strips markup on the forced final round and reports both reasons", async () => {
    const { deps, persisted } = setup(
      [
        events({ type: "toolCalls", calls: [lookCall] }),
        events({ type: "text", delta: "So far a dog.\n<tool_call>{}</tool_call>" }),
      ],
      { runTool: lookRunner(), maxRounds: 2 },
    );
    expect(await runTurn(deps)).toEqual({
      status: "done",
      hitRoundLimit: true,
      strippedToolMarkup: true,
    });
    expect(persisted.at(-1)).toMatchObject({ text: "So far a dog.", stoppedAtRoundLimit: true });
  });
});

describe("runTurn requestStart", () => {
  it("reports each round's image count and token estimate before streaming", async () => {
    const { deps, requests, emitted } = setup(
      [
        events({ type: "toolCalls", calls: [lookCall] }),
        events({ type: "text", delta: "A wave." }),
      ],
      { runTool: lookRunner(), resolution: 2048, imageTokens: (px) => px / 2 },
    );
    await runTurn(deps);
    const [first, second] = requests;
    if (!first || !second) throw new Error("Expected two requests");
    const starts = emitted.flatMap((e) => (e.type === "requestStart" ? [e] : []));
    expect(starts).toEqual([
      {
        type: "requestStart",
        round: 1,
        images: 0,
        estimatedTokens: estimateRequestTokens(first, 2048),
      },
      {
        type: "requestStart",
        round: 2,
        images: 1,
        estimatedTokens: estimateRequestTokens(second, 2048, (px) => px / 2),
      },
    ]);
    expect(starts[1]?.estimatedTokens).toBeGreaterThan(1024);
    const order = emitted.map((e) => e.type);
    expect(order.indexOf("requestStart")).toBe(order.indexOf("assistantStart") + 1);
  });
});

describe("runTurn token estimates", () => {
  it("prices each sheet at the side it was rendered at, else at the chat resolution", async () => {
    const overview: ImageRef = {
      id: "overview-1",
      pinned: false,
      source: {
        kind: "sheet",
        call: "overview",
        name: "overview_1",
        startSeconds: 0,
        endSeconds: 120,
        frameCount: 16,
        resolution: 512,
      },
    };
    const imageTokens = (px: number) => px;
    const { deps, requests, emitted } = setup([events({ type: "text", delta: "A wave." })], {
      messages: [
        { id: "u1", createdAt: 0, role: "user", text: "What happens?", images: [overview, sheet] },
      ],
      store: {
        putImage: () => Promise.resolve("unused"),
        getImage: (id) => Promise.resolve(new Blob([id], { type: "image/jpeg" })),
      },
      resolution: 2048,
      imageTokens,
    });
    await runTurn(deps);
    const [first] = requests;
    if (!first) throw new Error("Expected a request");
    const start = emitted.find((e) => e.type === "requestStart");
    const allAtChatResolution = estimateRequestTokens(first, 2048, imageTokens);
    expect(start).toMatchObject({ images: 2, estimatedTokens: allAtChatResolution - (2048 - 512) });
  });
});

describe("runTurn token usage", () => {
  const usage = { promptTokens: 1200, completionTokens: 40 };

  it("puts each round's usage on that round's assistant message", async () => {
    const { deps, persisted, emitted } = setup(
      [
        events({ type: "toolCalls", calls: [lookCall] }, { type: "usage", usage }),
        events(
          { type: "text", delta: "A wave." },
          { type: "usage", usage: { ...usage, promptTokens: 3000 } },
        ),
      ],
      { runTool: lookRunner() },
    );
    await runTurn(deps);
    const replies = persisted.filter((m) => m.role === "assistant");
    expect(replies.map((m) => m.usage?.promptTokens)).toEqual([1200, 3000]);
    const done = emitted.flatMap((e) => (e.type === "assistantDone" ? [e.message] : []));
    expect(done).toEqual(replies);
  });

  it("leaves usage off when the stream sends none", async () => {
    const { deps, persisted } = setup([events({ type: "text", delta: "Hi." })]);
    await runTurn(deps);
    expect(persisted[0]).not.toHaveProperty("usage");
  });
});

describe("runTurn guards and parsing", () => {
  it("moves text before a streamed </think> into reasoning", async () => {
    const { deps, persisted, emitted } = setup([
      events(
        { type: "text", delta: "Counting the dogs" },
        { type: "text", delta: ".</think>\n\nTwo " },
        { type: "text", delta: "dogs." },
      ),
    ]);
    await runTurn(deps);
    const deltas = emitted.flatMap((event) => (event.type === "assistantDelta" ? [event] : []));
    expect(deltas[0]?.message).toMatchObject({ text: "Counting the dogs" });
    expect(deltas[0]?.message).not.toHaveProperty("reasoning");
    expect(deltas[1]?.message).toMatchObject({ reasoning: "Counting the dogs.", text: "Two " });
    expect(persisted[0]).toMatchObject({ reasoning: "Counting the dogs.", text: "Two dogs." });
  });

  it("refuses a turn whose pins exceed the model's image limit", async () => {
    const pinned = [sheetNamed("p1"), sheetNamed("p2")].map((ref) => ({ ...ref, pinned: true }));
    const { deps, requests } = setup([], {
      model: { ...model, maxImages: 1 },
      messages: [{ id: "u1", createdAt: 0, role: "user", text: "Compare.", images: pinned }],
    });
    expect(await runTurn(deps)).toEqual({
      status: "error",
      error: "Pinned images exceed this model's limit of 1; unpin some.",
    });
    expect(requests).toHaveLength(0);
  });
});

describe("runTurn tool calls", () => {
  it("runs a tool call and sends its images in the next round", async () => {
    const { deps, requests, persisted, emitted } = setup(
      [
        events(
          { type: "toolCalls", calls: [lookCall] },
          { type: "done", finishReason: "tool_calls" },
        ),
        events({ type: "text", delta: "A wave hits." }),
      ],
      { runTool: lookRunner() },
    );
    expect(await runTurn(deps)).toEqual({ status: "done" });
    expect(requests[0]?.tools).toEqual([lookTool]);
    expect(persisted.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(persisted[1]).toMatchObject({ toolCallId: "call-1", images: [sheet] });
    expect(emitted.filter((event) => event.type.startsWith("tool"))).toEqual([
      { type: "toolStart", call: lookCall },
      { type: "toolDone", message: persisted[1] },
    ]);
    expect(persisted[1]).toMatchObject({ text: `Sheet grid_0001.${SUFFIX_1_OF_8}` });
    expect(requests[1]?.messages.slice(-2)).toEqual([
      { role: "tool", tool_call_id: "call-1", content: `Sheet grid_0001.${SUFFIX_1_OF_8}` },
      {
        role: "user",
        content: [
          { type: "text", text: "grid_0001 from look(60, 90): 1:00 to 1:30, 16 frames" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,eA==" } },
        ],
      },
    ]);
    expect(deps.messages).toHaveLength(1);
  });

  it("emits a scene note from a tool result", async () => {
    const note = { timeSeconds: 75, text: "wave hits" };
    const { deps, emitted } = setup(
      [events({ type: "toolCalls", calls: [lookCall] }), events({ type: "text", delta: "Noted." })],
      { runTool: lookRunner({ text: "Noted.", images: [], note }) },
    );
    await runTurn(deps);
    expect(emitted).toContainEqual({ type: "note", note });
  });
});

const listenCall: ToolCall = { id: "call-2", name: "listen", arguments: '{"start":0,"end":60}' };
const laterLook: ToolCall = { id: "call-3", name: "look", arguments: '{"start":90,"end":120}' };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferredRunner() {
  const started: string[] = [];
  const finish = new Map<string, (result: ToolResult) => void>();
  const runTool: RunTool = (call) => {
    started.push(call.id);
    return new Promise((resolve) => finish.set(call.id, resolve));
  };
  const resolve = (id: string) => finish.get(id)?.({ text: `${id} done.`, images: [] });
  return { started, runTool, resolve };
}

function toolEventOrder(emitted: readonly TurnEvent[]): string[] {
  return emitted.flatMap((event) => {
    if (event.type === "toolStart") return [`start ${event.call.id}`];
    if (event.type === "toolDone" && event.message.role === "tool") {
      return [`done ${event.message.toolCallId}`];
    }
    return [];
  });
}

describe("runTurn listen beside renders", () => {
  it("starts listen at once, runs renders one at a time and answers in call order", async () => {
    const runner = deferredRunner();
    const { deps, persisted, emitted } = setup(
      [
        events({ type: "toolCalls", calls: [lookCall, listenCall, laterLook] }),
        events({ type: "text", delta: "Done." }),
      ],
      { runTool: runner.runTool },
    );
    const outcome = runTurn(deps);
    await flush();
    expect(runner.started).toEqual(["call-2", "call-1"]);
    runner.resolve("call-2");
    await flush();
    expect(emitted.filter((event) => event.type === "toolDone")).toEqual([]);
    runner.resolve("call-1");
    await flush();
    expect(runner.started).toEqual(["call-2", "call-1", "call-3"]);
    runner.resolve("call-3");
    expect(await outcome).toEqual({ status: "done" });
    const tools = persisted.filter((message) => message.role === "tool");
    expect(tools.map((message) => message.toolCallId)).toEqual(["call-1", "call-2", "call-3"]);
    expect(toolEventOrder(emitted)).toEqual([
      "start call-2",
      "start call-1",
      "start call-3",
      "done call-1",
      "done call-2",
      "done call-3",
    ]);
  });

  it("discards results and starts no further render after a stop", async () => {
    const runner = deferredRunner();
    const { deps, controller, persisted } = setup(
      [events({ type: "toolCalls", calls: [lookCall, listenCall, laterLook] })],
      { runTool: runner.runTool },
    );
    const outcome = runTurn(deps);
    await flush();
    controller.abort();
    runner.resolve("call-2");
    runner.resolve("call-1");
    expect(await outcome).toEqual({ status: "stopped" });
    expect(runner.started).toEqual(["call-2", "call-1"]);
    expect(persisted.filter((message) => message.role === "tool")).toEqual([]);
  });
});

describe("runTurn notes mid-turn", () => {
  it("leaves a note recorded mid-turn out of the turn's later rounds", async () => {
    const note = { timeSeconds: 75, text: "wave hits" };
    const { deps, requests } = setup(
      [events({ type: "toolCalls", calls: [lookCall] }), events({ type: "text", delta: "Noted." })],
      { runTool: lookRunner({ text: "Noted.", images: [], note }) },
    );
    await runTurn(deps);
    expect(contextOf(requests[0])).toBeUndefined();
    expect(contextOf(requests[1])).toBeUndefined();
    expect(requests[1]?.messages[0]).toEqual(requests[0]?.messages[0]);
    expect(deps.chat.sceneLog).toEqual([]);
  });

  it("keeps the context block identical across rounds after a note", async () => {
    const note = { timeSeconds: 75, text: "wave hits" };
    const { deps, requests } = setup(
      [
        events({ type: "toolCalls", calls: [lookCall] }),
        events({ type: "toolCalls", calls: [{ ...lookCall, id: "call-2" }] }),
        events({ type: "text", delta: "Noted." }),
      ],
      {
        chat: { ...chat, sceneLog: [{ timeSeconds: 12, text: "dog runs" }] },
        runTool: lookRunner({ text: "Noted.", images: [], note }),
      },
    );
    await runTurn(deps);
    const first = contextOf(requests[0]);
    expect(first).toContain("Scene log:\n[0:12] dog runs");
    expect(contextOf(requests[1])).toBe(first);
    expect(contextOf(requests[2])).toBe(first);
  });
});

describe("runTurn across rounds", () => {
  it("evicts earlier rounds' images as later rounds add more", async () => {
    const results = [[sheetNamed("a")], [sheetNamed("b"), sheetNamed("c")]];
    const { deps, requests } = setup(
      [
        events({ type: "toolCalls", calls: [{ ...lookCall, id: "c1" }] }),
        events({ type: "toolCalls", calls: [{ ...lookCall, id: "c2" }] }),
        events({ type: "text", delta: "Seen." }),
      ],
      {
        model: { ...model, maxImages: 2 },
        runTool: () => Promise.resolve({ text: "ok", images: results.shift() ?? [] }),
      },
    );
    expect(await runTurn(deps)).toEqual({ status: "done" });
    expect(attachedNames(requests[1])).toEqual(["a"]);
    expect(attachedNames(requests[2])).toEqual(["b", "c"]);
    expect(JSON.stringify(requests[2]?.messages)).toContain("a from look(60, 90)");
  });

  it("answers tool calls with no video attached so history stays valid", async () => {
    const { deps, requests, persisted } = setup([
      events({ type: "toolCalls", calls: [lookCall] }),
      events({ type: "text", delta: "Please attach a video." }),
    ]);
    expect(await runTurn(deps)).toEqual({ status: "done" });
    expect(requests[0]).not.toHaveProperty("tools");
    expect(persisted[1]).toMatchObject({
      role: "tool",
      text: `No video is attached.${SUFFIX_1_OF_8}`,
    });
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: `No video is attached.${SUFFIX_1_OF_8}`,
    });
  });
});

describe("runTurn receipts", () => {
  it("puts rounds, images, duration and unseen citations on the final message only", async () => {
    let clock = 1000;
    const { deps, persisted } = setup(
      [
        events({ type: "toolCalls", calls: [lookCall] }),
        events({ type: "text", delta: "A wave at [1:15], a boat at [1:45] and [1:45]." }),
      ],
      { runTool: lookRunner(), now: () => (clock += 250) },
    );
    await runTurn(deps);
    const replies = persisted.flatMap((m) => (m.role === "assistant" ? [m] : []));
    expect(replies[0]).not.toHaveProperty("receipt");
    expect(replies[1]?.receipt).toEqual({
      rounds: 2,
      imagesSent: 1,
      durationMs: clock - 1250,
      unseenCitations: [105],
    });
  });

  it("puts a receipt on an answer forced at the round limit", async () => {
    const { deps, persisted } = setup(
      [events({ type: "toolCalls", calls: [lookCall] }), events({ type: "text", delta: "Done." })],
      { runTool: lookRunner(), maxRounds: 2 },
    );
    await runTurn(deps);
    expect(persisted.at(-1)).toMatchObject({ receipt: { rounds: 2, imagesSent: 1 } });
  });

  it("leaves the receipt off a stopped turn", async () => {
    const { deps, persisted } = setup([
      async function* (signal, controller) {
        await Promise.resolve();
        yield { type: "text", delta: "Half" };
        controller.abort();
        if (signal.aborted) throw abortError();
      },
    ]);
    await runTurn(deps);
    expect(persisted[0]).not.toHaveProperty("receipt");
  });
});

describe("runTurn story so far", () => {
  const pinned = [sheetNamed("p1"), sheetNamed("p2")].map((ref) => ({ ...ref, pinned: true }));
  const summarisedChat: Chat = {
    ...chat,
    storySoFar: { text: "Two dogs.", throughMessageId: "u0", updatedAt: 0 },
  };
  const history: ChatMessage[] = [
    { id: "u0", createdAt: 0, role: "user", text: "Compare.", images: pinned },
    { id: "u1", createdAt: 0, role: "user", text: "Now this.", images: [sheetNamed("n")] },
  ];

  it("still sends images pinned before the summary's cut, right after the system prompt", async () => {
    const { deps, requests } = setup([events({ type: "text", delta: "Seen." })], {
      chat: summarisedChat,
      model: { ...model, maxImages: 3 },
      messages: history,
    });
    expect(await runTurn(deps)).toEqual({ status: "done" });
    expect(attachedNames(requests[0])).toEqual(["p1", "p2", "n"]);
    expect(JSON.stringify(requests[0]?.messages[1])).toContain("p1 from look(60, 90)");
    expect(contextOf(requests[0])).toContain("Chat summary: Two dogs.");
  });

  it("counts pins from before the summary's cut against the image limit", async () => {
    const { deps, requests } = setup([events({ type: "text", delta: "Seen." })], {
      chat: summarisedChat,
      model: { ...model, maxImages: 1 },
      messages: history,
    });
    expect(await runTurn(deps)).toMatchObject({ status: "error" });
    expect(requests).toHaveLength(0);
  });
});

describe("runTurn stops and errors", () => {
  it("persists partial text and stops when aborted mid-stream", async () => {
    const { deps, persisted } = setup([
      async function* (signal, controller) {
        await Promise.resolve();
        yield { type: "text", delta: "Half an ans" };
        controller.abort();
        if (signal.aborted) throw abortError();
      },
    ]);
    expect(await runTurn(deps)).toEqual({ status: "stopped" });
    expect(persisted).toEqual([
      expect.objectContaining({ role: "assistant", text: "Half an ans" }),
    ]);
  });

  it("discards a tool result that lands after a stop", async () => {
    const { deps, controller, requests, persisted } = setup(
      [events({ type: "toolCalls", calls: [lookCall] })],
      {
        runTool: () => {
          controller.abort();
          return Promise.resolve({ text: "late", images: [sheet] });
        },
      },
    );
    expect(await runTurn(deps)).toEqual({ status: "stopped" });
    expect(persisted.map((message) => message.role)).toEqual(["assistant"]);
    expect(requests).toHaveLength(1);
  });

  it("returns an error outcome when streaming fails", async () => {
    const { deps } = setup([
      async function* () {
        await Promise.resolve();
        yield* [];
        throw new Error("401 Unauthorized");
      },
    ]);
    expect(await runTurn(deps)).toEqual({ status: "error", error: "401 Unauthorized" });
  });

  it("persists partial text before reporting a mid-stream error", async () => {
    const { deps, persisted, emitted } = setup([
      async function* () {
        await Promise.resolve();
        yield { type: "text", delta: "The dog" };
        throw new Error("connection reset");
      },
    ]);
    expect(await runTurn(deps)).toEqual({ status: "error", error: "connection reset" });
    expect(persisted).toEqual([expect.objectContaining({ role: "assistant", text: "The dog" })]);
    expect(emitted.at(-1)).toEqual({ type: "assistantDone", message: persisted[0] });
  });
});

const LOOPING_THOUGHT = "Maybe the dog is chasing the ball across the sand. ";

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(abortError());
    else signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

describe("reasoningLoopWatch", () => {
  it("trips once a long sentence comes back the fourth time, whatever its case and spacing", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    expect(looping("Maybe the dog is chasing the ball. Or not. ")).toBe(false);
    expect(looping("maybe  the dog is chasing the ball!\nOr not.")).toBe(false);
    expect(looping("MAYBE the dog is chasing the ball. ")).toBe(false);
    expect(looping(" Maybe the dog is chasing")).toBe(false);
    expect(looping(" the ball? ")).toBe(true);
    expect(LOOP_SENTENCE_REPEATS).toBe(4);
  });

  it("trips on two or three sentences cycling", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    const cycle =
      "So the ball must be under the bench. But the bench looks empty in this frame. Let me check the bench again. ";
    const trips = Array.from({ length: LOOP_SENTENCE_REPEATS }, () => looping(cycle));
    expect(trips).toEqual([false, false, false, true]);
  });

  it("lets filler repeat now and then across a long honest trace", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    const filler = "But wait, let me double-check that. ";
    const stretch = (from: number) =>
      Array.from({ length: LOOP_WINDOW_SENTENCES }, (_, index) => {
        const frame = from + index;
        return `Frame ${frame} shows the dog ${frame % 2 === 0 ? "near" : "away from"} the water. `;
      }).join("");
    const trace = [filler, stretch(1), filler, stretch(41), filler, stretch(81), filler];
    expect(trace.map(looping)).toEqual(trace.map(() => false));
  });

  it("does not trip on a per-frame checklist", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    const checklist = Array.from(
      { length: 30 },
      (_, index) => `- Frame at 0:${String(index).padStart(2, "0")}: check the dog and the ball.\n`,
    );
    expect(checklist.some(looping)).toBe(false);
  });

  it("splits sentences that arrive across many small deltas", () => {
    const looping = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    const text = "Maybe the dog is chasing the ball across the sand. ".repeat(4);
    const results = [...text].map(looping);
    expect(results.indexOf(true)).toBe(text.length - 2);
  });

  it("ignores short sentences repeating and trips past the size limit", () => {
    const short = reasoningLoopWatch(REASONING_LIMIT_CHARS);
    expect(["Hmm. ", "Hmm. ", "Hmm. ", "Hmm. "].some(short)).toBe(false);
    const long = reasoningLoopWatch(10);
    expect(long("0123456789")).toBe(false);
    expect(long("x")).toBe(true);
  });

  it("allows higher tiers more reasoning", () => {
    expect(reasoningLimit("normal")).toBe(REASONING_LIMIT_CHARS);
    expect(reasoningLimit("thorough")).toBeGreaterThan(reasoningLimit("normal"));
    expect(reasoningLimit("exhaustive")).toBeGreaterThan(reasoningLimit("thorough"));
  });
});

describe("runTurn reasoning loop guard", () => {
  const reasoner: ModelInfo = { ...model, reasoningEffortOptions: ["none", "low", "high"] };

  it("cuts a looping stream and retries once in answer-now mode", async () => {
    const { deps, requests, persisted, emitted } = setup(
      [
        events(
          { type: "reasoning", delta: LOOPING_THOUGHT.repeat(3) },
          { type: "reasoning", delta: LOOPING_THOUGHT },
          { type: "reasoning", delta: "never reached" },
        ),
        events({ type: "reasoning", delta: "Answering." }, { type: "text", delta: "A dog." }),
      ],
      { runTool: lookRunner(), model: reasoner, thoroughness: "exhaustive" },
    );
    expect(await runTurn(deps)).toEqual({ status: "done", answeredNow: "loop" });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ reasoning_effort: "high" });
    expect(requests[0]).not.toHaveProperty("tool_choice");
    expect(requests[1]).toMatchObject({
      tools: [lookTool],
      tool_choice: "none",
      reasoning_effort: "none",
    });
    expect(requests[1]?.messages.at(-1)).toEqual({ role: "user", content: ANSWER_NOW_NOTE });
    expect(requests[1]?.messages.slice(0, -1)).toEqual(requests[0]?.messages);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      id: "m1",
      text: "A dog.",
      reasoning: `${LOOPING_THOUGHT.repeat(4)}\n\nAnswering.`,
      reasoningCutShort: true,
      stoppedAtRoundLimit: true,
      receipt: { rounds: 1 },
    });
    const starts = emitted.flatMap((e) => (e.type === "assistantStart" ? [e.message.id] : []));
    expect(starts).toEqual(["m1", "m1"]);
  });
});

describe("runTurn reasoning loop guard limits", () => {
  it("leaves reasoning alone once the answer has started", async () => {
    const { deps, requests } = setup([
      events(
        { type: "text", delta: "A dog. " },
        { type: "reasoning", delta: LOOPING_THOUGHT.repeat(5) },
      ),
    ]);
    expect(await runTurn(deps)).toEqual({ status: "done" });
    expect(requests).toHaveLength(1);
  });

  it("retries a round only once, however the retry thinks", async () => {
    const loop = events({ type: "reasoning", delta: LOOPING_THOUGHT.repeat(4) });
    const { deps, requests, persisted } = setup([loop, loop]);
    expect(await runTurn(deps)).toEqual({ status: "done", answeredNow: "loop" });
    expect(requests).toHaveLength(2);
    expect(persisted[0]).toMatchObject({ text: "", reasoningCutShort: true });
  });

  it("sends no reasoning effort on the retry to a model without levels", async () => {
    const { deps, requests } = setup([
      events({ type: "reasoning", delta: LOOPING_THOUGHT.repeat(4) }),
      events({ type: "text", delta: "A dog." }),
    ]);
    await runTurn(deps);
    expect(requests[1]).not.toHaveProperty("reasoning_effort");
  });
});

describe("runTurn answer now", () => {
  it("cuts the streaming round and answers from what it has seen", async () => {
    const answerNow = new AbortController();
    const { deps, requests, persisted } = setup(
      [
        async function* (signal) {
          await Promise.resolve();
          yield { type: "reasoning", delta: "Let me look again." };
          answerNow.abort();
          await waitForAbort(signal);
        },
        events({ type: "text", delta: "A dog." }),
      ],
      { runTool: lookRunner(), answerNow: answerNow.signal },
    );
    expect(await runTurn(deps)).toEqual({ status: "done", answeredNow: "user" });
    expect(requests[1]).toMatchObject({ tool_choice: "none" });
    expect(requests[1]?.messages.at(-1)).toEqual({ role: "user", content: ANSWER_NOW_NOTE });
    expect(persisted).toEqual([
      expect.objectContaining({
        text: "A dog.",
        reasoning: "Let me look again.",
        reasoningCutShort: true,
      }),
    ]);
  });
});

describe("runTurn answer now during tools", () => {
  it("drops tools still running and answers without calling more", async () => {
    const answerNow = new AbortController();
    const runner = deferredRunner();
    const { deps, requests, persisted } = setup(
      [
        events({ type: "toolCalls", calls: [lookCall, laterLook] }),
        events({ type: "text", delta: "A dog." }),
      ],
      { runTool: runner.runTool, answerNow: answerNow.signal },
    );
    const outcome = runTurn(deps);
    await flush();
    expect(runner.started).toEqual(["call-1"]);
    answerNow.abort();
    expect(await outcome).toEqual({ status: "done", answeredNow: "user" });
    runner.resolve("call-1");
    await flush();
    expect(runner.started).toEqual(["call-1"]);
    expect(persisted.map((message) => message.role)).toEqual(["assistant", "assistant"]);
    expect(persisted[1]).not.toHaveProperty("reasoningCutShort");
    expect(requests[1]).toMatchObject({ tool_choice: "none" });
    expect(requests[1]?.messages.at(-1)).toEqual({ role: "user", content: ANSWER_NOW_NOTE });
  });

  it("still stops when the user stops the answer-now retry", async () => {
    const answerNow = new AbortController();
    answerNow.abort();
    const { deps } = setup(
      [
        async function* (signal, controller) {
          await Promise.resolve();
          yield { type: "text", delta: "Half" };
          controller.abort();
          await waitForAbort(signal);
        },
      ],
      { answerNow: answerNow.signal },
    );
    expect(await runTurn(deps)).toEqual({ status: "stopped" });
  });
});
