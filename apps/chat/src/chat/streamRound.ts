import { isAbortError } from "../abort";
import { splitThink } from "../api/think";
import type { AssistantMessage, StreamEvent, TokenUsage, ToolCall } from "../types";
import type { AnswerNowReason, PreparedRequest, Turn, TurnDeps } from "./agentLoop";
import { reasoningLimit, reasoningLoopWatch } from "./reasoningWatch";
import { requestImageCount } from "./tokenEstimate";

export type StreamEnding =
  | { kind: "complete" }
  | { kind: "aborted" }
  | { kind: "failed"; error: unknown }
  | { kind: "cut"; reason: AnswerNowReason };

export interface Streamed {
  message: AssistantMessage;
  producedNothing: boolean;
  ending: StreamEnding;
}

interface StreamCutter {
  signal: AbortSignal;
  reason(): AnswerNowReason | undefined;
  cut(reason: AnswerNowReason): void;
}

// Its own signal, so a cut ends only this stream while a stop still ends it too.
function streamCutter(deps: TurnDeps, watch: boolean): StreamCutter {
  const own = new AbortController();
  let reason: AnswerNowReason | undefined;
  const cut = (why: AnswerNowReason) => {
    reason ??= why;
    own.abort();
  };
  const answerNow = watch ? deps.answerNow : undefined;
  if (answerNow?.aborted) cut("user");
  else answerNow?.addEventListener("abort", () => cut("user"), { once: true });
  return { signal: AbortSignal.any([deps.signal, own.signal]), reason: () => reason, cut };
}

function joinReasoning(earlier: string, latest: string | undefined): string {
  return [earlier, latest ?? ""].filter((part) => part !== "").join("\n\n");
}

export interface StreamOptions {
  // Watch for a reasoning loop and for Answer now; off for the answer-now retry itself.
  watch: boolean;
  // The stream this one retries: its id and reasoning carry over, marked as cut short.
  cut?: AssistantMessage;
  // The stream this one carries on from: its id and reasoning carry over.
  continues?: AssistantMessage;
  // A stream the server refused, whose id this one takes over.
  retried?: AssistantMessage;
}

interface StreamedParts {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
}

function isEmpty({ text, reasoning, toolCalls }: StreamedParts): boolean {
  return text === "" && reasoning === "" && toolCalls.length === 0;
}

// True when the event changed what the message shows.
function applyEvent(parts: StreamedParts, event: StreamEvent): boolean {
  switch (event.type) {
    case "text":
      parts.text += event.delta;
      return true;
    case "reasoning":
      parts.reasoning += event.delta;
      return true;
    case "toolCalls":
      parts.toolCalls = [...parts.toolCalls, ...event.calls];
      return false;
    case "usage":
      parts.usage = event.usage;
      return true;
    case "done":
      return false;
  }
}

function streamedMessage(
  base: Pick<AssistantMessage, "id" | "createdAt" | "role">,
  parts: StreamedParts,
  { cut, continues }: StreamOptions,
): AssistantMessage {
  const split = splitThink(parts.text, parts.reasoning);
  const thought = joinReasoning((cut ?? continues)?.reasoning ?? "", split.reasoning);
  return {
    ...base,
    text: split.text,
    ...(thought !== "" || split.reasoning !== undefined ? { reasoning: thought } : {}),
    toolCalls: parts.toolCalls,
    ...(parts.usage ? { usage: parts.usage } : {}),
    ...(cut ? { reasoningCutShort: true as const } : {}),
  };
}

export async function streamAssistant(
  turn: Turn,
  { request, estimatedTokens }: PreparedRequest,
  round: number,
  options: StreamOptions,
): Promise<Streamed> {
  const { deps } = turn;
  const { watch, cut, continues, retried } = options;
  turn.imagesSent += requestImageCount(request);
  const earlier = cut ?? continues ?? retried;
  const base = earlier
    ? { id: earlier.id, createdAt: earlier.createdAt, role: "assistant" as const }
    : { id: turn.newId(), createdAt: turn.now(), role: "assistant" as const };
  const parts: StreamedParts = { text: "", reasoning: "", toolCalls: [] };
  const current = () => streamedMessage(base, parts, options);
  const streamed = (ending: StreamEnding): Streamed => ({
    message: current(),
    producedNothing: isEmpty(parts),
    ending,
  });
  const looping = reasoningLoopWatch(reasoningLimit(turn.thoroughness));
  const cutter = streamCutter(deps, watch);
  deps.onEvent({ type: "assistantStart", message: current() });
  deps.onEvent({
    type: "requestStart",
    round: round + 1,
    images: requestImageCount(request),
    estimatedTokens,
  });
  try {
    if (!cutter.signal.aborted) {
      for await (const event of deps.streamChat(deps.api, request, cutter.signal)) {
        const changed = applyEvent(parts, event);
        const answering = parts.text !== "" || parts.toolCalls.length > 0;
        if (watch && event.type === "reasoning" && !answering && looping(event.delta)) {
          cutter.cut("loop");
        }
        if (changed) deps.onEvent({ type: "assistantDelta", message: current() });
        if (cutter.signal.aborted) break;
      }
    }
  } catch (error) {
    return streamed(failedEnding(deps, cutter, error));
  }
  return streamed(settledEnding(deps, cutter));
}

function settledEnding(deps: TurnDeps, cutter: StreamCutter): StreamEnding {
  if (deps.signal.aborted) return { kind: "aborted" };
  const reason = cutter.reason();
  return reason ? { kind: "cut", reason } : { kind: "complete" };
}

function failedEnding(deps: TurnDeps, cutter: StreamCutter, error: unknown): StreamEnding {
  if (!deps.signal.aborted && !isAbortError(error)) return { kind: "failed", error };
  const ending = settledEnding(deps, cutter);
  return ending.kind === "cut" ? ending : { kind: "aborted" };
}
