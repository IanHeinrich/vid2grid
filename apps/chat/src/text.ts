const MAX_ERROR_CHARS = 500;

// For showing, keeping or passing on: a server's error can be a whole page.
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length <= MAX_ERROR_CHARS ? text : `${text.slice(0, MAX_ERROR_CHARS).trimEnd()}…`;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
