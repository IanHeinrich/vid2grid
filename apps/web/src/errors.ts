import { Vid2GridError } from "@vid2grid/core";

export function toUserMessage(err: unknown): string {
  // Core's other codes carry messages meant for the user; "internal" is a vid2grid bug.
  if (err instanceof Vid2GridError && err.code === "internal") {
    return `Internal error (please report it): ${err.message}`;
  }
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  return String(err);
}
