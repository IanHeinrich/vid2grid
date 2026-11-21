import type { ChatRequest, StreamChat, StreamEvent } from "../../src/types";

export function replyWith(reply: string, requests: ChatRequest[] = []): StreamChat {
  return async function* (_settings, request) {
    await Promise.resolve();
    requests.push(request);
    yield { type: "text", delta: reply };
    yield { type: "done", finishReason: "stop" };
  };
}

export function scriptedReplies(replies: (string | Error)[], requests: ChatRequest[]): StreamChat {
  const queue = [...replies];
  return async function* (_settings, request) {
    await Promise.resolve();
    requests.push(request);
    const reply = queue.shift() ?? "";
    if (reply instanceof Error) throw reply;
    yield { type: "text", delta: reply };
    yield { type: "done", finishReason: "stop" };
  };
}

function untilAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve()));
}

export async function* waitForAbort(signal: AbortSignal): AsyncGenerator<StreamEvent> {
  await untilAbort(signal);
  yield { type: "done", finishReason: null };
}

export async function* textThenWait(signal: AbortSignal): AsyncGenerator<StreamEvent> {
  yield { type: "text", delta: "Partial" };
  await untilAbort(signal);
  yield { type: "done", finishReason: null };
}
