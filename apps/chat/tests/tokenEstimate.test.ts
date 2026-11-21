import { describe, expect, it } from "vitest";
import { estimateRequestTokens } from "../src/chat/tokenEstimate";
import type { ChatRequest } from "../src/types";
import { lookTool } from "./support/requestFixtures";

describe("estimateRequestTokens", () => {
  const request: ChatRequest = {
    model: "m",
    stream: true,
    messages: [
      { role: "system", content: "a".repeat(40) },
      {
        role: "user",
        content: [
          { type: "text", text: "b".repeat(20) },
          { type: "image_url", image_url: { url: "data:x".repeat(1000) } },
          { type: "image_url", image_url: { url: "data:y" } },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "look", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "c".repeat(10) },
    ],
  };

  it("counts text at four characters a token and each image at the model's cost", () => {
    expect(estimateRequestTokens(request, 1024, (side) => side / 2)).toBe(19 + 2 * 512);
  });

  it("falls back to 1500 tokens an image when the cost is unknown", () => {
    expect(estimateRequestTokens(request, 1024)).toBe(19 + 2 * 1500);
  });

  it("counts the tool schemas", () => {
    const withTools = { ...request, tools: [lookTool] };
    const schemaChars = JSON.stringify([lookTool]).length;
    expect(estimateRequestTokens(withTools, 1024)).toBe(
      Math.ceil((76 + schemaChars) / 4) + 2 * 1500,
    );
  });
});
