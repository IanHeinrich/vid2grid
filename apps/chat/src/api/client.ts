import type { ApiSettings, ChatRequest, StreamEvent } from "../types";
import { ApiError, requestHeaders, safeError, throwForStatus } from "./http";
import { createReplyReader } from "./replyReader";
import { createSseParser } from "./sse";
import { normaliseBaseUrl } from "./venice";

export { getBalance, type AccountBalance, type BalanceUnavailable } from "./accountBalance";
export { ApiError } from "./http";
export { isChatModelId, listModels, unknownModel } from "./modelCatalog";

const NO_API_MESSAGE = "Choose an API in Settings first.";
const NO_MODEL_MESSAGE = "Choose a model in Chat settings first.";

export async function* streamChat(
  settings: ApiSettings,
  request: ChatRequest,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<StreamEvent> {
  try {
    yield* streamReply(settings, request, signal, fetchImpl);
  } catch (error) {
    throw safeError(error, settings);
  }
}

async function* streamReply(
  settings: ApiSettings,
  request: ChatRequest,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
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
