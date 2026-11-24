import { createFile, MP4BoxBuffer } from "mp4box";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countKeyframesInRange,
  demuxCached,
  readFrameTimestamps,
  readKeyframeTimestamps,
} from "../src/capture/videoDemuxer";
import { writeBoxHeader } from "../src/capture/mp4Boxes";
import type { VideoSample } from "../src/capture/videoSamples";
import {
  boxBytes,
  childBoxes,
  concatBytes,
  fixtureBytes,
  relocatedMovie,
  segmentedFile,
  sourceFile,
} from "./sourceFile";

const MEDIA_SHIFT = 5 * 2 ** 30;
const MAX_METADATA_BYTES = 32 * 1024;
const movieLast = fixtureBytes("keyframes-20s.mp4");

function topLevel(bytes: Uint8Array, type: string): Uint8Array {
  const box = childBoxes(bytes).find((candidate) => candidate.type === type);
  if (!box) throw new Error(`The fixture has no ${type}`);
  return box.bytes;
}

const ftyp = topLevel(movieLast, "ftyp");
const free = topLevel(movieLast, "free");
const mdat = topLevel(movieLast, "mdat");
const moov = topLevel(movieLast, "moov");

const padding = boxBytes("free", new Uint8Array(2 ** 20));

function movieFirst(): Uint8Array {
  const shift = relocatedMovie(moov, 0).length + padding.length;
  return concatBytes(ftyp, relocatedMovie(moov, shift), padding, free, mdat);
}

// One moof and mdat per sample, over an empty moov and no edit list.
function fragmented(): Uint8Array {
  const source = createFile(true);
  const target = createFile();
  source.onReady = ({ videoTracks: [track] }) => {
    if (!track) throw new Error("The fixture has no video track");
    const avcC = topLevel(sampleEntry(), "avcC");
    target.addTrack({
      id: track.id,
      timescale: track.timescale,
      width: 160,
      height: 120,
      avcDecoderConfigRecord: avcC.slice(8).buffer,
    });
    source.onSamples = (_id, _user, samples) => {
      for (const { data, cts, dts, duration, is_sync } of samples) {
        if (data) target.addSample(track.id, data, { cts, dts, duration, is_sync });
      }
    };
    source.setExtractionOptions(track.id, undefined, { nbSamples: track.nb_samples });
    source.start();
  };
  source.appendBuffer(MP4BoxBuffer.fromArrayBuffer(movieLast.slice().buffer, 0));
  return new Uint8Array(target.getBuffer().buffer);
}

const FULL_BOX_BYTES = 8 + 8;
const VISUAL_ENTRY_BYTES = 8 + 78;

function sampleEntry(): Uint8Array {
  const stsd = ["trak", "mdia", "minf", "stbl", "stsd"].reduce(
    (box, type) => topLevel(box.subarray(8), type),
    moov,
  );
  return stsd.subarray(FULL_BOX_BYTES + VISUAL_ENTRY_BYTES);
}

beforeEach(() => {
  vi.stubGlobal("VideoDecoder", class {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const everyTenth = Array.from({ length: 200 }, (_, i) => i / 10);
const everySecond = Array.from({ length: 20 }, (_, i) => i);

describe("demuxing by ranges", () => {
  it.each([
    ["after", concatBytes(ftyp, padding, free, mdat, relocatedMovie(moov, padding.length))],
    ["before", movieFirst()],
  ])("reads a movie stored %s its media without the media", async (_where, bytes) => {
    const source = sourceFile(bytes);

    expect(await readFrameTimestamps(source.file)).toEqual(everyTenth);
    expect(await readKeyframeTimestamps(source.file)).toEqual(everySecond);
    expect(source.bytesRead()).toBeLessThan(MAX_METADATA_BYTES);
  });

  it("reads a small share of a file over 4 GB whose offsets are 64-bit", async () => {
    const largeMdat = writeBoxHeader({ type: "mdat", size: mdat.length + MEDIA_SHIFT });
    const head = concatBytes(ftyp, free, new Uint8Array(largeMdat));
    const mediaOffset = ftyp.length + free.length + MEDIA_SHIFT;
    const movie = relocatedMovie(moov, MEDIA_SHIFT);
    const source = segmentedFile(
      [
        { offset: 0, bytes: head },
        { offset: mediaOffset, bytes: mdat },
        { offset: mediaOffset + mdat.length, bytes: movie },
      ],
      mediaOffset + mdat.length + movie.length,
    );

    const demuxed = await demuxCached(source.file);

    expect(demuxed?.samples).toHaveLength(200);
    expect(demuxed?.samples[0]?.offset).toBe(48 + MEDIA_SHIFT);
    expect(await readKeyframeTimestamps(source.file)).toEqual(everySecond);
    expect(source.bytesRead()).toBeLessThan(MAX_METADATA_BYTES);
  });

  it("reads a fragmented movie's samples from its moofs", async () => {
    const bytes = fragmented();
    const { file } = sourceFile(bytes);
    const demuxed = await demuxCached(file);
    const whole = await demuxCached(sourceFile(movieLast).file);

    const bytesOf = (source: Uint8Array, sample: VideoSample) =>
      source.slice(sample.offset, sample.offset + sample.size);
    expect(demuxed?.samples.map((sample) => bytesOf(bytes, sample))).toEqual(
      whole?.samples.map((sample) => bytesOf(movieLast, sample)),
    );
    // Nothing carries the edit list over, so the B-frame delay stays in the times.
    expect((await readFrameTimestamps(file))?.slice(0, 3)).toEqual([0.2, 0.3, 0.4]);
    expect(await readKeyframeTimestamps(file)).toHaveLength(20);
  });

  it("keeps sample metadata and no sample bytes", async () => {
    const demuxed = await demuxCached(sourceFile(movieLast).file);

    expect(Object.keys(demuxed?.samples[0] ?? {}).sort()).toEqual(
      ["cts", "duration", "is_sync", "offset", "size", "timescale"].sort(),
    );
  });

  it("demuxes a file once however many readers ask", async () => {
    const source = sourceFile(movieLast);

    await readFrameTimestamps(source.file);
    const { length } = source.reads;
    await readKeyframeTimestamps(source.file);
    expect(await countKeyframesInRange(source.file, 3, 7.5)).toBe(5);

    expect(source.reads).toHaveLength(length);
  });

  it("leaves out the samples a truncated file lost", async () => {
    const bytes = movieFirst();
    const source = sourceFile(bytes.slice(0, bytes.length - mdat.length / 2));

    const frames = await readFrameTimestamps(source.file);

    expect(frames?.length).toBeGreaterThan(0);
    expect(frames?.length).toBeLessThan(200);
  });
});

describe("demuxing declines", () => {
  it.each([
    ["no moov", concatBytes(ftyp, mdat)],
    ["no ftyp", concatBytes(mdat, moov)],
    ["a moov cut short", movieLast.slice(0, -100)],
    ["no boxes at all", new Uint8Array(64)],
  ])("a file with %s", async (_what, bytes) => {
    expect(await readFrameTimestamps(sourceFile(bytes).file)).toBeNull();
  });

  it("a file that is not MP4 or MOV, unread", async () => {
    const source = sourceFile(movieLast, "clip.webm");
    Object.assign(source.file, { type: "video/webm" });

    expect(await readFrameTimestamps(source.file)).toBeNull();
    expect(source.reads).toEqual([]);
  });
});

describe("demuxing failures", () => {
  it("retries after a read fails", async () => {
    const source = sourceFile(movieLast);
    const slice = vi.spyOn(source.file, "slice");
    slice.mockReturnValueOnce({
      arrayBuffer: () => Promise.reject(new Error("unreadable")),
    } as unknown as Blob);

    await expect(readFrameTimestamps(source.file)).rejects.toThrowError("unreadable");
    expect(await readFrameTimestamps(source.file)).toHaveLength(200);
  });
});
