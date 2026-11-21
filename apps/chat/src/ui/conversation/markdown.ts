import {
  findCitations,
  type CitationMatch,
  type CitationOptions,
  type TimestampMatch,
} from "../../time";
import { seekButton } from "../buttons";
import "./markdown.css";

export interface MarkdownOptions {
  onSeek: (seconds: number) => void;
  maxSeconds?: number;
}

interface TextBlock {
  kind: "paragraph" | "quote";
  lines: string[];
}

interface HeadingBlock {
  kind: "heading";
  text: string;
}

interface ListBlock {
  kind: "list";
  ordered: boolean;
  start: number;
  items: string[];
}

type Block = TextBlock | HeadingBlock | ListBlock;

interface InlineContext {
  src: string;
  citations: Map<number, CitationMatch>;
  onSeek: (seconds: number) => void;
}

interface Span {
  node: Node;
  next: number;
}

const HEADING = /^ {0,3}#{1,6}\s+(\S.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const LIST_ITEM = /^ {0,3}(?:([-*])|(\d{1,9})\.)\s+(\S.*)$/;
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

// Emphasis nests by recursion, so unbounded "*_*_*_" runs would otherwise grow the stack.
const MAX_NESTING = 6;

export function renderMarkdown(text: string, options: MarkdownOptions): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of parseBlocks(text)) fragment.append(renderBlock(block, options));
  return fragment;
}

export function renderMarkdownInto(
  container: HTMLElement,
  text: string,
  options: MarkdownOptions,
): void {
  container.classList.add("markdown");
  container.replaceChildren(renderMarkdown(text, options));
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let open: TextBlock | ListBlock | undefined;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      open = undefined;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", text: (heading[1] ?? "").trimEnd() });
      open = undefined;
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      open = appendLine(blocks, open, "quote", quote[1] ?? "");
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[2] !== undefined;
      const itemText = (item[3] ?? "").trimEnd();
      if (open?.kind === "list" && open.ordered === ordered) {
        open.items.push(itemText);
      } else {
        open = { kind: "list", ordered, start: Number(item[2] ?? 1), items: [itemText] };
        blocks.push(open);
      }
      continue;
    }
    open = appendLine(blocks, open, "paragraph", line.trim());
  }
  return blocks;
}

function appendLine(
  blocks: Block[],
  open: TextBlock | ListBlock | undefined,
  kind: TextBlock["kind"],
  line: string,
): TextBlock {
  if (open && open.kind !== "list" && open.kind === kind) {
    open.lines.push(line);
    return open;
  }
  const block: TextBlock = { kind, lines: [line] };
  blocks.push(block);
  return block;
}

function renderBlock(block: Block, options: MarkdownOptions): HTMLElement {
  switch (block.kind) {
    case "paragraph":
      return element("p", "", renderInline(block.lines.join("\n"), options));
    case "quote":
      return element("blockquote", "", renderInline(block.lines.join("\n"), options));
    case "heading":
      return element("p", "md-heading", [element("strong", "", renderInline(block.text, options))]);
    case "list": {
      const list = element(
        block.ordered ? "ol" : "ul",
        "",
        block.items.map((item) => element("li", "", renderInline(item, options))),
      );
      if (list instanceof HTMLOListElement && block.start !== 1) list.start = block.start;
      return list;
    }
  }
}

function element(tag: string, className: string, children: Node[]): HTMLElement {
  const el = document.createElement(tag);
  if (className !== "") el.className = className;
  el.append(...children);
  return el;
}

function citationOptions({ maxSeconds }: MarkdownOptions): CitationOptions {
  return maxSeconds === undefined ? {} : { maxSeconds };
}

function renderInline(src: string, options: MarkdownOptions): Node[] {
  const citations = new Map(
    findCitations(src, citationOptions(options)).map((match) => [match.index, match]),
  );
  return parseInline({ src, citations, onSeek: options.onSeek }, 0, src.length, 0);
}

function parseInline(ctx: InlineContext, start: number, end: number, depth: number): Node[] {
  const nodes: Node[] = [];
  let literal = "";
  const flush = () => {
    if (literal !== "") nodes.push(document.createTextNode(literal));
    literal = "";
  };
  let index = start;
  while (index < end) {
    const char = ctx.src.charAt(index);
    const citation = ctx.citations.get(index);
    if (citation && index + citation.length <= end) {
      flush();
      nodes.push(...citationNodes(ctx, citation));
      index += citation.length;
      continue;
    }
    if (char === "\n") {
      flush();
      nodes.push(document.createElement("br"));
      index += 1;
      continue;
    }
    const span = matchSpan(ctx, char, index, end, depth);
    if (span) {
      flush();
      nodes.push(span.node);
      index = span.next;
      continue;
    }
    literal += char;
    index += 1;
  }
  flush();
  return nodes;
}

// A range keeps its brackets and separator as text between the two seek links.
function citationNodes(ctx: InlineContext, citation: CitationMatch): Node[] {
  const nodes: Node[] = [];
  const literal = (from: number, to: number) => {
    if (to > from) nodes.push(document.createTextNode(ctx.src.slice(from, to)));
  };
  let at = citation.index;
  for (const time of citation.times) {
    literal(at, time.index);
    nodes.push(timestampButton(ctx, time));
    at = time.index + time.length;
  }
  literal(at, citation.index + citation.length);
  return nodes;
}

function timestampButton(ctx: InlineContext, stamp: TimestampMatch): HTMLButtonElement {
  const label = ctx.src.slice(stamp.index, stamp.index + stamp.length);
  return seekButton(stamp.seconds, ctx.onSeek, label);
}

function matchSpan(
  ctx: InlineContext,
  char: string,
  index: number,
  end: number,
  depth: number,
): Span | null {
  switch (char) {
    case "`":
      return matchCode(ctx.src, index, end);
    case '"':
      return matchDialogue(ctx, index, end, depth, '"');
    case "“":
      return matchDialogue(ctx, index, end, depth, "”");
    case "*":
    case "_":
      return depth < MAX_NESTING ? matchEmphasis(ctx, char, index, end, depth) : null;
    default:
      return null;
  }
}

function matchCode(src: string, index: number, end: number): Span | null {
  const close = src.indexOf("`", index + 1);
  if (close === -1 || close >= end || close === index + 1) return null;
  const code = document.createElement("code");
  code.textContent = src.slice(index + 1, close);
  return { node: code, next: close + 1 };
}

function matchDialogue(
  ctx: InlineContext,
  index: number,
  end: number,
  depth: number,
  closing: string,
): Span | null {
  const close = ctx.src.indexOf(closing, index + 1);
  if (close === -1 || close >= end || close === index + 1) return null;
  const opening = ctx.src.charAt(index);
  const inner = parseInline(ctx, index + 1, close, depth + 1);
  const node = element("span", "md-dialogue", [
    document.createTextNode(opening),
    ...inner,
    document.createTextNode(closing),
  ]);
  return { node, next: close + 1 };
}

function matchEmphasis(
  ctx: InlineContext,
  char: string,
  index: number,
  end: number,
  depth: number,
): Span | null {
  const bold = char === "*" && ctx.src.charAt(index + 1) === "*";
  const marker = bold ? "**" : char;
  if (!canOpen(ctx.src, index, marker.length, end)) return null;
  const contentStart = index + marker.length;
  const close = findCloser(ctx.src, marker, contentStart, end);
  if (close <= contentStart) return null;
  const inner = parseInline(ctx, contentStart, close, depth + 1);
  const node = bold ? element("strong", "", inner) : element("em", "md-action", inner);
  return { node, next: close + marker.length };
}

function nextChar(src: string, index: number, length: number, end: number): string {
  return index + length < end ? src.charAt(index + length) : "";
}

// Markers touching a word on the outside (snake_case, 2*3) are literal, as are ones padded by spaces.
function canOpen(src: string, index: number, length: number, end: number): boolean {
  const next = nextChar(src, index, length, end);
  return next !== "" && !SPACE.test(next) && !WORD.test(src.charAt(index - 1));
}

function canClose(src: string, index: number, length: number, end: number): boolean {
  return !SPACE.test(src.charAt(index - 1)) && !WORD.test(nextChar(src, index, length, end));
}

function findCloser(src: string, marker: string, from: number, end: number): number {
  const char = marker.charAt(0);
  for (let index = from; index < end; index += 1) {
    const current = src.charAt(index);
    if (current === "`") {
      const close = src.indexOf("`", index + 1);
      if (close !== -1 && close < end) index = close;
      continue;
    }
    if (current !== char) continue;
    const doubled = src.charAt(index + 1) === char && index + 1 < end;
    if (marker.length === 2) {
      if (doubled && canClose(src, index, 2, end)) return index;
      if (doubled) index += 1;
      continue;
    }
    if (doubled) {
      index += 1;
      continue;
    }
    if (canClose(src, index, 1, end)) return index;
  }
  return -1;
}
