import type { AbortSignalLike } from "@vid2grid/core";
import { MAX_READ_BYTES, readBytes } from "./fileBytes";
import type { VideoSample } from "./videoSamples";

// Reading over the audio stored between two video chunks beats a second read.
const MAX_SKIPPED_BYTES = 64 * 1024;

export interface SampleRun {
  offset: number;
  length: number;
  samples: VideoSample[];
}

export interface SampleBytes {
  sample: VideoSample;
  data: Uint8Array;
}

// Grouped lazily, because the samples of a long video outnumber any one read.
export function* sampleRuns(samples: Iterable<VideoSample>): Generator<SampleRun, void, undefined> {
  let run: SampleRun | undefined;
  for (const sample of samples) {
    const skipped = run ? sample.offset - run.offset - run.length : 0;
    const joined = run ? run.length + skipped + sample.size : 0;
    if (run && skipped >= 0 && skipped <= MAX_SKIPPED_BYTES && joined <= MAX_READ_BYTES) {
      run.length = joined;
      run.samples.push(sample);
    } else {
      if (run) yield run;
      run = { offset: sample.offset, length: sample.size, samples: [sample] };
    }
  }
  if (run) yield run;
}

// Holds one run's bytes at a time.
export async function* readSamples(
  file: File,
  samples: Iterable<VideoSample>,
  signal?: AbortSignalLike,
): AsyncGenerator<SampleBytes, void, undefined> {
  for (const run of sampleRuns(samples)) {
    const bytes = new Uint8Array(await readBytes(file, run.offset, run.length, signal));
    for (const sample of run.samples) {
      const at = sample.offset - run.offset;
      yield { sample, data: bytes.subarray(at, at + sample.size) };
    }
  }
}
