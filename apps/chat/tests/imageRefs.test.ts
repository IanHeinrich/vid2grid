import { describe, expect, it } from "vitest";
import { imageLabel, imageStub, recallName } from "../src/imageRefs";
import type { ImageRef } from "../src/types";
import { sheet, overviewSheet, upload } from "./support/requestFixtures";

describe("imageLabel and imageStub", () => {
  it("labels and stubs a sheet", () => {
    const ref = sheet("0002");
    expect(imageLabel(ref)).toBe("grid_0002 from look(60, 90): 1:00 to 1:30, 16 frames");
    expect(imageStub(ref)).toBe(
      '[grid_0002 from look(60, 90): 1:00 to 1:30, 16 frames. Not attached, to stay within the image limit; call recall("grid_0002 from look(60, 90)") to see it again.]',
    );
    expect(imageStub(ref, "earlier")).toBe(
      '[grid_0002 from look(60, 90): 1:00 to 1:30, 16 frames. Sent earlier; call recall("grid_0002 from look(60, 90)") to see it again.]',
    );
  });

  it("recalls a sheet by its name and call, and an upload by its file name", () => {
    expect(recallName(sheet("0002"))).toBe("grid_0002 from look(60, 90)");
    expect(recallName(upload("beach"))).toBe("beach.jpg");
  });

  it("labels a single-frame sheet with one time", () => {
    const ref: ImageRef = {
      id: "f",
      pinned: false,
      source: {
        kind: "sheet",
        call: "frames(1:42)",
        name: "grid_0002",
        startSeconds: 102,
        endSeconds: 102,
        frameCount: 1,
      },
    };
    expect(imageStub(ref)).toBe(
      '[grid_0002 from frames(1:42): 1:42, 1 frame. Not attached, to stay within the image limit; call recall("grid_0002 from frames(1:42)") to see it again.]',
    );
  });

  it("points an overview stub at recall", () => {
    expect(imageStub(overviewSheet("grid_0001"), "earlier")).toContain(
      'Sent earlier; call recall("grid_0001 from overview") to see it again.]',
    );
  });

  it("labels and stubs an upload", () => {
    expect(imageLabel(upload("beach"))).toBe("image beach.jpg");
    const stub = '[image beach.jpg, sent earlier; call recall("beach.jpg") to see it again]';
    expect(imageStub(upload("beach"))).toBe(stub);
    expect(imageStub(upload("beach"), "earlier")).toBe(stub);
  });
});
