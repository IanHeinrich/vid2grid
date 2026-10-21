import { describe, expect, it } from "vitest";
import { rotationFromMatrix } from "../src/probe/rotation";

const ONE = 0x10000;
const W = 0x40000000;

describe("rotationFromMatrix", () => {
  it("reads the identity matrix as no rotation", () => {
    expect(rotationFromMatrix([ONE, 0, 0, 0, ONE, 0, 0, 0, W])).toBe(0);
  });

  it("reads each quarter turn from the a and b elements", () => {
    expect(rotationFromMatrix([0, ONE, 0, -ONE, 0, 0, 0, 0, W])).toBe(90);
    expect(rotationFromMatrix([-ONE, 0, 0, 0, -ONE, 0, 0, 0, W])).toBe(180);
    expect(rotationFromMatrix([0, -ONE, 0, ONE, 0, 0, 0, 0, W])).toBe(270);
  });

  it("snaps a near-quarter angle to the nearest quarter turn", () => {
    const tilt = (10 * Math.PI) / 180;
    const a = Math.round(Math.cos(Math.PI / 2 + tilt) * ONE);
    const b = Math.round(Math.sin(Math.PI / 2 + tilt) * ONE);
    expect(rotationFromMatrix([a, b, 0, -b, a, 0, 0, 0, W])).toBe(90);
  });

  it("accepts the typed arrays a demuxer hands back", () => {
    expect(rotationFromMatrix(Int32Array.from([0, ONE, 0, -ONE, 0, 0, 0, 0, W]))).toBe(90);
  });

  it("treats a missing matrix as unrotated", () => {
    expect(rotationFromMatrix([])).toBe(0);
  });
});
