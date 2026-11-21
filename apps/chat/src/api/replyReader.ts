import type { StreamEvent, TokenUsage, ToolCall } from "../types";
import { ApiError } from "./http";
import { asRecord, isRecord, type JsonRecord } from "./json";
import { createThinkSplitter, type ThinkPiece } from "./think";

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

export function createReplyReader() {
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
