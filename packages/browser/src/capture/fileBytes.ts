import type { AbortSignalLike } from "@vid2grid/core";
import { throwIfAborted } from "./abort";

// Bounds each media read, so a long range never pulls a large slice of the file at once.
export const MAX_READ_BYTES = 4 * 1024 * 1024;
// A header read this large usually also covers the small boxes after it.
const WINDOW_BYTES = 4096;

export type ReadBytes = (offset: number, length: number) => Promise<ArrayBuffer>;

export async function readBytes(
  file: File,
  offset: number,
  length: number,
  signal?: AbortSignalLike,
): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  const bytes = await file.slice(offset, offset + length).arrayBuffer();
  throwIfAborted(signal);
  return bytes;
}

// For many small reads close together, such as box headers: each is served from the last window.
export function createWindowedReader(file: File, signal?: AbortSignalLike): ReadBytes {
  let windowOffset = 0;
  let window = new ArrayBuffer(0);
  return async (offset, length) => {
    const isInWindow =
      offset >= windowOffset && offset + length <= windowOffset + window.byteLength;
    if (!isInWindow) {
      if (length > WINDOW_BYTES) return readBytes(file, offset, length, signal);
      window = await readBytes(file, offset, WINDOW_BYTES, signal);
      windowOffset = offset;
    }
    return window.slice(offset - windowOffset, offset - windowOffset + length);
  };
}
