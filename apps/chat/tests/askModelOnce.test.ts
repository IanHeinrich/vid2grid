import { describe, expect, it } from "vitest";
import { VENICE_BASE_URL } from "../src/api/venice";
import type { ChatRequest, StreamChat } from "../src/types";
import { askModelOnce } from "../src/ui/settings/askModelOnce";

const API = { baseUrl: "http://localhost:5001/v1", apiKey: "k" };

describe("askModelOnce", () => {
  it("sends a few words with no picture, and leaves once the answer begins", async () => {
    const requests: ChatRequest[] = [];
    let read = 0;
    let stopped: AbortSignal | undefined;
    const stream: StreamChat = async function* (_api, request, signal) {
      requests.push(request);
      stopped = signal;
      await Promise.resolve();
      for (;;) {
        read += 1;
        yield { type: "text", delta: "OK" };
      }
    };
    await askModelOnce(API, "eyes", stream);
    expect(read).toBe(1);
    expect(stopped?.aborted).toBe(true);
    expect(requests[0]).toMatchObject({
      model: "eyes",
      messages: [{ role: "user", content: "Reply with OK." }],
    });
    expect(requests[0]).not.toHaveProperty("venice_parameters");
    await askModelOnce({ ...API, baseUrl: VENICE_BASE_URL }, "eyes", stream);
    expect(requests[1]).toHaveProperty("venice_parameters");
  });

  it("rejects with what the server said", async () => {
    const stream: StreamChat = async function* () {
      await Promise.resolve();
      if (API.apiKey !== "") throw new Error("offline");
      yield { type: "text", delta: "" };
    };
    await expect(askModelOnce(API, "eyes", stream)).rejects.toThrow("offline");
  });
});
