import type { ApiSettings, ModelInfo, Privacy } from "../types";
import { requestHeaders, safeError, throwForStatus } from "./http";
import { asRecord, isRecord, type JsonRecord } from "./json";
import { isVenice, normaliseBaseUrl } from "./venice";

const DEFAULT_MAX_IMAGES = 10;

// Servers other than Venice list every model they host; these ids are never chat models.
const NON_CHAT_ID =
  /(^|[-_/.:])(embed|tts|whisper|transcribe|rerank|moderation|dall-e|gpt-image|image-gen|stable-diffusion|sdxl|flux)/i;

export function isChatModelId(id: string): boolean {
  return !NON_CHAT_ID.test(id);
}

function toPrivacy(value: unknown): Privacy {
  return value === "private" || value === "anonymized" ? value : "unknown";
}

// Venice prices in USD per million tokens.
function toPricing(spec: JsonRecord): ModelInfo["pricing"] {
  const pricing = asRecord(spec["pricing"]);
  const inputPerMTok = asRecord(pricing["input"])["usd"];
  const outputPerMTok = asRecord(pricing["output"])["usd"];
  const cachedInputPerMTok = asRecord(pricing["cache_input"])["usd"];
  return typeof inputPerMTok === "number" && typeof outputPerMTok === "number"
    ? {
        inputPerMTok,
        outputPerMTok,
        ...(typeof cachedInputPerMTok === "number" ? { cachedInputPerMTok } : {}),
      }
    : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toReasoning(
  capabilities: JsonRecord,
): Pick<ModelInfo, "reasoning" | "reasoningEffortOptions" | "defaultReasoningEffort"> {
  const defaultEffort = capabilities["defaultReasoningEffort"];
  return {
    reasoning: capabilities["supportsReasoning"] === true,
    reasoningEffortOptions: stringList(capabilities["reasoningEffortOptions"]),
    ...(typeof defaultEffort === "string" ? { defaultReasoningEffort: defaultEffort } : {}),
  };
}

export function unknownModel(id: string, maxImages: number): ModelInfo {
  return {
    id,
    name: id,
    vision: true,
    tools: true,
    reasoning: false,
    reasoningEffortOptions: [],
    maxImages,
    privacy: "unknown",
    traits: [],
    uncensored: false,
    recommended: false,
    beta: false,
    videoInput: false,
    audioInput: false,
    e2ee: false,
  };
}

function toModelInfo(entry: JsonRecord, fallbackMaxImages: number): ModelInfo | undefined {
  const id = entry["id"];
  if (typeof id !== "string") return undefined;
  const spec = entry["model_spec"];
  if (!isRecord(spec)) {
    return unknownModel(id, fallbackMaxImages);
  }
  if (spec["offline"] === true) return undefined;
  const capabilities = asRecord(spec["capabilities"]);
  const contextTokens = spec["availableContextTokens"];
  const maxImages = capabilities["maxImages"];
  const pricing = toPricing(spec);
  const traits = stringList(spec["traits"]);
  const modelSets = stringList(spec["model_sets"] ?? entry["model_sets"]);
  const { description } = spec;
  const { quantization } = capabilities;
  return {
    id,
    name: typeof spec["name"] === "string" ? spec["name"] : id,
    vision: capabilities["supportsVision"] === true,
    tools: capabilities["supportsFunctionCalling"] === true,
    ...toReasoning(capabilities),
    maxImages:
      typeof maxImages === "number"
        ? maxImages
        : capabilities["supportsMultipleImages"] === false
          ? 1
          : fallbackMaxImages,
    privacy: toPrivacy(spec["privacy"]),
    ...(typeof contextTokens === "number" ? { contextTokens } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
    traits,
    uncensored: spec["uncensored"] === true || traits.includes("most_uncensored"),
    recommended: modelSets.includes("venice_recommendations"),
    beta: spec["betaModel"] === true,
    videoInput: capabilities["supportsVideoInput"] === true,
    audioInput: capabilities["supportsAudioInput"] === true,
    e2ee: capabilities["supportsE2EE"] === true,
    ...(typeof description === "string" ? { description } : {}),
    ...(typeof quantization === "string" ? { quantization } : {}),
  };
}

export async function listModels(
  settings: ApiSettings,
  options: { fetch?: typeof fetch; fallbackMaxImages?: number } = {},
): Promise<ModelInfo[]> {
  if (settings.baseUrl.trim() === "") return [];
  const fetchImpl = options.fetch ?? fetch;
  const fallbackMaxImages = options.fallbackMaxImages ?? DEFAULT_MAX_IMAGES;
  const venice = isVenice(settings.baseUrl);
  const query = venice ? "?type=text" : "";
  let body: unknown;
  try {
    const response = await fetchImpl(`${normaliseBaseUrl(settings.baseUrl)}/models${query}`, {
      headers: requestHeaders(settings, false),
    });
    await throwForStatus(response);
    body = await response.json();
  } catch (error) {
    throw safeError(error, settings);
  }
  const entries = asRecord(body)["data"];
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => toModelInfo(asRecord(entry), fallbackMaxImages))
    .filter((model): model is ModelInfo => model !== undefined)
    .filter((model) => venice || isChatModelId(model.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}
