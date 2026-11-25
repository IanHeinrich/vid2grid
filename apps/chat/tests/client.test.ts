import { describe, expect, it } from "vitest";
import { ApiError, getBalance, listModels, streamChat } from "../src/api/client";
import { safeError } from "../src/api/http";
import { VENICE_BASE_URL } from "../src/api/venice";
import type { ChatRequest, StreamEvent } from "../src/types";
import { fakeFetch, jsonResponse, localSettings, veniceSettings } from "./support/apiFakes";

const request: ChatRequest = {
  model: "m",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
};

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function sse(payload: unknown): string {
  return `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
}

function deltaChunk(delta: unknown, finishReason: string | null = null): string {
  return sse({ choices: [{ index: 0, delta, finish_reason: finishReason }] });
}

async function collect(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const collected: StreamEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

async function run(chunks: string[]): Promise<StreamEvent[]> {
  const { fetch: fetchImpl } = fakeFetch(() => streamResponse(chunks));
  return collect(streamChat(localSettings, request, new AbortController().signal, fetchImpl));
}

function joinDeltas(events: StreamEvent[], type: "text" | "reasoning"): string {
  return events.map((event) => (event.type === type ? event.delta : "")).join("");
}
describe("streamChat", () => {
  it("refuses to send a request that names no model", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(() => streamResponse(["data: [DONE]\n\n"]));
    const unnamed = { ...request, model: "" };
    await expect(
      collect(streamChat(veniceSettings, unnamed, new AbortController().signal, fetchImpl)),
    ).rejects.toMatchObject({ message: "Choose a model in Chat settings first." });
    expect(calls).toEqual([]);
  });

  it("refuses to send while the base URL is unset", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(() => streamResponse(["data: [DONE]\n\n"]));
    const unset = { baseUrl: "", apiKey: "" };
    await expect(
      collect(streamChat(unset, request, new AbortController().signal, fetchImpl)),
    ).rejects.toMatchObject({ name: "ApiError", message: "Choose an API in Settings first." });
    expect(calls).toEqual([]);
  });

  it("posts the request with auth, content type and signal", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(() => streamResponse(["data: [DONE]\n\n"]));
    const controller = new AbortController();
    await collect(streamChat(veniceSettings, request, controller.signal, fetchImpl));
    const call = calls[0];
    expect(call?.url).toBe(`${VENICE_BASE_URL}/chat/completions`);
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.headers).toEqual({
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
    });
    expect(call?.init?.body).toBe(JSON.stringify(request));
    expect(call?.init?.signal).toBe(controller.signal);
  });

  it("normalises a trailing slash on the base URL", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(() => streamResponse(["data: [DONE]\n\n"]));
    await collect(streamChat(localSettings, request, new AbortController().signal, fetchImpl));
    expect(calls[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
  });
});

describe("streamChat text and reasoning", () => {
  it("streams text deltas split mid-line and mid-JSON, then done", async () => {
    const first = deltaChunk({ content: "Hel" });
    const second = deltaChunk({ content: "lo" });
    const third = deltaChunk({}, "stop");
    const events = await run([
      first.slice(0, 20),
      first.slice(20) + second.slice(0, 7),
      second.slice(7) + third,
      "data: [DONE]\n\n",
    ]);
    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("streams reasoning_content and reasoning as reasoning events", async () => {
    const events = await run([
      deltaChunk({ reasoning_content: "think " }),
      deltaChunk({ reasoning: "more" }),
      deltaChunk({ content: "answer" }, "stop"),
      "data: [DONE]\n\n",
    ]);
    expect(events).toEqual([
      { type: "reasoning", delta: "think " },
      { type: "reasoning", delta: "more" },
      { type: "text", delta: "answer" },
      { type: "done", finishReason: "stop" },
    ]);
  });
});

describe("streamChat inline think tags", () => {
  it("routes inline think tags to reasoning when whole in one delta", async () => {
    const events = await run([
      deltaChunk({ content: "<think>plan</think>Answer" }),
      "data: [DONE]\n\n",
    ]);
    expect(joinDeltas(events, "reasoning")).toBe("plan");
    expect(joinDeltas(events, "text")).toBe("Answer");
  });

  it("routes inline think tags to reasoning when the tags are split across deltas", async () => {
    const pieces = ["<thi", "nk>pla", "n</th", "ink>Ans", "wer <", "b>ok</b>"];
    const events = await run([
      ...pieces.map((content) => deltaChunk({ content })),
      "data: [DONE]\n\n",
    ]);
    expect(joinDeltas(events, "reasoning")).toBe("plan");
    expect(joinDeltas(events, "text")).toBe("Answer <b>ok</b>");
  });

  it("emits a held-back partial tag as text when the stream ends", async () => {
    const events = await run([deltaChunk({ content: "a <thi" }), "data: [DONE]\n\n"]);
    expect(joinDeltas(events, "text")).toBe("a <thi");
  });
});

describe("streamChat tool calls and finish", () => {
  it("assembles two parallel tool calls from fragments across chunks", async () => {
    const events = await run([
      deltaChunk({
        tool_calls: [
          { index: 0, id: "call_a", type: "function", function: { name: "look", arguments: "" } },
        ],
      }),
      deltaChunk({ tool_calls: [{ index: 0, function: { arguments: '{"start":' } }] }),
      deltaChunk({
        tool_calls: [
          {
            index: 1,
            id: "call_b",
            type: "function",
            function: { name: "overview", arguments: "{" },
          },
        ],
      }),
      deltaChunk({ tool_calls: [{ index: 0, function: { arguments: '60,"end":90}' } }] }),
      deltaChunk({ tool_calls: [{ index: 1, function: { arguments: "}" } }] }, "tool_calls"),
      "data: [DONE]\n\n",
    ]);
    expect(events).toEqual([
      {
        type: "toolCalls",
        calls: [
          { id: "call_a", name: "look", arguments: '{"start":60,"end":90}' },
          { id: "call_b", name: "overview", arguments: "{}" },
        ],
      },
      { type: "done", finishReason: "tool_calls" },
    ]);
  });
});

describe("streamChat index-less tool calls", () => {
  it("keeps two index-less tool calls from separate chunks apart by id", async () => {
    const events = await run([
      deltaChunk({ tool_calls: [{ id: "a", function: { name: "look", arguments: '{"x":1}' } }] }),
      deltaChunk({ tool_calls: [{ id: "b", function: { name: "overview", arguments: "{}" } }] }),
      deltaChunk({}, "tool_calls"),
    ]);
    expect(events[0]).toEqual({
      type: "toolCalls",
      calls: [
        { id: "a", name: "look", arguments: '{"x":1}' },
        { id: "b", name: "overview", arguments: "{}" },
      ],
    });
  });

  it("continues an index-less tool call across chunks while the id repeats or is absent", async () => {
    const events = await run([
      deltaChunk({ tool_calls: [{ id: "a", function: { name: "look", arguments: '{"x":' } }] }),
      deltaChunk({ tool_calls: [{ id: "a", function: { arguments: "1," } }] }),
      deltaChunk({ tool_calls: [{ function: { arguments: '"y":2}' } }] }),
      deltaChunk({}, "tool_calls"),
    ]);
    expect(events[0]).toEqual({
      type: "toolCalls",
      calls: [{ id: "a", name: "look", arguments: '{"x":1,"y":2}' }],
    });
  });

  it("splits index-less calls that share a chunk", async () => {
    const events = await run([
      deltaChunk({
        tool_calls: [
          { id: "a", function: { name: "look", arguments: "{}" } },
          { id: "b", function: { name: "overview", arguments: "{}" } },
        ],
      }),
      deltaChunk({}, "tool_calls"),
    ]);
    expect(events[0]).toMatchObject({ calls: [{ id: "a" }, { id: "b" }] });
  });
});

describe("streamChat tool call slots", () => {
  it("splits calls that all claim index 0 but carry different ids", async () => {
    const events = await run([
      deltaChunk({
        tool_calls: [{ index: 0, id: "a", function: { name: "look", arguments: "{}" } }],
      }),
      deltaChunk({
        tool_calls: [{ index: 0, id: "b", function: { name: "look", arguments: "{}" } }],
      }),
      deltaChunk({}, "tool_calls"),
    ]);
    expect(events[0]).toMatchObject({ calls: [{ id: "a" }, { id: "b" }] });
  });

  it("sends a split call's id-less fragments to the new call, not the old one", async () => {
    const events = await run([
      deltaChunk({
        tool_calls: [{ index: 0, id: "a", function: { name: "look", arguments: "" } }],
      }),
      deltaChunk({ tool_calls: [{ index: 0, function: { arguments: '{"start":1,"end":2}' } }] }),
      deltaChunk({
        tool_calls: [{ index: 0, id: "b", function: { name: "frames", arguments: "" } }],
      }),
      deltaChunk({ tool_calls: [{ index: 0, function: { arguments: '{"times":[1]}' } }] }),
      deltaChunk({}, "tool_calls"),
    ]);
    expect(events[0]).toEqual({
      type: "toolCalls",
      calls: [
        { id: "a", name: "look", arguments: '{"start":1,"end":2}' },
        { id: "b", name: "frames", arguments: '{"times":[1]}' },
      ],
    });
  });

  it("yields tool calls in index order", async () => {
    const events = await run([
      deltaChunk({
        tool_calls: [
          { index: 1, id: "two", function: { name: "b", arguments: "{}" } },
          { index: 0, id: "one", function: { name: "a", arguments: "{}" } },
        ],
      }),
      "data: [DONE]\n\n",
    ]);
    expect(events[0]).toMatchObject({
      type: "toolCalls",
      calls: [{ id: "one" }, { id: "two" }],
    });
  });
});

describe("streamChat stream edges", () => {
  it("stops reading at [DONE]", async () => {
    const events = await run([
      deltaChunk({ content: "a" }),
      "data: [DONE]\n\n",
      deltaChunk({ content: "ignored" }),
    ]);
    expect(joinDeltas(events, "text")).toBe("a");
  });

  it("reports a null finish reason when the stream ends on [DONE] alone", async () => {
    const events = await run([deltaChunk({ content: "a" }), "data: [DONE]\n\n"]);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: null });
  });
});

describe("streamChat stream endings", () => {
  it("completes normally when a finish reason arrives without [DONE]", async () => {
    const events = await run([deltaChunk({ content: "a" }), deltaChunk({}, "stop")]);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  it("throws when the body ends with neither [DONE] nor a finish reason", async () => {
    const failure = run([
      deltaChunk({ content: "a" }),
      deltaChunk({
        tool_calls: [{ index: 0, id: "c", function: { name: "look", arguments: '{"st' } }],
      }),
    ]);
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 0,
      message: "The connection closed before the reply finished.",
    });
  });

  it("ignores comment lines and payloads that are not JSON", async () => {
    const events = await run([
      ": ping\n\n",
      "data: not json\n\n",
      deltaChunk({ content: "a" }),
      "data: [DONE]\n\n",
    ]);
    expect(joinDeltas(events, "text")).toBe("a");
  });
});

describe("streamChat errors", () => {
  it("throws an ApiError with the message from a non-OK JSON body", async () => {
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({ error: { message: "Model not found" } }, 404),
    );
    const failure = collect(
      streamChat(localSettings, request, new AbortController().signal, fetchImpl),
    );
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 404, message: "Model not found" });
  });

  it("falls back to a top-level message, then the raw text", async () => {
    const top = fakeFetch(() => jsonResponse({ message: "Too many requests" }, 429));
    await expect(
      collect(streamChat(localSettings, request, new AbortController().signal, top.fetch)),
    ).rejects.toMatchObject({ status: 429, message: "Too many requests" });

    const raw = fakeFetch(() => new Response("Bad gateway", { status: 502 }));
    await expect(
      collect(streamChat(localSettings, request, new AbortController().signal, raw.fetch)),
    ).rejects.toMatchObject({ status: 502, message: "Bad gateway" });
  });

  it("throws an ApiError for an error object inside the stream", async () => {
    const failure = run([
      deltaChunk({ content: "a" }),
      sse({ error: { code: 500, message: "Upstream failed" } }),
    ]);
    await expect(failure).rejects.toMatchObject({ status: 500, message: "Upstream failed" });
  });

  it("uses status 0 when an in-stream error has no numeric code", async () => {
    const failure = run([sse({ error: { message: "Oops" } })]);
    await expect(failure).rejects.toMatchObject({ status: 0, message: "Oops" });
  });
});

describe("streamChat usage", () => {
  it("yields usage from a final chunk with empty choices, before done", async () => {
    const events = await run([
      deltaChunk({ content: "Hi" }, "stop"),
      sse({
        choices: [],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 80,
          total_tokens: 1280,
          completion_tokens_details: { reasoning_tokens: 30 },
          prompt_tokens_details: { cached_tokens: 1000 },
        },
      }),
      sse("[DONE]"),
    ]);
    expect(events.slice(-2)).toEqual([
      {
        type: "usage",
        usage: {
          promptTokens: 1200,
          completionTokens: 80,
          reasoningTokens: 30,
          cachedTokens: 1000,
        },
      },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("leaves out details the server does not report, and ignores null usage", async () => {
    const events = await run([
      sse({ choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }], usage: null }),
      sse({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, completion_tokens_details: null },
      }),
      sse("[DONE]"),
    ]);
    expect(events.filter((event) => event.type === "usage")).toEqual([
      { type: "usage", usage: { promptTokens: 10, completionTokens: 2 } },
    ]);
  });

  it("yields no usage when the server never sends it", async () => {
    const events = await run([deltaChunk({ content: "Hi" }, "stop"), sse("[DONE]")]);
    expect(events.map((event) => event.type)).toEqual(["text", "done"]);
  });
});

describe("errors that repeat the key", () => {
  const api = { baseUrl: VENICE_BASE_URL, apiKey: " sk-secret-1 " };
  const body = {
    error: { code: 401, message: `Bad key sk-secret-1: ${"x".repeat(2000)} tools sk-secret-1` },
  };
  async function streamed(response: () => Response): Promise<unknown> {
    const { fetch } = fakeFetch(response);
    const reply = streamChat(api, request, new AbortController().signal, fetch);
    return reply.next().catch((error: unknown) => error);
  }

  function expectSafe(error: unknown): void {
    if (!(error instanceof Error)) throw new Error("Expected an error");
    expect(error.message).toMatch(/^Bad key …/);
    // Whole, so that what it is about can be told from its end too.
    expect(error.message).toMatch(/ tools …$/);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain("sk-secret-1");
  }

  it("are cleaned before anyone sees them, with their status", async () => {
    const error = await streamed(() => jsonResponse(body, 401));
    expectSafe(error);
    expect(error).toMatchObject({ name: "ApiError", status: 401 });
  });

  it("are cleaned when they come in the stream", async () => {
    expectSafe(await streamed(() => new Response(`data: ${JSON.stringify(body)}\n\n`)));
  });

  it("are cleaned for the model list and the balance", async () => {
    const { fetch } = fakeFetch(() => jsonResponse(body, 500));
    expectSafe(await listModels(api, { fetch }).catch((error: unknown) => error));
    const balance = await getBalance(api, fetch);
    expect(JSON.stringify(balance)).not.toContain("sk-secret-1");
    const html = fakeFetch(() => new Response("sk-secret-1 is not JSON"));
    const broken = await listModels(api, { fetch: html.fetch }).catch((error: unknown) => error);
    expect(broken).toBeInstanceOf(SyntaxError);
    expect(String(broken)).not.toContain("sk-secret-1");
  });

  it("leaves a placeholder key and a stop alone", () => {
    const plain = new Error("a key");
    expect(safeError(plain, { apiKey: "key" })).toBe(plain);
    const stop = new DOMException("stopped", "AbortError");
    expect(safeError(stop, api)).toBe(stop);
  });
});
