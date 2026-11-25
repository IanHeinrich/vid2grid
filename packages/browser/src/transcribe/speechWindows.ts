// The windows transformers.js cuts long audio into, so that decoding them one at a time and joining
// their tokens gives the text it would give for the whole.
const WINDOW_SECONDS = 30;
// Overlap decoded on both sides of a join. The join matches the tokens heard twice there.
const STRIDE_SECONDS = 5;

export interface SpeechWindow {
  startIndex: number;
  endIndex: number;
  // The window's length, then the part of its start and of its end shared with its neighbours.
  strideSeconds: [length: number, left: number, right: number];
}

export function* speechWindows(
  sampleCount: number,
  sampleRate: number,
): Generator<SpeechWindow, void, undefined> {
  const windowLength = WINDOW_SECONDS * sampleRate;
  const jump = windowLength - 2 * STRIDE_SECONDS * sampleRate;
  for (let startIndex = 0; sampleCount > 0; startIndex += jump) {
    const endIndex = Math.min(startIndex + windowLength, sampleCount);
    const isLast = startIndex + windowLength >= sampleCount;
    yield {
      startIndex,
      endIndex,
      strideSeconds: [
        (endIndex - startIndex) / sampleRate,
        startIndex === 0 ? 0 : STRIDE_SECONDS,
        isLast ? 0 : STRIDE_SECONDS,
      ],
    };
    if (isLast) return;
  }
}
