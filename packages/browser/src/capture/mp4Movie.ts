// Reads a movie's boxes and leaves its media where it is: the top-level boxes are walked header
// by header, and mp4box only ever sees the ftyp, the moov and any moofs.
import { createFile, MP4BoxBuffer, type ISOFile, type Movie } from "mp4box";
import type { AbortSignalLike } from "@vid2grid/core";
import { createWindowedReader } from "./fileBytes";
import { topLevelBoxes, writeBoxHeader, type TopLevelBox } from "./mp4Boxes";

const FILE_TYPE_BOX = "ftyp";
const MOVIE_BOX = "moov";
const FRAGMENT_BOX = "moof";
const MEDIA_BOX = "mdat";

export interface ParsedMovie {
  isoFile: ISOFile;
  movie: Movie;
  movieEndOffset: number;
  appendedBytes: number;
}

function boxEnd(box: TopLevelBox): number {
  return box.offset + box.size;
}

// Sample offsets are absolute, so the moov parses the same wherever it is appended. The ftyp goes
// first because getInfo reads the brand from it.
export async function readMovie(file: File, signal?: AbortSignalLike): Promise<ParsedMovie | null> {
  const read = createWindowedReader(file, signal);
  let typeBox: TopLevelBox | undefined;
  let movieBox: TopLevelBox | undefined;
  for await (const box of topLevelBoxes(read, file.size)) {
    if (box.type === FILE_TYPE_BOX) typeBox = box;
    if (box.type === MOVIE_BOX) movieBox = box;
    if (movieBox) break;
  }
  if (!typeBox || !movieBox || boxEnd(movieBox) > file.size) return null;

  const bytes = new Uint8Array(typeBox.size + movieBox.size);
  bytes.set(new Uint8Array(await read(typeBox.offset, typeBox.size)));
  bytes.set(new Uint8Array(await read(movieBox.offset, movieBox.size)), typeBox.size);
  const isoFile = createFile();
  let parseFailed = false;
  isoFile.onError = () => {
    parseFailed = true;
  };
  isoFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes.buffer, 0));
  isoFile.flush();
  if (parseFailed) return null;
  return {
    isoFile,
    movie: isoFile.getInfo(),
    movieEndOffset: boxEnd(movieBox),
    appendedBytes: bytes.byteLength,
  };
}

// A moof's sample offsets are relative to where it sits, so each is appended at its own offset. An
// mdat header stands in for the bytes between, which mp4box skips as media it never needs.
export async function appendFragments(
  file: File,
  { isoFile, movieEndOffset, appendedBytes }: ParsedMovie,
): Promise<void> {
  const read = createWindowedReader(file);
  let appendedEnd = appendedBytes;
  for await (const box of topLevelBoxes(read, file.size, movieEndOffset)) {
    if (box.type !== FRAGMENT_BOX || boxEnd(box) > file.size) continue;
    const gap = box.offset - appendedEnd;
    if (gap > 0) {
      const skipped = writeBoxHeader({ type: MEDIA_BOX, size: gap });
      isoFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(skipped, appendedEnd));
    }
    const bytes = await read(box.offset, box.size);
    isoFile.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes, box.offset));
    appendedEnd = boxEnd(box);
  }
  isoFile.flush();
}
