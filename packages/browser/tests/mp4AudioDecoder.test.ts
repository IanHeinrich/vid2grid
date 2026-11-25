import { Vid2GridError } from "@vid2grid/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeMp4AudioRange, openMp4Audio } from "../src/capture/mp4AudioDecoder";

const { createFile } = vi.hoisted(() => ({ createFile: vi.fn() }));
vi.mock("mp4box", () => ({
  createFile,
  MP4BoxBuffer: { fromArrayBuffer: (buffer: ArrayBuffer) => buffer },
}));

const SAMPLE_COUNT = 10;
const SAMPLE_BYTES = 4;
const MDAT_START = 16;
const RATE = 1000;
const AUDIO_SPECIFIC_CONFIG = Uint8Array.of(0x12, 0x10);

// ftyp, then an mdat whose samples have a gap after the fifth, then the moov at the end.
function buildFile(name = "clip.mp4"): { file: File; reads: [number, number][] } {
  const mdatBody = SAMPLE_COUNT * SAMPLE_BYTES + 8;
  const bytes = new Uint8Array(MDAT_START + 8 + mdatBody + 16);
  const view = new DataView(bytes.buffer);
  const box = (at: number, size: number, type: string) => {
    view.setUint32(at, size);
    [...type].forEach((char, index) => view.setUint8(at + 4 + index, char.charCodeAt(0)));
  };
  box(0, MDAT_START, "ftyp");
  box(MDAT_START, 8 + mdatBody, "mdat");
  box(MDAT_START + 8 + mdatBody, 16, "moov");
  sampleOffsets().forEach((offset, index) => bytes.fill(index, offset, offset + SAMPLE_BYTES));
  const reads: [number, number][] = [];
  const file = {
    name,
    type: "",
    size: bytes.length,
    slice: (start: number, end: number) => {
      reads.push([start, end]);
      return { arrayBuffer: () => Promise.resolve(bytes.slice(start, end).buffer) };
    },
  } as unknown as File;
  return { file, reads };
}

function sampleOffsets(): number[] {
  return Array.from(
    { length: SAMPLE_COUNT },
    (_, index) => MDAT_START + 8 + index * SAMPLE_BYTES + (index >= 5 ? 8 : 0),
  );
}

interface MovieOptions {
  audio?: boolean;
  // A sound track whose sample entry mp4box does not know.
  unknownSound?: boolean;
  samples?: { cts: number; duration: number }[];
  fragmented?: boolean;
  codec?: string;
  withEsds?: boolean;
}

function stubMovie({
  audio = true,
  unknownSound = false,
  samples: times = sampleOffsets().map((_, index) => ({ cts: index * 100, duration: 100 })),
  fragmented = false,
  codec = "mp4a.40.2",
  withEsds = true,
}: MovieOptions = {}) {
  const track = {
    id: 1,
    codec,
    audio: { sample_rate: RATE, channel_count: 2, sample_size: 16 },
    movie_timescale: 1000,
    timescale: 1000,
  };
  const offsets = sampleOffsets();
  const samples = times.map((time, index) => ({
    ...time,
    timescale: 1000,
    offset: offsets[index] ?? 0,
    size: SAMPLE_BYTES,
  }));
  const specificInfo = { data: AUDIO_SPECIFIC_CONFIG };
  const decoderConfig = { findDescriptor: (tag: number) => (tag === 5 ? specificInfo : undefined) };
  const esd = { findDescriptor: (tag: number) => (tag === 4 ? decoderConfig : undefined) };
  const entry = withEsds ? { esds: { esd } } : {};
  const isoFile = {
    onError: undefined as undefined | ((module: string, message: string) => void),
    appendBuffer: vi.fn(),
    flush: vi.fn(),
    moov: {
      traks: [
        { tkhd: { track_id: 2 }, mdia: { hdlr: { handler: "vide" } } },
        ...(unknownSound ? [{ tkhd: { track_id: 1 }, mdia: { hdlr: { handler: "soun" } } }] : []),
      ],
    },
    getInfo: () => ({
      isFragmented: fragmented,
      audioTracks: audio ? [track] : [],
      tracks: [track],
    }),
    getTrackSamplesInfo: () => samples,
    getTrackById: () => ({ mdia: { minf: { stbl: { stsd: { entries: [entry] } } } } }),
  };
  createFile.mockReturnValue(isoFile);
  return isoFile;
}

class FakeEncodedAudioChunk {
  readonly timestamp: number;
  readonly data: Uint8Array;
  constructor(init: { timestamp: number; data: Uint8Array }) {
    this.timestamp = init.timestamp;
    this.data = init.data;
  }
}

// Each 0.1 s chunk decodes to 100 frames per channel, valued at its first byte over ten.
class FakeAudioDecoder {
  static instances: FakeAudioDecoder[] = [];
  static supported = true;
  static failOnChunk: number | null = null;
  static isConfigSupported = vi.fn((config: AudioDecoderConfig) =>
    Promise.resolve({ supported: FakeAudioDecoder.supported, config }),
  );
  readonly decodeQueueSize = 0;
  state: "unconfigured" | "configured" | "closed" = "unconfigured";
  config: AudioDecoderConfig | undefined;
  decoded = 0;

  constructor(
    private readonly init: { output: (data: unknown) => void; error: (error: unknown) => void },
  ) {
    FakeAudioDecoder.instances.push(this);
  }

  configure(config: AudioDecoderConfig): void {
    this.config = config;
    this.state = "configured";
  }

  decode(chunk: FakeEncodedAudioChunk): void {
    if (this.state !== "configured") throw new DOMException("closed", "InvalidStateError");
    this.decoded++;
    if (FakeAudioDecoder.failOnChunk === this.decoded) {
      this.state = "closed";
      this.init.error(new DOMException("bad data", "EncodingError"));
      return;
    }
    const value = (chunk.data[0] ?? 0) / 10;
    this.init.output({
      timestamp: chunk.timestamp,
      sampleRate: RATE,
      numberOfFrames: 100,
      numberOfChannels: 2,
      copyTo: (destination: Float32Array) => destination.fill(value),
      close: vi.fn(),
    });
  }

  flush(): Promise<void> {
    return this.state === "configured" ? Promise.resolve() : Promise.reject(new Error("closed"));
  }

  close(): void {
    this.state = "closed";
  }
}

function failureOfFirstSecond(): Promise<unknown> {
  return decodeMp4AudioRange(buildFile().file, 0, 1, RATE).catch((e: unknown) => e);
}

function codeOf(error: unknown): string | undefined {
  return error instanceof Vid2GridError ? error.code : undefined;
}

beforeEach(() => {
  FakeAudioDecoder.instances = [];
  FakeAudioDecoder.supported = true;
  FakeAudioDecoder.failOnChunk = null;
  vi.stubGlobal("AudioDecoder", FakeAudioDecoder);
  vi.stubGlobal("EncodedAudioChunk", FakeEncodedAudioChunk);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeMp4AudioRange", () => {
  it("reads only the range's samples and trims the decoded audio to it exactly", async () => {
    stubMovie();
    const { file, reads } = buildFile();

    const audio = await decodeMp4AudioRange(file, 0.25, 0.65, RATE);

    expect(audio?.sampleRate).toBe(RATE);
    expect(audio?.samples).toHaveLength(400);
    expect(audio?.samples[0]).toBeCloseTo(0.2);
    expect(audio?.samples[399]).toBeCloseTo(0.6);
    const [decoder] = FakeAudioDecoder.instances;
    expect(decoder?.config).toEqual({
      codec: "mp4a.40.2",
      sampleRate: RATE,
      numberOfChannels: 2,
      description: AUDIO_SPECIFIC_CONFIG,
    });
    expect(decoder?.state).toBe("closed");
    const offsets = sampleOffsets();
    expect(reads.slice(-2)).toEqual([
      [offsets[1], (offsets[4] ?? 0) + SAMPLE_BYTES],
      [offsets[5], (offsets[6] ?? 0) + SAMPLE_BYTES],
    ]);
  });

  it("hands mp4box the ftyp then the moov, since getInfo needs the brand", async () => {
    const isoFile = stubMovie();

    await decodeMp4AudioRange(buildFile().file, 0, 1, RATE);

    const [[buffer]] = isoFile.appendBuffer.mock.calls as [[ArrayBuffer]];
    const typeAt = (offset: number) =>
      String.fromCharCode(...new Uint8Array(buffer, offset + 4, 4));
    expect(typeAt(0)).toBe("ftyp");
    expect(typeAt(MDAT_START)).toBe("moov");
  });

  it("resamples to the asked rate", async () => {
    stubMovie();

    const audio = await decodeMp4AudioRange(buildFile().file, 0, 1, 500);

    expect(audio?.samples).toHaveLength(500);
    expect(audio?.sampleRate).toBe(500);
  });

  it("gives empty audio for a range past the end of the track", async () => {
    stubMovie();

    const audio = await decodeMp4AudioRange(buildFile().file, 5, 6, RATE);

    expect(audio?.samples).toHaveLength(0);
    expect(FakeAudioDecoder.instances).toHaveLength(0);
  });
});

describe("openMp4Audio", () => {
  it("parses the movie once for every range decoded from it", async () => {
    const isoFile = stubMovie();
    const { file } = buildFile();
    const resample = vi.fn((samples: Float32Array) => samples);

    const audio = await openMp4Audio(file);
    const first = await audio?.decodeRange(0, 0.3, RATE);
    const second = await audio?.decodeRange(0.5, 0.8, RATE, undefined, resample);

    expect(audio?.endSeconds).toBe(1);
    expect(first?.samples).toHaveLength(300);
    expect(second?.samples).toHaveLength(300);
    expect(resample).toHaveBeenCalledTimes(1);
    expect(isoFile.appendBuffer).toHaveBeenCalledTimes(1);
  });
});

describe("decodeMp4AudioRange memory", () => {
  it("allocates for the range asked for, however long its samples claim to be", async () => {
    const hour = 3_600_000;
    stubMovie({ samples: [{ cts: 0, duration: 2 * hour }] });
    const allocated: number[] = [];
    const resample = vi.fn((samples: Float32Array) => {
      allocated.push(samples.length);
      return samples;
    });

    const audio = await openMp4Audio(buildFile().file);
    const decoded = await audio?.decodeRange(3600, 3630, RATE, undefined, resample);

    expect(allocated).toEqual([Math.ceil((30 + 0.1 + 1) * RATE)]);
    expect(decoded?.samples).toHaveLength(30 * RATE);
  });
});

describe("decodeMp4AudioRange failures", () => {
  it("rejects with no_audio when the movie has no audio track", async () => {
    stubMovie({ audio: false });

    const failure = await failureOfFirstSecond();

    expect(codeOf(failure)).toBe("no_audio");
    expect((failure as Error).message).toBe("This video has no audio track.");
  });

  it("rejects with undecodable_audio for a sound track mp4box does not know", async () => {
    stubMovie({ audio: false, unknownSound: true, codec: "sowt" });

    const failure = await failureOfFirstSecond();

    expect(codeOf(failure)).toBe("undecodable_audio");
    expect((failure as Error).message).toContain("sowt");
  });

  it("rejects with the read's own error when the file cannot be read", async () => {
    stubMovie();
    const { file } = buildFile();
    const unreadable = new DOMException("gone", "NotReadableError");
    const slice = file.slice.bind(file);
    vi.spyOn(file, "slice").mockImplementation((start, end) =>
      FakeAudioDecoder.instances.length > 0
        ? ({ arrayBuffer: () => Promise.reject(unreadable) } as unknown as Blob)
        : slice(start, end),
    );

    await expect(decodeMp4AudioRange(file, 0, 1, RATE)).rejects.toBe(unreadable);
    expect(FakeAudioDecoder.instances[0]?.state).toBe("closed");
  });

  it("rejects with undecodable_audio when the browser cannot decode the codec", async () => {
    stubMovie({ codec: "ac-3" });
    FakeAudioDecoder.supported = false;

    const failure = await failureOfFirstSecond();

    expect(codeOf(failure)).toBe("undecodable_audio");
    expect((failure as Error).message).toContain("ac-3");
  });

  it("rejects with undecodable_audio for AAC with no decoder configuration", async () => {
    stubMovie({ withEsds: false });

    const failure = await failureOfFirstSecond();

    expect(codeOf(failure)).toBe("undecodable_audio");
  });

  it("rejects with undecodable_audio when decoding fails, keeping the cause", async () => {
    stubMovie();
    FakeAudioDecoder.failOnChunk = 2;

    const failure = await failureOfFirstSecond();

    expect(codeOf(failure)).toBe("undecodable_audio");
    expect((failure as Error).cause).toMatchObject({ name: "EncodingError" });
  });

  it.each([
    ["mp4a.6B", "mp3"],
    ["Opus", "opus"],
  ])("decodes %s as %s", async (trackCodec, decoderCodec) => {
    stubMovie({ codec: trackCodec });

    await decodeMp4AudioRange(buildFile().file, 0, 0.5, RATE);

    expect(FakeAudioDecoder.instances[0]?.config?.codec).toBe(decoderCodec);
  });

  it("stops between reads once aborted, closing the decoder", async () => {
    stubMovie();
    const { file, reads } = buildFile();
    const controller = new AbortController();
    const reason = new Error("stopped");
    const slice = file.slice.bind(file);
    vi.spyOn(file, "slice").mockImplementation((start, end) => {
      if (FakeAudioDecoder.instances.length > 0) controller.abort(reason);
      return slice(start, end);
    });

    const failure = await decodeMp4AudioRange(file, 0, 1, RATE, controller.signal).catch(
      (e: unknown) => e,
    );

    expect(failure).toBe(reason);
    expect(FakeAudioDecoder.instances[0]?.state).toBe("closed");
    expect(FakeAudioDecoder.instances[0]?.decoded).toBe(0);
    expect(reads.length).toBeGreaterThan(0);
  });
});

describe("decodeMp4AudioRange declines", () => {
  it("a file that is not MP4 or MOV", async () => {
    stubMovie();

    expect(await decodeMp4AudioRange(buildFile("clip.webm").file, 0, 1, RATE)).toBeNull();
  });

  it("a browser without AudioDecoder", async () => {
    vi.stubGlobal("AudioDecoder", undefined);
    stubMovie();

    expect(await decodeMp4AudioRange(buildFile().file, 0, 1, RATE)).toBeNull();
  });

  it("a fragmented movie, whose moov holds no samples", async () => {
    stubMovie({ fragmented: true });

    expect(await decodeMp4AudioRange(buildFile().file, 0, 1, RATE)).toBeNull();
  });

  it("a movie mp4box cannot parse", async () => {
    const isoFile = stubMovie();
    isoFile.appendBuffer.mockImplementation(() => isoFile.onError?.("ISOFile", "bad box"));

    expect(await decodeMp4AudioRange(buildFile().file, 0, 1, RATE)).toBeNull();
  });

  it("a file with no moov box", async () => {
    stubMovie();
    const bytes = new Uint8Array(32);
    new DataView(bytes.buffer).setUint32(0, 32);
    const file = {
      name: "clip.mov",
      size: bytes.length,
      slice: (start: number, end: number) => ({
        arrayBuffer: () => Promise.resolve(bytes.slice(start, end).buffer),
      }),
    } as unknown as File;

    expect(await decodeMp4AudioRange(file, 0, 1, RATE)).toBeNull();
  });
});
