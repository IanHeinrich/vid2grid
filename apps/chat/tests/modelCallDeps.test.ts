import { describe, expect, it } from "vitest";
import { VENICE_BASE_URL } from "../src/api/venice";
import { modelCallDeps } from "../src/app/modelCallDeps";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState } from "../src/state";
import { replyWith } from "./support/streams";

describe("modelCallDeps", () => {
  it("takes the API from settings and asks for Venice parameters only on Venice", () => {
    const streamChat = replyWith("ok");
    const signal = new AbortController().signal;
    const venice = createAppState({ ...DEFAULT_SETTINGS, baseUrl: VENICE_BASE_URL, apiKey: "k" });
    expect(modelCallDeps(venice, streamChat, "m", signal)).toEqual({
      api: { baseUrl: VENICE_BASE_URL, apiKey: "k" },
      streamChat,
      modelId: "m",
      veniceParameters: true,
      signal,
    });
    const local = createAppState({ ...DEFAULT_SETTINGS, baseUrl: "http://localhost:1234/v1" });
    expect(modelCallDeps(local, streamChat, "m", signal).veniceParameters).toBe(false);
  });
});
