import type { ApiSettings, ChatRequest, StreamChat, TokenUsage, WireMessage } from "../types";
import { veniceOptions } from "./venice";

export interface ModelCallDeps {
  api: ApiSettings;
  streamChat: StreamChat;
  modelId: string;
  veniceParameters: boolean;
  signal: AbortSignal;
}

export interface ModelReply {
  text: string;
  usage?: TokenUsage;
}

export function textRequest(
  deps: Pick<ModelCallDeps, "modelId" | "veniceParameters">,
  messages: WireMessage[],
  { usage = false }: { usage?: boolean } = {},
): ChatRequest {
  return {
    model: deps.modelId,
    messages,
    stream: true,
    ...veniceOptions(deps.veniceParameters),
    ...(usage && { stream_options: { include_usage: true } }),
  };
}

// An abort surfaces as an AbortError, so callers tell it apart from "nothing to do".
export async function streamReply(
  deps: Pick<ModelCallDeps, "api" | "streamChat" | "signal">,
  request: ChatRequest,
): Promise<ModelReply> {
  deps.signal.throwIfAborted();
  let text = "";
  let usage: TokenUsage | undefined;
  for await (const event of deps.streamChat(deps.api, request, deps.signal)) {
    if (event.type === "text") text += event.delta;
    if (event.type === "usage") usage = event.usage;
  }
  deps.signal.throwIfAborted();
  return { text: text.trim(), ...(usage !== undefined && { usage }) };
}
