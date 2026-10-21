import type { TranscriptCue } from "./vtt";

export interface TranscriptSegment {
  start: number;
  // Whisper can leave a final chunk open-ended; it then ends where it starts.
  end: number | null;
  text: string;
}

// A recogniser times its segments from the start of the audio it was given, not of the video.
export function cuesFromSegments(
  segments: TranscriptSegment[],
  offsetSeconds: number,
): TranscriptCue[] {
  return segments.map((segment) => ({
    start: segment.start + offsetSeconds,
    end: (segment.end ?? segment.start) + offsetSeconds,
    text: segment.text.trim(),
  }));
}
