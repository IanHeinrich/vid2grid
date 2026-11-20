// Always a new buffer, even at the same rate, so the result can be transferred on its own.
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return samples.slice();
  const outputLength = Math.round((samples.length * toRate) / fromRate);
  const step = fromRate / toRate;
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index++) {
    const position = index * step;
    const before = Math.floor(position);
    const fraction = position - before;
    const left = samples[before] ?? 0;
    const right = samples[before + 1] ?? left;
    output[index] = left + (right - left) * fraction;
  }
  return output;
}
