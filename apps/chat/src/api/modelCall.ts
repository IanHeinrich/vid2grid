import type { ApiSettings, ChatRequest, StreamChat, WireMessage } from "../types";

export interface ModelCallDeps {
  api: ApiSettings;
  streamChat: StreamChat;
  modelId: string;
  veniceParameters: boolean;
  signal: AbortSignal;
}

export function textRequest(
  deps: Pick<ModelCallDeps, "modelId" | "veniceParameters">,
  messages: WireMessage[],
): ChatRequest {
  return {
    model: deps.modelId,
    messages,
    stream: true,
    ...(deps.veniceParameters && {
      venice_parameters: { include_venice_system_prompt: false },
    }),
  };
}

// An abort surfaces as an AbortError, so callers tell it apart from "nothing to do".
export async function streamReply(deps: ModelCallDeps, request: ChatRequest): Promise<string> {
  deps.signal.throwIfAborted();
  let reply = "";
  for await (const event of deps.streamChat(deps.api, request, deps.signal)) {
    if (event.type === "text") reply += event.delta;
  }
  deps.signal.throwIfAborted();
  return reply.trim();
}
