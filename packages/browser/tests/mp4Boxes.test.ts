import { describe, expect, it } from "vitest";
import { readBoxHeader, topLevelBoxes, writeBoxHeader } from "../src/capture/mp4Boxes";

function header(size: number, type: string, largeSize?: number): DataView {
  const view = new DataView(new ArrayBuffer(16));
  view.setUint32(0, size);
  [...type].forEach((char, index) => view.setUint8(4 + index, char.charCodeAt(0)));
  if (largeSize !== undefined) view.setBigUint64(8, BigInt(largeSize));
  return view;
}

describe("readBoxHeader", () => {
  it("reads a box's size and type", () => {
    expect(readBoxHeader(header(1234, "moov"), 9999)).toEqual({ type: "moov", size: 1234 });
  });

  it("runs a size-zero box to the end of the file", () => {
    expect(readBoxHeader(header(0, "mdat"), 500)).toEqual({ type: "mdat", size: 500 });
  });

  it("reads a 64-bit size", () => {
    expect(readBoxHeader(header(1, "mdat", 2 ** 33), 0)).toEqual({ type: "mdat", size: 2 ** 33 });
  });

  it("rejects a header too short or too small to be a box", () => {
    expect(readBoxHeader(new DataView(new ArrayBuffer(4)), 10)).toBeNull();
    expect(readBoxHeader(header(4, "free"), 10)).toBeNull();
    expect(readBoxHeader(header(1, "mdat", 8), 10)).toBeNull();
    expect(readBoxHeader(new DataView(header(1, "mdat").buffer, 0, 8), 10)).toBeNull();
  });
});

describe("writeBoxHeader", () => {
  it.each([8, 0xffffffff, 2 ** 33])("writes a header that reads back with size %i", (size) => {
    const header = { type: "mdat", size };
    expect(readBoxHeader(new DataView(writeBoxHeader(header)), 0)).toEqual(header);
  });
});

describe("topLevelBoxes", () => {
  it("walks the boxes by their headers alone, 64-bit sizes included", async () => {
    const boxes = [
      { type: "ftyp", size: 24, offset: 0 },
      { type: "mdat", size: 2 ** 33, offset: 24 },
      { type: "moov", size: 100, offset: 24 + 2 ** 33 },
    ];
    const read = (offset: number, length: number) => {
      const box = boxes.find((candidate) => candidate.offset === offset);
      const bytes = new Uint8Array(length);
      if (box) bytes.set(new Uint8Array(writeBoxHeader(box)));
      return Promise.resolve(bytes.buffer);
    };

    const walked = [];
    for await (const box of topLevelBoxes(read, 124 + 2 ** 33)) walked.push(box);

    expect(walked).toEqual(boxes);
  });
});
