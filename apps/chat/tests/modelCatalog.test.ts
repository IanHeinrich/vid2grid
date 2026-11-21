import { describe, expect, it } from "vitest";
import { isChatModelId, listModels } from "../src/api/modelCatalog";
import { VENICE_BASE_URL } from "../src/api/venice";
import type { ModelInfo } from "../src/types";
import { fakeFetch, jsonResponse, localSettings, veniceSettings } from "./support/apiFakes";

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
