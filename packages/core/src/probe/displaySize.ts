const QUARTER_TURN_DEGREES = 90;
const FULL_TURN_DEGREES = 360;

export interface SampleAspectRatio {
  numerator: number;
  denominator: number;
}

export function isQuarterTurn(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}

// ffmpeg's convention stretches the width by the sample aspect ratio, never the height.
export function displaySize(
  codedWidth: number,
  codedHeight: number,
  sampleAspectRatio: SampleAspectRatio | null,
  rotation: number,
): { width: number; height: number } {
  const width =
    sampleAspectRatio === null
      ? codedWidth
      : roundRatioHalfToEven(
          codedWidth * sampleAspectRatio.numerator,
          sampleAspectRatio.denominator,
        );
  return isQuarterTurn(rotation)
    ? { width: codedHeight, height: width }
    : { width, height: codedHeight };
}

// ffmpeg reports the rotation to apply counter-clockwise while every executor of this
// contract rotates clockwise, so the sign flips.
export function normalizeRotationClockwise(ccwDegrees: number): number {
  const degrees = Math.round(-ccwDegrees / QUARTER_TURN_DEGREES) * QUARTER_TURN_DEGREES;
  return ((degrees % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
}

// Exact on integers and half to even, as Python's round(Fraction) is, so both hosts agree.
function roundRatioHalfToEven(numerator: number, denominator: number): number {
  const quotient = Math.floor(numerator / denominator);
  const twiceRemainder = 2 * (numerator - quotient * denominator);
  if (twiceRemainder > denominator) return quotient + 1;
  if (twiceRemainder < denominator) return quotient;
  return quotient % 2 === 0 ? quotient : quotient + 1;
}
