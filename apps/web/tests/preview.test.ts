import { describe, expect, it, vi } from "vitest";
import { previewPlacement } from "../src/ui/preview";

vi.mock("@vid2grid/browser", () => ({}));

const size = { width: 200, height: 120 };

describe("previewPlacement", () => {
  it("centres the preview above the handle", () => {
    const handle = { centerX: 500, sliderTop: 400, sliderBottom: 420 };
    expect(previewPlacement(handle, size, 1200)).toEqual({ left: 400, top: 270 });
  });

  it("keeps the preview inside the viewport edges", () => {
    const nearLeft = { centerX: 20, sliderTop: 400, sliderBottom: 420 };
    const nearRight = { centerX: 1190, sliderTop: 400, sliderBottom: 420 };
    expect(previewPlacement(nearLeft, size, 1200).left).toBe(10);
    expect(previewPlacement(nearRight, size, 1200).left).toBe(990);
  });

  it("drops below the slider when there is no room above", () => {
    const handle = { centerX: 500, sliderTop: 50, sliderBottom: 70 };
    expect(previewPlacement(handle, size, 1200).top).toBe(80);
  });
});
