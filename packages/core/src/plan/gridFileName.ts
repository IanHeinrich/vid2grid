const GRID_INDEX_DIGITS = 4;

function gridBaseName(index: number): string {
  return `grid_${String(index + 1).padStart(GRID_INDEX_DIGITS, "0")}`;
}

export function gridFileName(index: number): string {
  return `${gridBaseName(index)}.jpg`;
}

export function gridTranscriptFileName(index: number): string {
  return `${gridBaseName(index)}.vtt`;
}

export function combinedTranscriptFileName(): string {
  return "transcript.vtt";
}
