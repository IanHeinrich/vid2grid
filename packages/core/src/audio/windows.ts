export const SOUND_WINDOW_SECONDS = 2;
export const SOUND_HOP_SECONDS = 1;

export interface AudioWindow {
  startIndex: number;
  endIndex: number;
  startSeconds: number;
  endSeconds: number;
}

// The last window is cut short at the end of the audio rather than padded past it.
export function audioWindows(
  sampleCount: number,
  sampleRate: number,
  windowSeconds = SOUND_WINDOW_SECONDS,
  hopSeconds = SOUND_HOP_SECONDS,
): AudioWindow[] {
  if (sampleCount <= 0) return [];
  const windowLength = Math.max(1, Math.round(windowSeconds * sampleRate));
  const hopLength = Math.max(1, Math.round(hopSeconds * sampleRate));
  const count = 1 + Math.max(0, Math.ceil((sampleCount - windowLength) / hopLength));
  return Array.from({ length: count }, (_, index) => {
    const startIndex = index * hopLength;
    const endIndex = Math.min(sampleCount, startIndex + windowLength);
    return {
      startIndex,
      endIndex,
      startSeconds: startIndex / sampleRate,
      endSeconds: endIndex / sampleRate,
    };
  });
}
