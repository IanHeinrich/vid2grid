import { describe, expect, it, vi } from "vitest";
import { closeImages } from "../src/shared/images";

const bitmap = () => ({ close: vi.fn() });

describe("closeImages", () => {
  it("closes every present image and skips the gaps", () => {
    const first = bitmap();
    const second = bitmap();

    closeImages([first as unknown as ImageBitmap, undefined, second as unknown as ImageBitmap]);

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("accepts a sparse array", () => {
    const only = bitmap();
    const sparse = new Array<ImageBitmap | undefined>(3);
    sparse[1] = only as unknown as ImageBitmap;

    closeImages(sparse);

    expect(only.close).toHaveBeenCalledTimes(1);
  });
});
