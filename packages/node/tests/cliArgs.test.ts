import { optionSpecsFor } from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import { NODE_CAPABILITIES, parseCliArgs, USAGE } from "../src/cliArgs";

function optionsOf(argv: string[]) {
  const command = parseCliArgs(argv);
  if (command.kind !== "render") throw new Error("expected a render command");
  return command.options;
}

describe("parseCliArgs", () => {
  it("reads the video and output directory, leaving defaults to core", () => {
    expect(parseCliArgs(["clip.mp4", "-o", "out"])).toEqual({
      kind: "render",
      videoPath: "clip.mp4",
      outDir: "out",
      options: {},
    });
  });

  it("maps every flag the spec offers onto its option name", () => {
    const options = optionsOf([
      "clip.mp4",
      "--out",
      "out",
      "--start",
      "1.5",
      "--end",
      "9",
      "--fps",
      "4",
      "--frames-per-grid",
      "4",
      "--resolution",
      "512",
      "--quality",
      "70",
      "--keyframes",
      "--max-keyframes",
      "6",
      "--frame-count",
      "8",
    ]);
    expect(options).toEqual({
      startSeconds: 1.5,
      endSeconds: 9,
      targetFps: 4,
      framesPerGrid: 4,
      outputResolution: 512,
      jpegQuality: 70,
      keyframeSampling: true,
      maxKeyframes: 6,
      frameCount: 8,
    });
    expect(Object.keys(options).sort()).toEqual(
      optionSpecsFor(NODE_CAPABILITIES)
        .map((spec) => spec.name)
        .sort(),
    );
  });

  it("generates the usage text from the spec", () => {
    for (const spec of optionSpecsFor(NODE_CAPABILITIES)) {
      expect(USAGE).toContain(`--${spec.flag}`);
      expect(USAGE).toContain(spec.help);
    }
    expect(USAGE).not.toContain("--transcript");
  });
});

describe("parseCliArgs input checks", () => {
  it("answers --help without needing a video", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
  });

  it.each([
    [["clip.mp4"], "-o <dir> is required"],
    [["-o", "out"], "expected exactly one video"],
    [["a.mp4", "b.mp4", "-o", "out"], "expected exactly one video"],
    [["clip.mp4", "-o", "out", "--fps", "fast"], '--fps expects a number, got "fast"'],
    [["clip.mp4", "-o", "out", "--fps", ""], '--fps expects a number, got ""'],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
  });

  it("does not offer transcription, which this host lacks", () => {
    expect(() => parseCliArgs(["clip.mp4", "-o", "out", "--transcript", "combined"])).toThrow();
  });
});
