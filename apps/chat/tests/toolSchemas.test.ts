import { describe, expect, it } from "vitest";
import { LISTEN_SCHEMA, toolOffer, type ToolSituation } from "../src/video/toolSchemas";

const VIDEO: ToolSituation = { videoLoaded: true, images: true, vision: true, listen: false };
const IMAGES: ToolSituation = { ...VIDEO, videoLoaded: false };

function names(situation: ToolSituation): string[] {
  return toolOffer(situation).tools.map((schema) => schema.function.name);
}

function zoomParameters(situation: ToolSituation): Record<string, unknown> | undefined {
  return toolOffer(situation).tools.find((schema) => schema.function.name === "zoom")?.function
    .parameters;
}

describe("toolOffer", () => {
  it("offers the video tools and zoom with a loaded video", () => {
    expect(names(VIDEO)).toEqual(["look", "frames", "note", "recall", "zoom"]);
    expect(names({ ...VIDEO, images: false })).toEqual(names(VIDEO));
  });

  it("adds listen only alongside audio", () => {
    expect(names({ ...VIDEO, listen: true })).toEqual([...names(VIDEO), "listen"]);
    expect(names({ ...IMAGES, listen: true })).not.toContain("listen");
    expect(LISTEN_SCHEMA.function.description).toContain("at most 10 minutes");
    expect(LISTEN_SCHEMA.function.description).toContain("on the user's machine");
  });

  it("leaves zoom out for a model that cannot see", () => {
    expect(names({ ...VIDEO, vision: false })).toEqual(["look", "frames", "note", "recall"]);
    expect(toolOffer({ ...VIDEO, vision: false }).guidance).not.toContain("zoom");
  });

  it("offers recall and zoom without a loaded video, given images and a model that sees", () => {
    expect(names(IMAGES)).toEqual(["recall", "zoom"]);
    const none = { tools: [], guidance: "" };
    expect(toolOffer({ ...IMAGES, images: false })).toEqual(none);
    expect(toolOffer({ ...IMAGES, vision: false })).toEqual(none);
  });

  it("lets zoom take a time only while the video is loaded", () => {
    const area = ["left", "top", "right", "bottom"];
    expect(zoomParameters(VIDEO)).toMatchObject({ required: area, properties: { t: {} } });
    expect(zoomParameters(IMAGES)).toMatchObject({ required: ["image", ...area] });
    expect(zoomParameters(IMAGES)?.["properties"]).not.toHaveProperty("t");
  });
});

describe("guidance", () => {
  it("tells the model how to use the video tools, leaving the answer style to the voice", () => {
    const { tools, guidance } = toolOffer(VIDEO);
    expect(guidance).toContain("note");
    expect(guidance).toContain("one frames call");
    expect(guidance).toContain("recall one by its stub's name");
    expect(guidance).toContain("If you write to the user before looking");
    expect(guidance).not.toContain("[m:ss]");
    expect(JSON.stringify(tools)).not.toContain("system prompt");
  });

  it("says when and how to zoom", () => {
    const { guidance } = toolOffer(VIDEO);
    expect(guidance).toContain("too small to read, use zoom");
    expect(guidance).toContain("0 to 1000");
    expect(guidance).toContain("From a grid, aim zoom at one frame.");
    expect(guidance).toContain("generous area");
  });

  it("is short and only about images without a loaded video", () => {
    const { guidance } = toolOffer(IMAGES);
    expect(guidance).toContain("recall one by its stub's name");
    expect(guidance).toContain("use zoom");
    expect(guidance).not.toMatch(/video|look|frames|note|grid/);
  });
});

describe("with a looking model", () => {
  const LOOKING: ToolSituation = { ...VIDEO, vision: false, looking: true };

  function properties(situation: ToolSituation, name: string): unknown {
    const found = toolOffer(situation).tools.find((schema) => schema.function.name === name);
    return found?.function.parameters["properties"];
  }

  it("offers ask in place of recall, and zoom whatever the writer sees", () => {
    expect(names(LOOKING)).toEqual(["look", "frames", "note", "ask", "zoom"]);
    expect(names({ ...LOOKING, listen: true }).at(-1)).toBe("listen");
    expect(names({ ...LOOKING, videoLoaded: false })).toEqual(["ask", "zoom"]);
    expect(names({ ...LOOKING, videoLoaded: false, images: false })).toEqual([]);
    expect(names({ ...LOOKING, vision: true })).toEqual(names(LOOKING));
  });

  it("lets look, frames and zoom carry a question, which is never required", () => {
    for (const name of ["look", "frames", "zoom"]) {
      expect(properties(LOOKING, name)).toHaveProperty("question");
      expect(properties(VIDEO, name)).not.toHaveProperty("question");
    }
    expect(properties(LOOKING, "note")).not.toHaveProperty("question");
    expect(properties({ ...LOOKING, videoLoaded: false }, "zoom")).toHaveProperty("question");
    const required = toolOffer(LOOKING).tools.flatMap(({ function: { name, parameters } }) =>
      name === "ask" ? [] : [parameters["required"]],
    );
    expect(required.flat()).not.toContain("question");
  });

  it("says the writer cannot see pictures and should ask rather than guess", () => {
    for (const situation of [LOOKING, { ...LOOKING, videoLoaded: false }]) {
      const { guidance } = toolOffer(situation);
      expect(guidance).toContain("You cannot see pictures yourself.");
      expect(guidance).toContain("call ask with a question and the pictures' names");
      expect(guidance).toContain("use zoom");
      expect(guidance).not.toContain("recall");
    }
    expect(toolOffer(LOOKING).guidance).toContain("use note for anything worth remembering");
  });

  it("changes nothing when it is off", () => {
    expect(toolOffer({ ...VIDEO, looking: false })).toEqual(toolOffer(VIDEO));
    expect(toolOffer({ ...IMAGES, looking: false })).toEqual(toolOffer(IMAGES));
    expect(toolOffer(VIDEO).guidance).toContain(
      "Every frame has its timestamp printed on it.\nOlder images become text stubs; recall one by its stub's name, and use note for anything worth remembering.\nWhen a detail is too small to read, use zoom.",
    );
  });
});
