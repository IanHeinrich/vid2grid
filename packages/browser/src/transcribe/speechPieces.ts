const PIECE_SECONDS = 5;
// A shorter tail joins the piece before it rather than going to Whisper on its own.
const MIN_PIECE_SECONDS = 1;
// About -50 dBFS. Whisper invents words for a near-silent piece, so one this quiet is skipped.
const SILENT_RMS = 10 ** (-50 / 20);
const PLACEHOLDER_TAG = /[[(]\s*(?:blank_audio|silence|no speech|sound|noise)\s*[\])]/gi;

export interface SpeechPiece {
  startIndex: number;
  endIndex: number;
  startSeconds: number;
  endSeconds: number;
  audible: boolean;
}

function rms(samples: Float32Array, startIndex: number, endIndex: number): number {
  let sumOfSquares = 0;
  for (let index = startIndex; index < endIndex; index++) {
    const value = samples[index] ?? 0;
    sumOfSquares += value * value;
  }
  return endIndex > startIndex ? Math.sqrt(sumOfSquares / (endIndex - startIndex)) : 0;
}

export function speechPieces(samples: Float32Array, sampleRate: number): SpeechPiece[] {
  const pieceLength = PIECE_SECONDS * sampleRate;
  const minLength = MIN_PIECE_SECONDS * sampleRate;
  const pieces: SpeechPiece[] = [];
  for (let startIndex = 0; startIndex < samples.length; startIndex += pieceLength) {
    const remaining = samples.length - startIndex - pieceLength;
    const endIndex = remaining < minLength ? samples.length : startIndex + pieceLength;
    pieces.push({
      startIndex,
      endIndex,
      startSeconds: startIndex / sampleRate,
      endSeconds: endIndex / sampleRate,
      audible: rms(samples, startIndex, endIndex) >= SILENT_RMS,
    });
    if (endIndex === samples.length) break;
  }
  return pieces;
}

export function spokenText(segments: readonly { text: string }[]): string {
  return segments
    .map((segment) => segment.text)
    .join(" ")
    .replace(PLACEHOLDER_TAG, " ")
    .replace(/\s+/g, " ")
    .trim();
}
