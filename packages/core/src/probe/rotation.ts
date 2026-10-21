// Elements a and b are 16.16 fixed point, as in ffmpeg's av_display_rotation_get.
const FIXED_POINT_ONE = 0x10000;
const QUARTER_TURN_DEGREES = 90;
const FULL_TURN_DEGREES = 360;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export function rotationFromMatrix(matrix: ArrayLike<number>): number {
  const a = (matrix[0] ?? FIXED_POINT_ONE) / FIXED_POINT_ONE;
  const b = (matrix[1] ?? 0) / FIXED_POINT_ONE;
  const quarterTurns = Math.round((Math.atan2(b, a) * DEGREES_PER_RADIAN) / QUARTER_TURN_DEGREES);
  const degrees = quarterTurns * QUARTER_TURN_DEGREES;
  return ((degrees % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
}
