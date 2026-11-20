export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
