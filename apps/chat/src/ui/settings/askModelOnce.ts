import { streamChat } from "../../api/client";
import { textRequest } from "../../api/modelCall";
import { isVenice } from "../../api/venice";
import type { ApiSettings, StreamChat } from "../../types";

// The smallest real request: a few words, no pictures, and left once the answer begins.
export async function askModelOnce(
  api: ApiSettings,
  modelId: string,
  stream: StreamChat = streamChat,
): Promise<void> {
  const controller = new AbortController();
  const model = { modelId, veniceParameters: isVenice(api.baseUrl) };
  const request = textRequest(model, [{ role: "user", content: "Reply with OK." }]);
  const events = stream(api, request, controller.signal)[Symbol.asyncIterator]();
  try {
    await events.next();
  } finally {
    controller.abort();
    await events.return?.();
  }
}
