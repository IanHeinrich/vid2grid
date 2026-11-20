import { describe, expect, it } from "vitest";
import { parseSoundLabel } from "../src/audio/soundLabels";

describe("parseSoundLabel", () => {
  it("makes a plain line its own name and only wording", () => {
    expect(parseSoundLabel("  applause ")).toEqual({ name: "applause", wordings: ["applause"] });
  });

  it("reports the name and prompts with each wording", () => {
    expect(parseSoundLabel("crowd: applause; people clapping their hands ;cheering")).toEqual({
      name: "crowd",
      wordings: ["applause", "people clapping their hands", "cheering"],
    });
  });

  it("drops blank wordings and falls back to the name when none are left", () => {
    expect(parseSoundLabel("music: ; ;")).toEqual({ name: "music", wordings: ["music"] });
    expect(parseSoundLabel("music:")).toEqual({ name: "music", wordings: ["music"] });
  });

  it("names a line with no name after its first wording", () => {
    expect(parseSoundLabel(": footsteps; walking")).toEqual({
      name: "footsteps",
      wordings: ["footsteps", "walking"],
    });
    expect(parseSoundLabel(":")).toEqual({ name: "", wordings: [""] });
  });
});
