import type {
  ApiSettings,
  ChatRequest,
  ModelInfo,
  Privacy,
  StreamEvent,
  TokenUsage,
  ToolCall,
} from "../types";
import { errorText } from "../text";
import { createSseParser } from "./sse";
import { isVenice, normaliseBaseUrl } from "./venice";

const DEFAULT_MAX_IMAGES = 10;
const NO_API_MESSAGE = "Choose an API in Settings first.";
const NO_MODEL_MESSAGE = "Choose a model in Chat settings first.";
const OPEN_THINK = "<think>";
const CLOSE_THINK = "</think>";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

// Servers other than Venice list every model they host; these ids are never chat models.
const NON_CHAT_ID =
  /(^|[-_/.:])(embed|tts|whisper|transcribe|rerank|moderation|dall-e|gpt-image|image-gen|stable-diffusion|sdxl|flux)/i;

export function isChatModelId(id: string): boolean {
  return !NON_CHAT_ID.test(id);
}

function requestHeaders(settings: ApiSettings, json: boolean): Record<string, string> {
  return {
    ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function errorMessageFrom(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const record = asRecord(parsed);
    const error = record["error"];
    if (typeof error === "string") return error;
    const nested = asRecord(error)["message"];
    if (typeof nested === "string") return nested;
    if (typeof record["message"] === "string") return record["message"];
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return body;
}

async function throwForStatus(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.text()).trim();
  throw new ApiError(response.status, errorMessageFrom(body) || response.statusText);
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
  const response = await fetchImpl(`${normaliseBaseUrl(settings.baseUrl)}/models${query}`, {
    headers: requestHeaders(settings, false),
  });
  await throwForStatus(response);
  const entries = asRecord(await response.json())["data"];
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => toModelInfo(asRecord(entry), fallbackMaxImages))
    .filter((model): model is ModelInfo => model !== undefined)
    .filter((model) => venice || isChatModelId(model.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AccountBalance {
  canConsume: boolean;
  consumptionCurrency: string | null;
  usd?: number;
  diem?: number;
  diemAllocation?: number;
  bundledCredits?: number;
  earnedCredits?: number;
}

export type BalanceUnavailable = {
  unavailable: "needsAdminKey" | "notVenice" | "error";
  message?: string;
};

function toAccountBalance(body: unknown): AccountBalance {
  const record = asRecord(body);
  const { usd, diem, bundledCredits, earnedCredits } = asRecord(record["balances"]);
  const currency = record["consumptionCurrency"];
  const diemAllocation = record["diemEpochAllocation"];
  return {
    canConsume: record["canConsume"] === true,
    consumptionCurrency: typeof currency === "string" ? currency : null,
    ...(typeof usd === "number" ? { usd } : {}),
    ...(typeof diem === "number" ? { diem } : {}),
    ...(typeof diemAllocation === "number" ? { diemAllocation } : {}),
    ...(typeof bundledCredits === "number" ? { bundledCredits } : {}),
    ...(typeof earnedCredits === "number" ? { earnedCredits } : {}),
  };
}

// Venice serves billing to admin keys only; an inference key gets 401 or 403.
export async function getBalance(
  settings: ApiSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountBalance | BalanceUnavailable> {
  if (!isVenice(settings.baseUrl)) return { unavailable: "notVenice" };
  try {
    const response = await fetchImpl(`${normaliseBaseUrl(settings.baseUrl)}/billing/balance`, {
      headers: requestHeaders(settings, false),
    });
    if (response.status === 401 || response.status === 403) {
      return { unavailable: "needsAdminKey" };
    }
    await throwForStatus(response);
    return toAccountBalance(await response.json());
  } catch (error) {
    return {
      unavailable: "error",
      message: errorText(error),
    };
  }
}

type ThinkPiece = { kind: "text" | "reasoning"; delta: string };

function partialTagLength(text: string, tag: string): number {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length--) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}

function createThinkSplitter() {
  let inside = false;
  let pending = "";

  function drain(final: boolean): ThinkPiece[] {
    const pieces: ThinkPiece[] = [];
    const emit = (delta: string) => {
      if (delta) pieces.push({ kind: inside ? "reasoning" : "text", delta });
    };
    for (;;) {
      const tag = inside ? CLOSE_THINK : OPEN_THINK;
      const at = pending.indexOf(tag);
      if (at !== -1) {
        emit(pending.slice(0, at));
        pending = pending.slice(at + tag.length);
        inside = !inside;
        continue;
      }
      const held = final ? 0 : partialTagLength(pending, tag);
      emit(pending.slice(0, pending.length - held));
      pending = pending.slice(pending.length - held);
      return pieces;
    }
  }

  return {
    feed(text: string): ThinkPiece[] {
      pending += text;
      return drain(false);
    },
    flush(): ThinkPiece[] {
      return drain(true);
    },
  };
}

interface PartialToolCall {
  id: string;
  name: string;
  arguments: string;
}

function createToolCallAccumulator() {
  const partials = new Map<number, PartialToolCall>();
  // A reused index moves to a new slot when a new id arrives; its id-less fragments follow it there.
  const slotByIndex = new Map<number, number>();
  let lastSlot = -1;

  function nextSlot(): number {
    return Math.max(-1, ...partials.keys()) + 1;
  }

  // Older servers omit index, or send 0 for every call, so the id is what tells calls apart.
  function slotFor(fragment: JsonRecord): number {
    const id = typeof fragment["id"] === "string" ? fragment["id"] : "";
    const explicit = typeof fragment["index"] === "number" ? fragment["index"] : undefined;
    const slot =
      explicit === undefined ? Math.max(lastSlot, 0) : (slotByIndex.get(explicit) ?? explicit);
    const knownId = partials.get(slot)?.id;
    if (!id || !knownId || knownId === id) return slot;
    const moved = nextSlot();
    if (explicit !== undefined) slotByIndex.set(explicit, moved);
    return moved;
  }

  return {
    get size(): number {
      return partials.size;
    },
    add(fragments: unknown[]): void {
      fragments.forEach((entry) => {
        const fragment = asRecord(entry);
        const slot = slotFor(fragment);
        const call = partials.get(slot) ?? { id: "", name: "", arguments: "" };
        const fn = asRecord(fragment["function"]);
        if (typeof fragment["id"] === "string" && fragment["id"] && !call.id) {
          call.id = fragment["id"];
        }
        if (typeof fn["name"] === "string" && fn["name"] && !call.name) call.name = fn["name"];
        if (typeof fn["arguments"] === "string") call.arguments += fn["arguments"];
        partials.set(slot, call);
        lastSlot = slot;
      });
    },
    calls(): ToolCall[] {
      return [...partials.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, call]) => ({
          id: call.id || `call_${index}`,
          name: call.name,
          arguments: call.arguments,
        }));
    },
  };
}

function throwForPayloadError(payload: JsonRecord): void {
  const error = payload["error"];
  if (!isRecord(error)) return;
  const code = error["code"];
  const message = error["message"];
  throw new ApiError(
    typeof code === "number" ? code : 0,
    typeof message === "string" ? message : JSON.stringify(error),
  );
}

function parsePayload(payload: string): JsonRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toTokenUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const promptTokens = value["prompt_tokens"];
  const completionTokens = value["completion_tokens"];
  if (typeof promptTokens !== "number" || typeof completionTokens !== "number") return undefined;
  const reasoningTokens = asRecord(value["completion_tokens_details"])["reasoning_tokens"];
  const cachedTokens = asRecord(value["prompt_tokens_details"])["cached_tokens"];
  return {
    promptTokens,
    completionTokens,
    ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
    ...(typeof cachedTokens === "number" ? { cachedTokens } : {}),
  };
}

function toEvent(piece: ThinkPiece): StreamEvent {
  return piece.kind === "text"
    ? { type: "text", delta: piece.delta }
    : { type: "reasoning", delta: piece.delta };
}

function createReplyReader() {
  const thinkSplitter = createThinkSplitter();
  const toolCalls = createToolCallAccumulator();
  let finishReason: string | null = null;
  let usage: TokenUsage | undefined;
  let sawDone = false;

  return {
    get finished(): boolean {
      return sawDone;
    },
    get complete(): boolean {
      return sawDone || finishReason !== null;
    },
    *read(payload: string): Generator<StreamEvent> {
      if (payload.trim() === "[DONE]") {
        sawDone = true;
        return;
      }
      const parsed = parsePayload(payload);
      if (!parsed) return;
      throwForPayloadError(parsed);
      usage = toTokenUsage(parsed["usage"]) ?? usage;
      const choice = asRecord(Array.isArray(parsed["choices"]) ? parsed["choices"][0] : undefined);
      const delta = asRecord(choice["delta"]);
      const reasoning = delta["reasoning_content"] ?? delta["reasoning"];
      if (typeof reasoning === "string" && reasoning) yield { type: "reasoning", delta: reasoning };
      if (typeof delta["content"] === "string") {
        for (const piece of thinkSplitter.feed(delta["content"])) yield toEvent(piece);
      }
      if (Array.isArray(delta["tool_calls"])) toolCalls.add(delta["tool_calls"]);
      if (typeof choice["finish_reason"] === "string") finishReason = choice["finish_reason"];
    },
    *finish(): Generator<StreamEvent> {
      for (const piece of thinkSplitter.flush()) yield toEvent(piece);
      if (toolCalls.size > 0) yield { type: "toolCalls", calls: toolCalls.calls() };
      if (usage !== undefined) yield { type: "usage", usage };
      yield { type: "done", finishReason };
    },
  };
}

export async function* streamChat(
  settings: ApiSettings,
  request: ChatRequest,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<StreamEvent> {
  if (settings.baseUrl.trim() === "") throw new ApiError(0, NO_API_MESSAGE);
  if (request.model.trim() === "") throw new ApiError(0, NO_MODEL_MESSAGE);
  const response = await fetchImpl(`${normaliseBaseUrl(settings.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: requestHeaders(settings, true),
    body: JSON.stringify(request),
    signal,
  });
  await throwForStatus(response);
  if (!response.body) throw new ApiError(response.status, "The response had no body");

  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reply = createReplyReader();
  const reader = response.body.getReader();
  try {
    while (!reply.finished) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const payload of parser.feed(decoder.decode(value, { stream: true }))) {
        yield* reply.read(payload);
        if (reply.finished) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  if (!reply.complete) throw new ApiError(0, "The connection closed before the reply finished.");
  yield* reply.finish();
}
