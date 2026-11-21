import { describe, expect, it } from "vitest";
import {
  ApiError,
  VENICE_BASE_URL,
  getBalance,
  isChatModelId,
  isVenice,
  listModels,
  streamChat,
} from "../src/api/client";
import type { ApiSettings, ChatRequest, ModelInfo, StreamEvent } from "../src/types";

const veniceSettings: ApiSettings = { baseUrl: VENICE_BASE_URL, apiKey: "secret" };
const localSettings: ApiSettings = { baseUrl: "http://localhost:11434/v1/", apiKey: "" };

const request: ChatRequest = {
  model: "m",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
};

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(respond: () => Response): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(respond());
  };
  return { fetch: impl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

const veniceEntry = {
  id: "qwen3-6-27b",
  type: "text",
  model_spec: {
    availableContextTokens: 256000,
    name: "Qwen 3.6 27B",
    privacy: "private",
    offline: false,
    capabilities: {
      supportsFunctionCalling: true,
      supportsMultipleImages: true,
      maxImages: 10,
      supportsReasoning: true,
      reasoningEffortOptions: ["none", "low", "medium", "high"],
      supportsVision: true,
      supportsVideoInput: true,
    },
  },
};

describe("isVenice", () => {
  it("matches the Venice host only", () => {
    expect(isVenice(VENICE_BASE_URL)).toBe(true);
    expect(isVenice("https://api.venice.ai/api/v1/")).toBe(true);
    expect(isVenice("http://localhost:11434/v1")).toBe(false);
    expect(isVenice("https://example.com/api.venice.ai")).toBe(false);
    expect(isVenice("not a url")).toBe(false);
  });
});

describe("listModels reasoning", () => {
  it("keeps the model's default reasoning effort when it names one", async () => {
    const spec = veniceEntry.model_spec;
    const capabilities = { ...spec.capabilities, defaultReasoningEffort: "medium" };
    const entry = { ...veniceEntry, model_spec: { ...spec, capabilities } };
    const { fetch: fetchImpl } = fakeFetch(() => jsonResponse({ data: [entry, veniceEntry] }));
    const [withDefault, without] = await listModels(veniceSettings, { fetch: fetchImpl });
    expect(withDefault).toMatchObject({ defaultReasoningEffort: "medium" });
    expect(without).not.toHaveProperty("defaultReasoningEffort");
  });
});

describe("listModels", () => {
  it("maps a Venice entry", async () => {
    const { fetch: fetchImpl } = fakeFetch(() => jsonResponse({ data: [veniceEntry] }));
    expect(await listModels(veniceSettings, { fetch: fetchImpl })).toEqual([
      {
        id: "qwen3-6-27b",
        name: "Qwen 3.6 27B",
        vision: true,
        tools: true,
        reasoning: true,
        reasoningEffortOptions: ["none", "low", "medium", "high"],
        maxImages: 10,
        privacy: "private",
        contextTokens: 256000,
        traits: [],
        uncensored: false,
        recommended: false,
        beta: false,
        videoInput: true,
        audioInput: false,
        e2ee: false,
      },
    ]);
  });

  it("maps a bare entry with permissive defaults", async () => {
    const { fetch: fetchImpl } = fakeFetch(() => jsonResponse({ data: [{ id: "llava:13b" }] }));
    expect(await listModels(localSettings, { fetch: fetchImpl, fallbackMaxImages: 4 })).toEqual([
      {
        id: "llava:13b",
        name: "llava:13b",
        vision: true,
        tools: true,
        reasoning: false,
        reasoningEffortOptions: [],
        maxImages: 4,
        privacy: "unknown",
        traits: [],
        uncensored: false,
        recommended: false,
        beta: false,
        videoInput: false,
        audioInput: false,
        e2ee: false,
      },
    ]);
  });

  it("skips offline models and sorts by name", async () => {
    const entry = (id: string, name: string, offline: boolean) => ({
      id,
      model_spec: { name, offline, capabilities: {} },
    });
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({
        data: [entry("b", "Bravo", false), entry("x", "X", true), entry("a", "Alpha", false)],
      }),
    );
    const models = await listModels(veniceSettings, { fetch: fetchImpl });
    expect(models.map((model) => model.name)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("listModels capabilities", () => {
  it("derives maxImages from the capabilities", async () => {
    const entry = (id: string, capabilities: object) => ({
      id,
      model_spec: { name: id, capabilities },
    });
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({
        data: [
          entry("explicit", { maxImages: 3, supportsMultipleImages: false }),
          entry("single", { supportsMultipleImages: false }),
          entry("multiple", { supportsMultipleImages: true }),
          entry("unstated", {}),
        ],
      }),
    );
    const models = await listModels(veniceSettings, { fetch: fetchImpl });
    const byId = Object.fromEntries(models.map((model) => [model.id, model.maxImages]));
    expect(byId).toEqual({ explicit: 3, single: 1, multiple: 10, unstated: 10 });
  });

  it("uses the fallback maxImages when given", async () => {
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({ data: [{ id: "m", model_spec: { capabilities: {} } }] }),
    );
    const [model] = await listModels(veniceSettings, { fetch: fetchImpl, fallbackMaxImages: 6 });
    expect(model?.maxImages).toBe(6);
  });

  it("falls back to unknown privacy, the id as the name, and no context size", async () => {
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({
        data: [{ id: "m", model_spec: { privacy: "public", capabilities: {} } }],
      }),
    );
    const [model] = await listModels(veniceSettings, { fetch: fetchImpl });
    expect(model).toMatchObject({ name: "m", privacy: "unknown", vision: false, tools: false });
    expect(model).not.toHaveProperty("contextTokens");
  });

  it("maps anonymized privacy", async () => {
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({ data: [{ id: "m", model_spec: { privacy: "anonymized" } }] }),
    );
    const [model] = await listModels(veniceSettings, { fetch: fetchImpl });
    expect(model?.privacy).toBe("anonymized");
  });
});

describe("listModels pricing", () => {
  it("maps pricing only when both input and output carry a USD figure", async () => {
    const entry = (id: string, pricing: unknown) => ({ id, model_spec: { name: id, pricing } });
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({
        data: [
          entry("priced", { input: { usd: 0.7, diem: 7 }, output: { usd: 2.8, diem: 28 } }),
          entry("half", { input: { usd: 0.7 }, output: { diem: 28 } }),
          entry("text", { input: { usd: "0.7" }, output: { usd: 2.8 } }),
          entry("none", undefined),
        ],
      }),
    );
    const models = await listModels(veniceSettings, { fetch: fetchImpl });
    const byId = new Map(models.map((model) => [model.id, model]));
    expect(byId.get("priced")?.pricing).toEqual({ inputPerMTok: 0.7, outputPerMTok: 2.8 });
    expect(byId.get("half")).not.toHaveProperty("pricing");
    expect(byId.get("text")).not.toHaveProperty("pricing");
    expect(byId.get("none")).not.toHaveProperty("pricing");
  });

  it("adds the cache-read rate only when it is a number", async () => {
    const entry = (id: string, cacheInput: unknown) => ({
      id,
      model_spec: {
        name: id,
        pricing: { input: { usd: 3 }, output: { usd: 15 }, cache_input: cacheInput },
      },
    });
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({
        data: [entry("cached", { usd: 0.3, diem: 3 }), entry("text", { usd: "0.3" })],
      }),
    );
    const models = await listModels(veniceSettings, { fetch: fetchImpl });
    const byId = new Map(models.map((model) => [model.id, model]));
    expect(byId.get("cached")?.pricing).toEqual({
      inputPerMTok: 3,
      outputPerMTok: 15,
      cachedInputPerMTok: 0.3,
    });
    expect(byId.get("text")?.pricing).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
  });
});

const qwenEntry = {
  id: "qwen-3-8-27b",
  model_spec: {
    name: "Qwen 3.8 27B",
    betaModel: true,
    uncensored: true,
    traits: ["default_vision"],
    description: "A vision model.",
    capabilities: {
      supportsVision: true,
      supportsVideoInput: true,
      supportsAudioInput: true,
      supportsE2EE: true,
      quantization: "fp8",
    },
  },
};

const uncensoredEntry = {
  id: "venice-uncensored-1-2",
  model_spec: {
    name: "Venice Uncensored 1.2",
    uncensored: true,
    model_sets: ["venice_recommendations"],
    traits: ["most_uncensored"],
    capabilities: { supportsVision: false },
  },
};

describe("listModels traits and flags", () => {
  async function byId(entries: unknown[]): Promise<Map<string, ModelInfo>> {
    const { fetch: fetchImpl } = fakeFetch(() => jsonResponse({ data: entries }));
    const models = await listModels(veniceSettings, { fetch: fetchImpl });
    return new Map(models.map((model) => [model.id, model]));
  }

  it("maps a beta vision model's traits, inputs, description and quantization", async () => {
    const qwen = (await byId([qwenEntry])).get("qwen-3-8-27b");
    expect(qwen).toMatchObject({
      traits: ["default_vision"],
      uncensored: true,
      recommended: false,
      beta: true,
      videoInput: true,
      audioInput: true,
      e2ee: true,
      description: "A vision model.",
      quantization: "fp8",
    });
  });

  it("marks a recommended model, leaving out absent description and quantization", async () => {
    const venice = (await byId([uncensoredEntry])).get("venice-uncensored-1-2");
    expect(venice).toMatchObject({
      traits: ["most_uncensored"],
      uncensored: true,
      recommended: true,
      beta: false,
      videoInput: false,
      audioInput: false,
      e2ee: false,
    });
    expect(venice).not.toHaveProperty("description");
    expect(venice).not.toHaveProperty("quantization");
  });

  it("treats the most_uncensored trait as uncensored, and model_sets beside the spec", async () => {
    const models = await byId([
      { id: "trait", model_spec: { traits: ["most_uncensored", 3] } },
      { id: "outer", model_sets: ["venice_recommendations"], model_spec: { traits: "x" } },
    ]);
    expect(models.get("trait")).toMatchObject({ traits: ["most_uncensored"], uncensored: true });
    expect(models.get("outer")).toMatchObject({ traits: [], uncensored: false, recommended: true });
  });
});

describe("isChatModelId", () => {
  it("rejects embedding, speech, rerank, moderation and image generation ids", () => {
    for (const id of [
      "text-embedding-3-small",
      "nomic-embed-text:latest",
      "tts-1-hd",
      "gpt-4o-mini-tts",
      "whisper-1",
      "gpt-4o-transcribe",
      "bge-reranker-v2",
      "omni-moderation-latest",
      "dall-e-3",
      "gpt-image-1",
      "stable-diffusion-3.5",
      "flux-dev",
    ]) {
      expect(isChatModelId(id), id).toBe(false);
    }
  });

  it("keeps chat and vision models", () => {
    for (const id of ["gpt-4o", "llava:13b", "qwen2.5vl:7b", "google/gemma-3-27b-it", "o4-mini"]) {
      expect(isChatModelId(id), id).toBe(true);
    }
  });
});

describe("listModels requests", () => {
  it("asks Venice for text models only", async () => {
    const venice = fakeFetch(() => jsonResponse({ data: [] }));
    await listModels(veniceSettings, { fetch: venice.fetch });
    expect(venice.calls[0]?.url).toBe(`${VENICE_BASE_URL}/models?type=text`);

    const local = fakeFetch(() => jsonResponse({ data: [] }));
    await listModels(localSettings, { fetch: local.fetch });
    expect(local.calls[0]?.url).toBe("http://localhost:11434/v1/models");
  });

  it("calls no server while the base URL is unset", async () => {
    const unset = fakeFetch(() => jsonResponse({ data: [{ id: "m" }] }));
    expect(await listModels({ baseUrl: " ", apiKey: "" }, { fetch: unset.fetch })).toEqual([]);
    expect(unset.calls).toEqual([]);
  });

  it("drops models that cannot chat on servers other than Venice", async () => {
    const data = [{ id: "llava:13b" }, { id: "nomic-embed-text:latest" }, { id: "whisper-1" }];
    const local = fakeFetch(() => jsonResponse({ data }));
    const ids = (await listModels(localSettings, { fetch: local.fetch })).map((model) => model.id);
    expect(ids).toEqual(["llava:13b"]);
  });

  it("sends the key as a bearer token only when one is set", async () => {
    const withKey = fakeFetch(() => jsonResponse({ data: [] }));
    await listModels(veniceSettings, { fetch: withKey.fetch });
    expect(withKey.calls[0]?.init?.headers).toEqual({ Authorization: "Bearer secret" });

    const withoutKey = fakeFetch(() => jsonResponse({ data: [] }));
    await listModels(localSettings, { fetch: withoutKey.fetch });
    expect(withoutKey.calls[0]?.init?.headers).toEqual({});
  });

  it("throws an ApiError carrying the status and message", async () => {
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({ error: { message: "Invalid API key" } }, 401),
    );
    await expect(listModels(veniceSettings, { fetch: fetchImpl })).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Invalid API key",
    });
  });
});

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

describe("getBalance", () => {
  it("maps the balance, leaving out null figures", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({
        canConsume: true,
        consumptionCurrency: "USD",
        balances: { diem: null, usd: 25.5, bundledCredits: null, earnedCredits: 5 },
        diemEpochAllocation: 0,
      }),
    );
    expect(await getBalance(veniceSettings, fetchImpl)).toEqual({
      canConsume: true,
      consumptionCurrency: "USD",
      usd: 25.5,
      diemAllocation: 0,
      earnedCredits: 5,
    });
    expect(calls[0]?.url).toBe(`${VENICE_BASE_URL}/billing/balance`);
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer secret");
  });

  it("maps a null consumption currency and DIEM figures", async () => {
    const { fetch: fetchImpl } = fakeFetch(() =>
      jsonResponse({
        canConsume: false,
        consumptionCurrency: null,
        balances: { diem: 90.5, usd: null, bundledCredits: 10, earnedCredits: null },
        diemEpochAllocation: 100,
      }),
    );
    expect(await getBalance(veniceSettings, fetchImpl)).toEqual({
      canConsume: false,
      consumptionCurrency: null,
      diem: 90.5,
      diemAllocation: 100,
      bundledCredits: 10,
    });
  });

  it("reports notVenice without a request for another server", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(() => jsonResponse({}));
    expect(await getBalance(localSettings, fetchImpl)).toEqual({ unavailable: "notVenice" });
    expect(calls).toHaveLength(0);
  });

  it.each([401, 403])("reports needsAdminKey for status %d", async (status) => {
    const { fetch: fetchImpl } = fakeFetch(() => jsonResponse({ error: "Forbidden" }, status));
    expect(await getBalance(veniceSettings, fetchImpl)).toEqual({ unavailable: "needsAdminKey" });
  });

  it("reports other failures as errors with their message", async () => {
    const server = fakeFetch(() => jsonResponse({ error: "Upstream down" }, 500));
    expect(await getBalance(veniceSettings, server.fetch)).toEqual({
      unavailable: "error",
      message: "Upstream down",
    });
    const offline: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await getBalance(veniceSettings, offline)).toEqual({
      unavailable: "error",
      message: "Failed to fetch",
    });
  });
});
