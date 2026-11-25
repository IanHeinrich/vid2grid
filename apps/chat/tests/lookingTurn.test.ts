import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/http";
import { runTurn, type TurnDeps, type TurnEvent } from "../src/chat/agentLoop";
import { blankChat } from "../src/chat/chats";
import { FINAL_ROUND_NOTE, NO_TOOLS_LOOKING_GUIDANCE } from "../src/chat/prompts";
import type {
  Chat,
  ChatMessage,
  ChatRequest,
  ImageRef,
  SeenNote,
  StreamChat,
  StreamEvent,
  ToolCall,
  ToolSchema,
} from "../src/types";
import { assistant, model, tool, upload, user } from "./support/factories";
import {
  answered,
  described,
  imageStore,
  looker,
  perModel,
  sentImageIds,
  textsOf,
  timedSheet,
} from "./support/looking";
import { waitForAbort } from "./support/streams";

const askTool: ToolSchema = {
  type: "function",
  function: { name: "ask", description: "Ask", parameters: {} },
};
const chat: Chat = blankChat("writer", "chat", 1, "eyes");
const a = timedSheet("a", 0);
const b = timedSheet("b", 10);
const c = upload("c");
const USAGE = { promptTokens: 500, completionTokens: 20 };

type Round = (StreamEvent | Error)[];

function look(id: string, args: Record<string, unknown> = {}): ToolCall {
  return { id, name: "look", arguments: JSON.stringify({ start: 0, end: 10, ...args }) };
}

const says = (delta: string): Round => [{ type: "text", delta }];
const calls = (...made: ToolCall[]): Round => [{ type: "toolCalls", calls: made }];

function scripted(rounds: Round[], requests: ChatRequest[]): StreamChat {
  const queue = [...rounds];
  return async function* (_api, request) {
    await Promise.resolve();
    requests.push(request);
    for (const event of queue.shift() ?? [new Error("Nothing scripted")]) {
      if (event instanceof Error) throw event;
      yield event;
    }
  };
}

interface Scripts {
  eyes?: Round[];
  writer?: Round[];
  images?: Record<string, ImageRef[]>;
  eyesStream?: StreamChat;
}

function setup(messages: ChatMessage[], scripts: Scripts = {}, overrides: Partial<TurnDeps> = {}) {
  const stop = new AbortController();
  const answerNow = new AbortController();
  const eyes: ChatRequest[] = [];
  const writer: ChatRequest[] = [];
  const order: string[] = [];
  const saved: [string, readonly SeenNote[]][] = [];
  const persisted: ChatMessage[] = [];
  const events: TurnEvent[] = [];
  const streams = perModel({
    eyes: scripts.eyesStream ?? scripted(scripts.eyes ?? [], eyes),
    writer: scripted(scripts.writer ?? [says("Done.")], writer),
  });
  const streamChat: StreamChat = (api, request, signal) => {
    order.push(request.model);
    return streams(api, request, signal);
  };
  let nextId = 0;
  const deps: TurnDeps = {
    chat,
    messages,
    model: model("writer"),
    api: { baseUrl: "http://localhost:1234/v1", apiKey: "writer-key" },
    streamChat,
    runTool: (call) =>
      Promise.resolve({ text: `ran ${call.id}`, images: scripts.images?.[call.id] ?? [] }),
    store: imageStore(),
    looking: {
      ...looker([], [], { streamChat, model: model("eyes", { name: "Eyes", maxImages: 2 }) }),
      save: (id, seen) => {
        saved.push([id, seen]);
        return Promise.resolve();
      },
    },
    tools: [askTool],
    toolGuidance: "Use ask.",
    veniceParameters: false,
    signal: stop.signal,
    answerNow: answerNow.signal,
    resolution: 1024,
    persist: (message) => {
      persisted.push(message);
      return Promise.resolve();
    },
    onEvent: (event) => events.push(event),
    now: () => 100,
    newId: () => `m${++nextId}`,
    ...overrides,
  };
  return { deps, stop, answerNow, eyes, writer, order, saved, persisted, events };
}

const noTools = { model: model("writer", { tools: false }), tools: [], runTool: undefined };

function lastSeen(saved: [string, readonly SeenNote[]][]): readonly SeenNote[] | undefined {
  return saved.at(-1)?.[1];
}

describe("looking before the writer", () => {
  it("describes the message's new pictures first, and the writer gets only the words", async () => {
    const eyes = [[...says("A dog."), { type: "usage" as const, usage: USAGE }]];
    const run = setup([user("u", "Who?", { images: [c, a] })], { eyes });
    expect(await runTurn(run.deps)).toEqual({ status: "done" });
    expect(run.order).toEqual(["eyes", "writer"]);
    expect(sentImageIds(run.eyes[0])).toEqual(["a", "c"]);
    expect(textsOf(run.eyes[0]).at(-1)).toBe(
      "Describe these 2 pictures. Pay attention to what this asks: Who?",
    );
    const note = described(["a", "c"], "A dog.", { question: "Who?", usage: USAGE });
    expect(run.saved).toEqual([["u", [note]]]);
    expect(JSON.stringify(run.writer)).not.toContain("image_url");
    expect(run.writer[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: expect.stringMatching(
        /^Who\?\n\n[^]*what the looking model saw[^]*\nA dog\.\n\[End of/,
      ) as string,
    });
    expect(run.events.slice(0, 2)).toEqual([
      { type: "lookStart", images: 2, modelId: "eyes" },
      { type: "looked", messageId: "u", seen: [note] },
    ]);
  });

  it("sends no pictures to a writer that sees, and ignores its pin limit", async () => {
    const pinned = [a, b].map((image) => ({ ...image, pinned: true }));
    const messages = [user("u", "Who?", { images: pinned, seen: [described(["a", "b"], "Two.")] })];
    const run = setup(messages, {}, { model: model("writer", { maxImages: 1 }) });
    expect(await runTurn(run.deps)).toEqual({ status: "done" });
    expect(JSON.stringify(run.writer)).not.toContain("image_url");
  });

  it("splits more pictures than the looking model takes, saving each answer as it comes", async () => {
    const d = timedSheet("d", 20);
    const run = setup([user("u", "Who?", { images: [d, b, a] })], {
      eyes: [says("First."), says("Second.")],
    });
    await runTurn(run.deps);
    expect(run.eyes.map(sentImageIds)).toEqual([["a", "b"], ["d"]]);
    expect(run.saved.map(([, seen]) => seen.map(({ text }) => text))).toEqual([
      ["First."],
      ["First.", "Second."],
    ]);
  });

  it("looks at what each tool returns before the next round, with the call's question", async () => {
    const run = setup([user("u", "Who?")], {
      eyes: [says("Kitchen."), says("Garden.")],
      writer: [calls(look("c1", { question: "Which room?" }), look("c2")), says("Done.")],
      images: { c1: [a], c2: [b] },
    });
    await runTurn(run.deps);
    expect(run.order).toEqual(["writer", "eyes", "eyes", "writer"]);
    expect(run.eyes.map((request) => textsOf(request).at(-1))).toEqual([
      "Describe this picture. Pay attention to what this asks: Which room?",
      "Describe this picture. Pay attention to what this asks: Who?",
    ]);
    const contents = run.writer[1]?.messages.filter(({ role }) => role === "tool");
    expect(contents?.map(({ content }) => content)).toEqual([
      expect.stringMatching(/^ran c1[^]*Kitchen\.\n\[End/),
      expect.stringMatching(/^ran c2[^]*Garden\.\n\[End/),
    ]);
  });

  it("takes the question of the nearest call, since servers use an id again each round", async () => {
    const run = setup([user("u", "Who?")], {
      eyes: [says("Kitchen."), says("Garden.")],
      writer: [
        calls(look("call_0", { question: "Which room?" })),
        calls(look("call_0", { question: "Which season?" })),
        says("Done."),
      ],
    });
    const queue = [a, b];
    const runTool = () => {
      const next = queue.shift();
      return Promise.resolve({ text: "ok", images: next ? [next] : [] });
    };
    await runTurn({ ...run.deps, runTool });
    expect(run.eyes.map((request) => textsOf(request).at(-1))).toEqual([
      "Describe this picture. Pay attention to what this asks: Which room?",
      "Describe this picture. Pay attention to what this asks: Which season?",
    ]);
  });

  it("leaves an ask reply alone and counts its pictures as sent", async () => {
    const seen = [answered(["a"], "Red.", { question: "What colour?" })];
    const run = setup(
      [user("u", "Who?")],
      { writer: [calls({ id: "c1", name: "ask", arguments: "{}" }), says("Done.")] },
      { runTool: () => Promise.resolve({ text: "About a: Red.", images: [a], seen }) },
    );
    await runTurn(run.deps);
    expect(run.eyes).toEqual([]);
    expect(run.persisted[1]).toMatchObject({ role: "tool", images: [a], seen });
    expect(run.persisted.at(-1)).toMatchObject({ receipt: { imagesSent: 1 } });
  });

  it("leaves pictures from earlier turns to ask", async () => {
    const messages = [
      user("u1", "Hi.", { images: [a] }),
      assistant("a1", "Hello."),
      user("u2", "Who?"),
    ];
    const run = setup(messages);
    await runTurn(run.deps);
    expect(run.eyes).toEqual([]);
    expect(JSON.stringify(run.writer[0])).toContain("Not looked at yet; call ask");
  });

  it("passes over pictures that are no longer stored", async () => {
    const store = imageStore(["a"]);
    const run = setup([user("u", "Who?", { images: [a] })]);
    const { looking } = run.deps;
    if (!looking) throw new Error("No looking model");
    const deps = { ...run.deps, store, looking: { ...looking, store } };
    expect(await runTurn(deps)).toEqual({ status: "done" });
    expect(run.eyes).toEqual([]);
  });

  it("sends nothing to the looking model when it is off", async () => {
    const message = user("u", "Who?", { images: [a] });
    const run = setup([message]);
    const deps = { ...run.deps, chat: blankChat("writer", "chat", 1) };
    delete deps.looking;
    await runTurn(deps);
    expect(run.order).toEqual(["writer"]);
    expect(sentImageIds(run.writer[0])).toEqual(["a"]);
  });
});

describe("reusing what was seen", () => {
  const note = described(["a"], "A dog.", { question: "Who?", usage: USAGE });

  it("pays nothing again for the same message", async () => {
    const run = setup([user("u", "Who?", { images: [a], seen: [note] })]);
    await runTurn(run.deps);
    expect(run.order).toEqual(["writer"]);
    expect(run.saved).toEqual([]);
  });

  it("copies the words, not the cost, when a swiped reply looked at the same picture", async () => {
    const old = { ...tool("t", "c0", [a]), seen: [note] };
    const alternates = [
      { messages: [assistant("x", "", { toolCalls: [look("c0")] }), old], createdAt: 1 },
    ];
    const run = setup([user("u", "Who?", { alternates })], {
      writer: [calls(look("c1")), says("Done.")],
      images: { c1: [a] },
    });
    await runTurn(run.deps);
    expect(run.eyes).toEqual([]);
    expect(lastSeen(run.saved)).toEqual([described(["a"], "A dog.", { question: "Who?" })]);
  });

  it("looks again when a call asks something new of the same picture", async () => {
    const run = setup([user("u", "Who?", { images: [a], seen: [note] })], {
      eyes: [says("Collie.")],
      writer: [calls(look("c1", { question: "Which breed?" })), says("Done.")],
      images: { c1: [a] },
    });
    await runTurn(run.deps);
    expect(run.eyes).toHaveLength(1);
    expect(lastSeen(run.saved)).toEqual([
      described(["a"], "Collie.", { question: "Which breed?" }),
    ]);
  });
});

describe("looking again", () => {
  const note = described(["a"], "A dog.", { question: "Who?" });

  it("describes an earlier message's picture afresh, whatever is known of it elsewhere", async () => {
    const marked = user("u1", "Who?", { images: [a], seen: [], lookAgain: true });
    const other = { ...tool("t1", "c1", [a]), seen: [note] };
    const messages = [
      marked,
      assistant("a1", "", { toolCalls: [look("c1")] }),
      other,
      assistant("a2", "A dog."),
      user("u2", "Sure?"),
    ];
    const run = setup(messages, { eyes: [says("A fox.")] });
    await runTurn(run.deps);
    expect(run.saved).toEqual([["u1", [described(["a"], "A fox.", { question: "Who?" })]]]);
    expect(textsOf(run.eyes[0]).at(-1)).toContain("what this asks: Who?");
    expect(JSON.stringify(run.writer[0])).toContain("A fox.");
  });
});

describe("looking again at marked pictures", () => {
  it("reuses no words about a picture any message marks, a swipe included", async () => {
    const marked = { ...tool("t", "c0", [a]), seen: [], lookAgain: true as const };
    const alternates = [{ messages: [assistant("x", ""), marked], createdAt: 1 }];
    const other = { ...tool("t1", "c1", [a, b]), seen: [described(["a", "b"], "Two.")] };
    const messages = [
      user("u1", "Hi."),
      assistant("a1", "", { toolCalls: [look("c1")] }),
      other,
      user("u2", "Who?", { images: [a, b], alternates }),
    ];
    const run = setup(messages, { eyes: [says("A fox.")] });
    await runTurn(run.deps);
    expect(sentImageIds(run.eyes[0])).toEqual(["a"]);
    const texts = lastSeen(run.saved)?.map(({ text, imageIds }) => [text, imageIds]);
    expect(texts).toEqual([
      ["Two.", ["b"]],
      ["A fox.", ["a"]],
    ]);
  });

  it("has nothing to wait for once its picture is gone", async () => {
    const marked = user("u", "Who?", { images: [a], seen: [], lookAgain: true });
    const gone = imageStore(["a"]);
    const run = setup([marked], {});
    const { looking } = run.deps;
    if (!looking) throw new Error("No looking model");
    const saves: ReadonlySet<string>[] = [];
    const save = (_id: string, _seen: readonly SeenNote[], ids: ReadonlySet<string>) => {
      saves.push(ids);
      return Promise.resolve();
    };
    await runTurn({ ...run.deps, store: gone, looking: { ...looking, store: gone, save } });
    expect(saves).toEqual([new Set(["a"])]);
    expect(run.eyes).toEqual([]);
  });

  it("describes a message's own picture again though its question was answered", async () => {
    const seen = [answered(["a"], "Brown.", { question: "Who?" })];
    const marked = user("u", "Who?", { images: [a], seen, lookAgain: true });
    const run = setup([marked], { eyes: [says("A fox.")] }, noTools);
    await runTurn(run.deps);
    expect(lastSeen(run.saved)?.map(({ text }) => text)).toEqual(["Brown.", "A fox."]);
  });
});

describe("a writer without tools", () => {
  const earlier = [
    user("u1", "Hi.", {
      images: [a, b],
      seen: [described(["a", "b"], "A dog.", { question: "Hi." })],
    }),
    assistant("a1", "Hello."),
  ];

  it("has its user's message asked about the newest pictures", async () => {
    const run = setup(
      [...earlier, user("u2", "What colour?")],
      { eyes: [says("Brown.")] },
      noTools,
    );
    await runTurn(run.deps);
    expect(run.order).toEqual(["eyes", "writer"]);
    expect(sentImageIds(run.eyes[0])).toEqual(["a", "b"]);
    const texts = textsOf(run.eyes[0]);
    expect(texts.at(-1)).toBe("Answer this from the pictures: What colour?");
    expect(texts.at(-2)).toContain("Answered: A dog.");
    const note = answered(["a", "b"], "Brown.", { question: "What colour?" });
    expect(run.saved).toEqual([["u2", [note]]]);
    expect(run.writer[0]?.messages[0]?.content).toContain(NO_TOOLS_LOOKING_GUIDANCE);
    expect(run.writer[0]?.messages.at(-1)?.content).toMatch(
      /^What colour\?\n\n\[Note from the app, [^]*\]\nBrown\.\n\[End/,
    );
  });

  it("keeps to the image limit: the turn's pictures, pins, the overview, then the rest", async () => {
    const d = { ...upload("d"), pinned: true };
    const e = upload("e");
    const messages = [
      user("u1", "Hi.", { images: [d, a], seen: [described(["d", "a"], "A dog.")] }),
      assistant("a1", "Hello."),
      user("u2", "This?", { images: [c], seen: [described(["c"], "A cat.")] }),
      assistant("a2", "Yes."),
    ];
    const asked = async (last: ChatMessage, most: number) => {
      const run = setup([...messages, last], { eyes: [says("Both.")] }, noTools);
      const { looking } = run.deps;
      if (!looking) throw new Error("No looking model");
      const capped = { ...looking, model: { ...looking.model, maxImages: most } };
      await runTurn({ ...run.deps, looking: capped });
      return sentImageIds(run.eyes[0]).sort();
    };
    const plain = user("u3", "Which?");
    expect(await asked(plain, 1)).toEqual(["d"]);
    expect(await asked(plain, 2)).toEqual(["a", "d"]);
    expect(await asked(plain, 3)).toEqual(["a", "c", "d"]);
    const edited = user("u3", "Which?", {
      images: [e],
      seen: [described(["e"], "A hat.", { question: "Before the edit" })],
    });
    expect(await asked(edited, 1)).toEqual(["e"]);
  });

  it("asks nothing twice: not after new pictures, on a replay, or with no pictures", async () => {
    const withNew = setup(
      [user("u", "Who?", { images: [a] })],
      { eyes: [says("A dog.")] },
      noTools,
    );
    await runTurn(withNew.deps);
    expect(withNew.order).toEqual(["eyes", "writer"]);
    const seen = [answered(["a", "b"], "Brown.", { question: "What colour?" })];
    const replayed = setup([...earlier, user("u2", "What colour?", { seen })], {}, noTools);
    await runTurn(replayed.deps);
    expect(replayed.order).toEqual(["writer"]);
    const none = setup([user("u", "Who?")], {}, noTools);
    await runTurn(none.deps);
    expect(none.order).toEqual(["writer"]);
    expect(JSON.stringify(none.writer)).not.toContain("looking model");
  });

  it("asks again when the message was edited, dropping the old answer", async () => {
    const seen = [answered(["a", "b"], "Brown.", { question: "What colour?" })];
    const messages = [...earlier, user("u2", "What shape?", { seen })];
    const run = setup(messages, { eyes: [says("Round.")] }, noTools);
    await runTurn(run.deps);
    expect(lastSeen(run.saved)).toEqual([
      answered(["a", "b"], "Round.", { question: "What shape?" }),
    ]);
  });

  it("asks nothing for Keep going", async () => {
    const messages = [...earlier, user("u2", "Keep going", { continuation: true })];
    const run = setup(messages, {}, noTools);
    await runTurn(run.deps);
    expect(run.order).toEqual(["writer"]);
  });

  it("is also one whose server refuses the request for listing tools", async () => {
    const refused = [new ApiError(400, "tools are not supported")];
    const run = setup(
      [...earlier, user("u2", "What colour?")],
      { eyes: [says("Brown.")], writer: [refused, says("Brown it is.")] },
      { toolsOptional: true },
    );
    expect(await runTurn(run.deps)).toEqual({ status: "done" });
    expect(run.order).toEqual(["writer", "eyes", "writer"]);
    expect(run.writer[1]).not.toHaveProperty("tools");
    expect(JSON.stringify(run.writer[1])).toContain("Brown.");
  });

  it("fails like its stream when that asking fails", async () => {
    const refused = [new ApiError(400, "tools are not supported")];
    const run = setup(
      [...earlier, user("u2", "What colour?")],
      { eyes: [[new Error("offline")]], writer: [refused] },
      { toolsOptional: true },
    );
    expect(await runTurn(run.deps)).toMatchObject({ status: "error" });
    expect(run.persisted).toEqual([]);
    expect(run.events.at(-1)).toMatchObject({ type: "assistantDone" });
  });
});

describe("looking that does not finish", () => {
  const message = user("u", "Who?", { images: [a] });

  it("fails the turn, naming the looking model and its server, before the writer is asked", async () => {
    const run = setup([message], { eyes: [[new ApiError(503, "busy")]] });
    expect(await runTurn(run.deps)).toEqual({
      status: "error",
      error: "The looking model Eyes at localhost:5001 could not look at the pictures: busy",
    });
    expect(run.writer).toEqual([]);
    expect(run.persisted).toEqual([]);
  });

  it("fails on an empty answer too, keeping what was seen before it", async () => {
    const images = [a, b, timedSheet("d", 20)];
    const run = setup([user("u", "Who?", { images })], { eyes: [says("First."), says(" ")] });
    expect(await runTurn(run.deps)).toMatchObject({ status: "error" });
    expect(lastSeen(run.saved)).toHaveLength(1);
  });

  it("ends with Stop", async () => {
    const eyesStream: StreamChat = (_api, _request, signal) => waitForAbort(signal);
    const run = setup([message], { eyesStream });
    const turn = runTurn(run.deps);
    await Promise.resolve();
    run.stop.abort();
    expect(await turn).toEqual({ status: "stopped" });
    expect(run.writer).toEqual([]);
  });

  it("starts no look once stopped, so none is shown as running", async () => {
    const run = setup([message]);
    const { looking } = run.deps;
    if (!looking) throw new Error("Not looking");
    looking.store = {
      getImage: (id) => {
        run.stop.abort();
        return imageStore().getImage(id);
      },
    };
    expect(await runTurn(run.deps)).toEqual({ status: "stopped" });
    expect(run.order).toEqual([]);
    expect(run.events).toEqual([]);
  });

  it("is skipped by Answer now, which says the picture was not looked at", async () => {
    const eyesStream: StreamChat = (_api, _request, signal) => {
      queueMicrotask(() => run.answerNow.abort());
      return waitForAbort(signal);
    };
    const run = setup([user("u", "Who?", { images: [a, b, c] })], { eyesStream });
    expect(await runTurn(run.deps)).toEqual({ status: "done", answeredNow: "user" });
    expect(run.order).toEqual(["eyes", "writer"]);
    expect(JSON.stringify(run.writer[0])).toContain("Not looked at yet");
    expect(JSON.stringify(run.writer[0])).not.toContain(FINAL_ROUND_NOTE);
  });
});

describe("the receipt", () => {
  it("counts the pictures looked at", async () => {
    const run = setup([user("u", "Who?", { images: [a, b, c] })], {
      eyes: [says("First."), says("Second.")],
    });
    await runTurn(run.deps);
    expect(run.persisted.at(-1)).toMatchObject({ receipt: { imagesSent: 3, rounds: 1 } });
  });
});
