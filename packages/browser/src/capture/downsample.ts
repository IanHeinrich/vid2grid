// Lobes either side of the centre; enough that nothing above the new Nyquist rate folds back into
// the speech band, where resampleLinear lets it.
const KERNEL_LOBES = 16;

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

function windowedSinc(distance: number, cutoff: number, halfWidth: number): number {
  if (Math.abs(distance) >= halfWidth) return 0;
  const angle = Math.PI * distance * cutoff;
  const sinc = angle === 0 ? 1 : Math.sin(angle) / angle;
  const phase = (Math.PI * distance) / halfWidth;
  const blackman = 0.42 + 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
  return sinc * blackman;
}

function normalised(kernel: Float32Array): Float32Array {
  const sum = kernel.reduce((total, weight) => total + weight, 0);
  return kernel.map((weight) => weight / sum);
}

/** Band-limited, so rates must be whole numbers of hertz. */
export function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= toRate) throw new RangeError(`Cannot downsample ${fromRate} Hz to ${toRate} Hz`);
  const divisor = greatestCommonDivisor(fromRate, toRate);
  const step = fromRate / divisor;
  const phaseCount = toRate / divisor;
  const cutoff = toRate / fromRate;
  const halfWidth = KERNEL_LOBES / cutoff;
  const reach = Math.ceil(halfWidth);
  const kernels = Array.from({ length: phaseCount }, (_, phase) =>
    normalised(
      Float32Array.from({ length: 2 * reach }, (_, tap) =>
        windowedSinc(tap - reach + 1 - phase / phaseCount, cutoff, halfWidth),
      ),
    ),
  );

  const output = new Float32Array(Math.round((samples.length * toRate) / fromRate));
  for (let index = 0; index < output.length; index++) {
    const position = index * step;
    const phase = position % phaseCount;
    const first = (position - phase) / phaseCount - reach + 1;
    const kernel = kernels[phase];
    if (!kernel) continue;
    let sum = 0;
    for (let tap = 0; tap < kernel.length; tap++) {
      sum += (kernel[tap] ?? 0) * (samples[first + tap] ?? 0);
    }
    output[index] = sum;
  }
  return output;
}
