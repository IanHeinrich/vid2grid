import type { ToolCall, ToolResult } from "../types";

export type Parsed<T> = { value: T } | { problem: string };
export type Args = Record<string, unknown>;

export function parseArguments(call: ToolCall): Parsed<Args> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.arguments === "" ? "{}" : call.arguments);
  } catch {
    return { problem: "The arguments were not valid JSON. Send a JSON object." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { problem: "The arguments must be a JSON object." };
  }
  return { value: parsed as Args };
}

export function numberArg(args: Args, name: string): Parsed<number> {
  const value = args[name];
  return typeof value === "number" && Number.isFinite(value)
    ? { value }
    : { problem: `${name} must be a finite number.` };
}

export function timesArg(args: Args, name: string, max: number): Parsed<number[]> {
  const value: unknown = args[name];
  if (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= max &&
    value.every(isFiniteNumber)
  ) {
    return { value };
  }
  return { problem: `${name} must be an array of 1 to ${max} numbers in seconds.` };
}

export function textArg(args: Args, name: string): Parsed<string> {
  const value = args[name];
  return isNonEmptyString(value)
    ? { value: value.trim() }
    : { problem: `${name} must be a non-empty string.` };
}

export function namesArg(args: Args, name: string): Parsed<string[]> {
  const value: unknown = args[name];
  if (Array.isArray(value) && value.length >= 1 && value.every(isNonEmptyString)) {
    return { value };
  }
  return { problem: `${name} must be an array of one or more image names.` };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function integerArg(args: Args, name: string, min: number, max: number): Parsed<number> {
  const value = args[name];
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? { value }
    : { problem: `${name} must be an integer from ${min} to ${max}.` };
}

export function imagesFollow(count: number): string {
  return count === 1 ? "1 image follows." : `${count} images follow.`;
}

// With a looking model, the writer reads what the images show in the same result.
export function imagesDescribed(count: number): string {
  return count === 1 ? "1 image, described below." : `${count} images, described below.`;
}

export function failure(problem: string): ToolResult {
  return { text: `Error: ${problem}`, images: [] };
}
