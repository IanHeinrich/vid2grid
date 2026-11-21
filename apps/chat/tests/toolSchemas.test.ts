import { describe, expect, it } from "vitest";
import { LISTEN_SCHEMA, TOOL_GUIDANCE, TOOL_SCHEMAS, toolSchemas } from "../src/video/toolSchemas";

describe("tool definitions", () => {
  it("offers look, frames, note and recall", () => {
    expect(TOOL_SCHEMAS.map((schema) => schema.function.name)).toEqual([
      "look",
      "frames",
      "note",
      "recall",
    ]);
  });

  it("tells the model how to use them, leaving the answer style to the voice", () => {
    expect(TOOL_GUIDANCE).toContain("note");
    expect(TOOL_GUIDANCE).toContain("one frames call");
    expect(TOOL_GUIDANCE).toContain("recall one by its stub's name");
    expect(TOOL_GUIDANCE).not.toContain("[m:ss]");
    expect(JSON.stringify(TOOL_SCHEMAS)).not.toContain("system prompt");
  });
});

describe("listen", () => {
  it("is offered only alongside audio", () => {
    expect(toolSchemas(false)).toEqual(TOOL_SCHEMAS);
    expect(toolSchemas(true).map((schema) => schema.function.name)).toEqual([
      "look",
      "frames",
      "note",
      "recall",
      "listen",
    ]);
    expect(LISTEN_SCHEMA.function.description).toContain("at most 10 minutes");
    expect(LISTEN_SCHEMA.function.description).toContain("on the user's machine");
  });
});
