import { ApiError } from "../api/http";
import { addUsage } from "../api/usage";
import type { AssistantMessage, ChatRequest, TokenUsage } from "../types";
import type { RoundResult, Turn } from "./agentLoop";
import { parseGemmaToolCalls } from "./gemmaToolCalls";
import type { Streamed } from "./streamRound";
import { stripToolMarkup } from "./toolMarkup";

function callableTools({ tools, tool_choice }: ChatRequest): ReadonlySet<string> {
  if (tools === undefined || tool_choice === "none") return new Set();
  return new Set(tools.map((tool) => tool.function.name));
}

// Local servers sometimes pass a model's native call syntax through as text instead of parsing it.
// Only the text before the first call stays: after it, the model may answer a response it made up.
export function withTextCalls(
  turn: Turn,
  { message, ending, prepared }: RoundResult,
): AssistantMessage {
  if (ending.kind !== "complete" || message.toolCalls.length > 0) return message;
  const parsed = parseGemmaToolCalls(message.text);
  if (parsed.kind !== "calls") return message;
  const callable = callableTools(prepared.request);
  if (!parsed.calls.every((call) => callable.has(call.name))) return message;
  const toolCalls = parsed.calls.map((call) => ({ id: turn.newId(), ...call }));
  return { ...message, text: stripToolMarkup(parsed.before).text.trim(), toolCalls };
}

export function onlyToolMarkup({ message, ending, prepared }: RoundResult): boolean {
  if (ending.kind !== "complete" || prepared.request.tool_choice !== "none") return false;
  const { text, stripped } = stripToolMarkup(message.text);
  return stripped && text === "";
}

// A template may need the tools listed to render the history's tool calls, and refuse without them.
export function refusedWithoutTools({ ending, producedNothing }: Streamed): boolean {
  return ending.kind === "failed" && producedNothing && ending.error instanceof ApiError;
}

export function writtenAnswer(
  first: RoundResult,
  answer: RoundResult,
  spent: readonly AssistantMessage[],
): RoundResult {
  const usage = [...spent, answer.message].reduce<TokenUsage | undefined>(
    (total, message) => addUsage(total, message.usage),
    undefined,
  );
  const message = { ...answer.message, ...(usage ? { usage } : {}) };
  const unanswered = answer.ending.kind === "complete" && stripToolMarkup(message.text).text === "";
  return {
    ...(first.answeredNow ? { answeredNow: first.answeredNow } : {}),
    ...answer,
    message,
    ...(unanswered ? { triedToLookAgain: true as const } : {}),
  };
}
