export function gridFileName(index: number): string {
  return `grid_${String(index + 1).padStart(4, "0")}.jpg`;
}

/** Same numbering as `gridFileName`, so `grid_0001.vtt` sits paired with `grid_0001.jpg`. */
export function gridTranscriptFileName(index: number): string {
  return `grid_${String(index + 1).padStart(4, "0")}.vtt`;
}

export function combinedTranscriptFileName(): string {
  return "transcript.vtt";
}
