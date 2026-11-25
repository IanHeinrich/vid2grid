import { Vid2GridError } from "@vid2grid/core";

class KilledBySignal extends Error {}

export function exitFailure(
  program: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): Error | undefined {
  if (signal) return new KilledBySignal(`${program} was killed by ${signal}`);
  return code === 0 ? undefined : new Error(`${program} exited with code ${code}`);
}

export function diedOnSignal(error: unknown): boolean {
  return error instanceof Vid2GridError && error.cause instanceof KilledBySignal;
}
