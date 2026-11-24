import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VIDEOS = resolve(import.meta.dirname, "../../../fixtures/videos");
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
const MAX_SLICE_BYTES = 64 * 1024 * 1024;

export interface SourceFile {
  file: File;
  reads: { offset: number; length: number }[];
  bytesRead(): number;
}

export interface Segment {
  offset: number;
  bytes: Uint8Array;
}

// A file made of these segments and zeros elsewhere, so it can be far larger than memory. Reading
// it whole is an error rather than merely slow.
export function segmentedFile(segments: Segment[], size: number, name = "clip.mp4"): SourceFile {
  const reads: SourceFile["reads"] = [];
  const slice = (start: number, end: number) => {
    const length = Math.min(end, size) - start;
    if (length > MAX_SLICE_BYTES) throw new Error(`Read ${length} bytes at once`);
    reads.push({ offset: start, length });
    const bytes = new Uint8Array(length);
    for (const segment of segments) {
      const from = Math.max(start, segment.offset);
      const to = Math.min(start + length, segment.offset + segment.bytes.length);
      if (from >= to) continue;
      bytes.set(segment.bytes.subarray(from - segment.offset, to - segment.offset), from - start);
    }
    return { arrayBuffer: () => Promise.resolve(bytes.buffer) };
  };
  const arrayBuffer = () => Promise.reject(new Error("Read the whole file"));
  const file = { name, type: "video/mp4", size, slice, arrayBuffer } as unknown as File;
  return { file, reads, bytesRead: () => reads.reduce((total, { length }) => total + length, 0) };
}

export function sourceFile(bytes: Uint8Array, name?: string): SourceFile {
  return segmentedFile([{ offset: 0, bytes }], bytes.length, name);
}

export function fixtureBytes(name: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(readFileSync(resolve(VIDEOS, name)));
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

export function boxBytes(type: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, header.length + body.length);
  header.set(new TextEncoder().encode(type), 4);
  return concatBytes(header, body);
}

export function childBoxes(bytes: Uint8Array): { type: string; bytes: Uint8Array }[] {
  const boxes = [];
  let at = 0;
  while (at < bytes.length) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + at).getUint32(0);
    const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
    boxes.push({ type, bytes: bytes.subarray(at, at + size) });
    at += size;
  }
  return boxes;
}

// The movie box for media moved by `shift` bytes, with 64-bit chunk offsets.
export function relocatedMovie(box: Uint8Array, shift: number, type = "moov"): Uint8Array {
  if (CONTAINERS.has(type)) {
    const children = childBoxes(box.subarray(8));
    return boxBytes(
      type,
      concatBytes(...children.map((child) => relocatedMovie(child.bytes, shift, child.type))),
    );
  }
  if (type !== "stco") return box;
  const view = new DataView(box.buffer, box.byteOffset, box.byteLength);
  const count = view.getUint32(12);
  const body = new DataView(new ArrayBuffer(8 + count * 8));
  body.setUint32(4, count);
  for (let i = 0; i < count; i++) {
    body.setBigUint64(8 + i * 8, BigInt(view.getUint32(16 + i * 4) + shift));
  }
  return boxBytes("co64", new Uint8Array(body.buffer));
}
