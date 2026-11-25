import type { ReadBytes } from "./fileBytes";

export interface BoxHeader {
  type: string;
  size: number;
}

export interface TopLevelBox extends BoxHeader {
  offset: number;
}

const BOX_SIZE_TO_END_OF_FILE = 0;
const BOX_SIZE_IS_64_BIT = 1;
const BOX_TYPE_OFFSET = 4;
const BOX_TYPE_LENGTH = 4;
const LARGE_SIZE_OFFSET = 8;
const MAX_32_BIT_SIZE = 0xffffffff;
const BOX_HEADER_BYTES = 8;
const LARGE_BOX_HEADER_BYTES = 16;

export function readBoxHeader(view: DataView, bytesToEndOfFile: number): BoxHeader | null {
  if (view.byteLength < BOX_HEADER_BYTES) return null;
  const typeCodes = Array.from({ length: BOX_TYPE_LENGTH }, (_, index) =>
    view.getUint8(BOX_TYPE_OFFSET + index),
  );
  const type = String.fromCharCode(...typeCodes);
  const declared = view.getUint32(0);
  if (declared === BOX_SIZE_TO_END_OF_FILE) return { type, size: bytesToEndOfFile };
  if (declared !== BOX_SIZE_IS_64_BIT) {
    return declared < BOX_HEADER_BYTES ? null : { type, size: declared };
  }
  if (view.byteLength < LARGE_BOX_HEADER_BYTES) return null;
  const size = Number(view.getBigUint64(LARGE_SIZE_OFFSET));
  return size < LARGE_BOX_HEADER_BYTES ? null : { type, size };
}

export function writeBoxHeader({ type, size }: BoxHeader): ArrayBuffer {
  const isLarge = size > MAX_32_BIT_SIZE;
  const view = new DataView(new ArrayBuffer(isLarge ? LARGE_BOX_HEADER_BYTES : BOX_HEADER_BYTES));
  view.setUint32(0, isLarge ? BOX_SIZE_IS_64_BIT : size);
  [...type].forEach((char, index) => view.setUint8(BOX_TYPE_OFFSET + index, char.charCodeAt(0)));
  if (isLarge) view.setBigUint64(LARGE_SIZE_OFFSET, BigInt(size));
  return view.buffer;
}

export async function* topLevelBoxes(
  read: ReadBytes,
  fileSize: number,
  fromOffset = 0,
): AsyncGenerator<TopLevelBox, void, undefined> {
  let offset = fromOffset;
  while (offset + BOX_HEADER_BYTES <= fileSize) {
    const length = Math.min(LARGE_BOX_HEADER_BYTES, fileSize - offset);
    const header = readBoxHeader(new DataView(await read(offset, length)), fileSize - offset);
    if (!header) return;
    yield { ...header, offset };
    offset += header.size;
  }
}
