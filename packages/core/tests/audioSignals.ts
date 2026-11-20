export const TEST_SAMPLE_RATE = 16000;
const TONE_HZ = 1000;

export function tone(seconds: number, amplitude: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * TEST_SAMPLE_RATE));
  return samples.map(
    (_, index) => amplitude * Math.sin((2 * Math.PI * TONE_HZ * index) / TEST_SAMPLE_RATE),
  );
}

export function concat(...parts: Float32Array[]): Float32Array {
  const joined = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export function pulseTrain(
  seconds: number,
  ratePerMinute: number,
  pulseSeconds = 0.05,
): Float32Array {
  const samples = new Float32Array(Math.round(seconds * TEST_SAMPLE_RATE));
  const period = Math.round((60 / ratePerMinute) * TEST_SAMPLE_RATE);
  const pulse = tone(pulseSeconds, 0.5);
  for (let start = 0; start + pulse.length <= samples.length; start += period) {
    samples.set(pulse, start);
  }
  return samples;
}

// Deterministic, so a failure reproduces.
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
