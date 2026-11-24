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
