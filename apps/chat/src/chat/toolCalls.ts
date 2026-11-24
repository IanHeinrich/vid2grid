import { orWhenAborted } from "../abort";
import type { ToolCall, ToolMessage, ToolResult } from "../types";
import type { Turn } from "./agentLoop";
import { imagesLookedAt } from "./lookingTurn";

const NO_VIDEO = "No video is attached.";

function roundSuffix(round: number, maxRounds: number): string {
  return ` (Round ${round + 1} of ${maxRounds}. Batch several calls into one round when you can.)`;
}

function runCall({ deps }: Turn, call: ToolCall): Promise<ToolResult> {
  deps.onEvent({ type: "toolStart", call });
  return deps.runTool ? deps.runTool(call) : Promise.resolve({ text: NO_VIDEO, images: [] });
}

interface StartedCall {
  call: ToolCall;
  // Undefined when a stop came before the call's turn to run.
  result: Promise<ToolResult | undefined>;
}

function halted({ deps }: Turn): boolean {
  return deps.signal.aborted || deps.answerNow?.aborted === true;
}

// listen reads audio rather than rendering frames, so it starts at once; renders run one at a time.
function startCalls(turn: Turn, calls: readonly ToolCall[]): StartedCall[] {
  const listening = calls.map((call) => (call.name === "listen" ? runCall(turn, call) : undefined));
  let previous: Promise<ToolResult | undefined> = Promise.resolve(undefined);
  return calls.map((call, index) => {
    const started = listening[index];
    if (started) return { call, result: started };
    previous = previous.then(() => (halted(turn) ? undefined : runCall(turn, call)));
    return { call, result: previous };
  });
}

// Answer now drops whatever is still running, as a stop does, rather than waiting on a render.
function unlessAnsweringNow(
  { deps }: Turn,
  pending: Promise<ToolResult | undefined>,
): Promise<ToolResult | undefined> {
  if (!deps.answerNow) return pending;
  return orWhenAborted(pending, deps.answerNow, undefined);
}

export async function answerToolCalls(
  turn: Turn,
  calls: readonly ToolCall[],
  round: number,
): Promise<boolean> {
  const { deps } = turn;
  const started = startCalls(turn, calls);
  // Results are awaited in order, so one failing after a stop or an earlier failure is never awaited.
  for (const { result } of started) result.catch(() => undefined);
  for (const { call, result: pending } of started) {
    const result = await unlessAnsweringNow(turn, pending);
    // A stop cancels a render, and whatever the call then gives is discarded.
    if (result === undefined || halted(turn)) return false;
    const message: ToolMessage = {
      id: turn.newId(),
      createdAt: turn.now(),
      role: "tool",
      toolCallId: call.id,
      text: result.text + roundSuffix(round, turn.maxRounds),
      images: result.images,
      ...(result.seen ? { seen: result.seen } : {}),
    };
    turn.imagesSent += imagesLookedAt(message);
    turn.messages.push(message);
    await deps.persist(message);
    deps.onEvent({ type: "toolDone", message });
    if (result.note) deps.onEvent({ type: "note", note: result.note });
  }
  return true;
}
