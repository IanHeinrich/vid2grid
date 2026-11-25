import { Vid2GridError } from "@vid2grid/core";

class ProcessCrash extends Error {}

// Not SIGKILL, SIGTERM or SIGINT, which someone sends on purpose.
const CRASH_SIGNALS = new Set<NodeJS.Signals>([
  "SIGSEGV",
  "SIGBUS",
  "SIGILL",
  "SIGFPE",
  "SIGABRT",
  "SIGTRAP",
]);
// Windows' access violation, stack overflow, heap corruption and stack buffer overrun. Listed
// exactly because ffmpeg's own negative error codes come out as numbers in the same range.
const WINDOWS_CRASH_CODES = new Set([0xc0000005, 0xc00000fd, 0xc0000374, 0xc0000409]);

export function exitFailure(
  program: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): Error | undefined {
  if (code === 0) return undefined;
  const crashed = signal ? CRASH_SIGNALS.has(signal) : WINDOWS_CRASH_CODES.has(code ?? 0);
  const message = signal
    ? `${program} was killed by ${signal}`
    : `${program} exited with code ${code}`;
  return crashed ? new ProcessCrash(message) : new Error(message);
}

export function isCrash(error: unknown): boolean {
  return error instanceof Vid2GridError && error.cause instanceof ProcessCrash;
}
