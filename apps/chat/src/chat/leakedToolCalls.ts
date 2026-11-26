import { ApiError } from "../api/http";
import { addUsage } from "../api/usage";
import type { AssistantMessage, ChatRequest } from "../types";
import type { RoundResult, Turn } from "./agentLoop";
import { parseGemmaToolCalls } from "./gemmaToolCalls";
import { streamAssistant, type Streamed } from "./streamRound";
import { requestImageCount } from "./tokenEstimate";
import { stripToolMarkup } from "./toolMarkup";

function callableTools({ tools, tool_choice }: ChatRequest): ReadonlySet<string> {
  if (tools === undefined || tool_choice === "none") return new Set();
  return new Set(tools.map((tool) => tool.function.name));
}

// Local servers sometimes pass a model's native call syntax through as text instead of parsing it.
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
  return { ...message, text: stripToolMarkup(message.text).text, toolCalls };
}

function onlyToolMarkup({ message, ending, prepared }: RoundResult): boolean {
  if (ending.kind !== "complete" || prepared.request.tool_choice !== "none") return false;
  const { text, stripped } = stripToolMarkup(message.text);
  return stripped && text === "";
}

// With no tools listed, a chat template has nothing to invite a call with.
function withoutTools(request: ChatRequest): ChatRequest {
  const written = { ...request };
  delete written.tools;
  delete written.tool_choice;
  return written;
}

// A template may need the tools listed to render the history's tool calls, and refuse without them.
function refused({ ending, producedNothing }: Streamed): boolean {
  return ending.kind === "failed" && producedNothing && ending.error instanceof ApiError;
}

export async function askForWrittenAnswer(
  turn: Turn,
  first: RoundResult,
  round: number,
): Promise<RoundResult> {
  if (!onlyToolMarkup(first)) return first;
  const prepared = { ...first.prepared, request: withoutTools(first.prepared.request) };
  const second = await streamAssistant(turn, prepared, round, {
    watch: false,
    retried: first.message,
  });
  if (refused(second)) {
    turn.imagesSent -= requestImageCount(prepared.request);
    return first;
  }
  const usage = addUsage(first.message.usage, second.message.usage);
  const message = { ...second.message, ...(usage ? { usage } : {}) };
  const unanswered = second.ending.kind === "complete" && stripToolMarkup(message.text).text === "";
  return {
    ...second,
    message,
    prepared,
    ...(first.answeredNow ? { answeredNow: first.answeredNow } : {}),
    ...(unanswered ? { triedToLookAgain: true as const } : {}),
  };
}
