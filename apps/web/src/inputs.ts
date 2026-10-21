type ValueSource = Pick<HTMLInputElement, "value">;

export function readNumber(input: ValueSource, fallback?: number): number {
  const value = Number(input.value);
  return Number.isNaN(value) && fallback !== undefined ? fallback : value;
}

export function readInteger(input: ValueSource): number {
  return Math.trunc(readNumber(input));
}
