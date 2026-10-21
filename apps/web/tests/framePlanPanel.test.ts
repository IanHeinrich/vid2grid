import { describe, expect, it, vi } from "vitest";
import { generateLabel } from "../src/ui/framePlanPanel";

vi.mock("@vid2grid/browser", () => ({}));

describe("generateLabel", () => {
  it("falls back to the default label when nothing is planned", () => {
    expect(generateLabel(0, "Generate Grid Images")).toBe("Generate Grid Images");
  });

  it("counts the planned grid images", () => {
    expect(generateLabel(1, "Generate Grid Images")).toBe("Generate 1 Grid Image");
    expect(generateLabel(4, "Generate Grid Images")).toBe("Generate 4 Grid Images");
  });
});
