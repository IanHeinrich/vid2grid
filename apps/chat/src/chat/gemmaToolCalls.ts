import type { ToolCall } from "../types";
import { splitCode } from "./codeSpans";

export type GemmaCall = Pick<ToolCall, "name" | "arguments">;

export type GemmaToolCalls =
  { kind: "none" } | { kind: "calls"; calls: GemmaCall[]; before: string } | { kind: "unparsed" };

// Gemma 4 writes <|tool_call>call:NAME{key:value}<tool_call|>, with strings between <|"|> marks.
const OPEN = /<\|\s*tool_call\s*>/i;
const CLOSE = /<\s*tool_call\s*\|>/i;
const QUOTE = '<|"|>';
const CALL_PREFIX = /call\s*:\s*/y;
const NAME = /[A-Za-z_][\w.-]*/y;
const KEY = /[\w$.-]+/y;
const BARE = /[^,{}[\]]+/y;
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const LITERALS = new Map<string, boolean | null>([
  ["true", true],
  ["false", false],
  ["null", null],
]);

class GemmaSyntaxError extends Error {}

function createCursor(text: string) {
  let at = 0;

  function skipSpace(): void {
    while (at < text.length && /\s/.test(text.charAt(at))) at++;
  }

  function peek(): string {
    skipSpace();
    return text.charAt(at);
  }

  function eat(char: string): boolean {
    if (peek() !== char) return false;
    at++;
    return true;
  }

  function expect(char: string): void {
    if (!eat(char)) throw new GemmaSyntaxError(`Expected ${char}`);
  }

  function match(pattern: RegExp): string | undefined {
    skipSpace();
    pattern.lastIndex = at;
    const found = pattern.exec(text);
    if (found === null) return undefined;
    at = pattern.lastIndex;
    return found[0];
  }

  function gemmaString(): string {
    const start = at + QUOTE.length;
    const end = text.indexOf(QUOTE, start);
    if (end === -1) throw new GemmaSyntaxError("Unclosed string");
    at = end + QUOTE.length;
    return text.slice(start, end);
  }

  function quotedString(): string {
    let end = at + 1;
    while (end < text.length && text.charAt(end) !== '"') end += text.charAt(end) === "\\" ? 2 : 1;
    if (end >= text.length) throw new GemmaSyntaxError("Unclosed string");
    const quoted = text.slice(at, end + 1);
    at = end + 1;
    try {
      const parsed: unknown = JSON.parse(quoted);
      if (typeof parsed === "string") return parsed;
    } catch {
      // A malformed escape keeps the characters as written.
    }
    return quoted.slice(1, -1);
  }

  function string(): string | undefined {
    skipSpace();
    if (text.startsWith(QUOTE, at)) return gemmaString();
    if (text.charAt(at) === '"') return quotedString();
    return undefined;
  }

  return { peek, eat, expect, match, string };
}

type Cursor = ReturnType<typeof createCursor>;

function bare(cursor: Cursor): unknown {
  const word = cursor.match(BARE)?.trim() ?? "";
  if (word === "") throw new GemmaSyntaxError("Expected a value");
  if (NUMBER.test(word)) return Number(word);
  return LITERALS.has(word) ? LITERALS.get(word) : word;
}

function list<T>(cursor: Cursor, close: string, item: (cursor: Cursor) => T): T[] {
  const items: T[] = [];
  while (!cursor.eat(close)) {
    items.push(item(cursor));
    if (!cursor.eat(",")) {
      cursor.expect(close);
      break;
    }
  }
  return items;
}

function entry(cursor: Cursor): [string, unknown] {
  const key = cursor.string() ?? cursor.match(KEY);
  if (key === undefined) throw new GemmaSyntaxError("Expected a key");
  cursor.expect(":");
  return [key, value(cursor)];
}

function object(cursor: Cursor): Record<string, unknown> {
  cursor.expect("{");
  return Object.fromEntries(list(cursor, "}", entry));
}

function value(cursor: Cursor): unknown {
  if (cursor.peek() === "{") return object(cursor);
  if (cursor.eat("[")) return list(cursor, "]", value);
  return cursor.string() ?? bare(cursor);
}

function call(cursor: Cursor): GemmaCall {
  const name = cursor.match(CALL_PREFIX) === undefined ? undefined : cursor.match(NAME);
  if (name === undefined) throw new GemmaSyntaxError("Expected call:NAME");
  if (cursor.peek() === "") return { name, arguments: "{}" };
  return { name, arguments: JSON.stringify(object(cursor)) };
}

function blockCalls(block: string): GemmaCall[] {
  const cursor = createCursor(block);
  const found: GemmaCall[] = [];
  while (cursor.peek() !== "") {
    found.push(call(cursor));
    cursor.eat(",");
  }
  return found;
}

interface CallBlocks {
  // Everything before the first call, code included.
  before: string;
  blocks: string[];
}

// A block with no closing tag is a stream that ended early; it still parses if its braces closed.
// A call quoted in code is the model showing the format, not using it.
function callBlocks(text: string): CallBlocks {
  const found: CallBlocks = { before: "", blocks: [] };
  for (const part of splitCode(text)) {
    const [prose = "", ...opened] = part.code ? [part.text] : part.text.split(OPEN);
    if (found.blocks.length === 0) found.before += prose;
    found.blocks.push(...opened.map((block) => block.split(CLOSE)[0] ?? ""));
  }
  return found;
}

export function parseGemmaToolCalls(text: string): GemmaToolCalls {
  const { before, blocks } = callBlocks(text);
  if (blocks.length === 0) return { kind: "none" };
  try {
    const calls = blocks.flatMap(blockCalls);
    return calls.length > 0 ? { kind: "calls", calls, before } : { kind: "unparsed" };
  } catch (error) {
    if (error instanceof GemmaSyntaxError) return { kind: "unparsed" };
    throw error;
  }
}
