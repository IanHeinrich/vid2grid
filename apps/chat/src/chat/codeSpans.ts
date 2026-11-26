export interface TextPart {
  text: string;
  code: boolean;
}

// Fences go first, as in Markdown, so a backtick inside a fenced block opens no inline span.
const FENCE =
  /(?:^|\n)[ \t]*(`{3,}|~{3,})[^`\n]*(?:\n[\s\S]*?)??(?:\n[ \t]*\1[`~]*[ \t]*(?=\n|$)|$)/g;
const INLINE = /(`+)(?!`)(?:(?!\n\n)[\s\S])*?[^`]\1(?!`)/g;

function splitBy(text: string, pattern: RegExp): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push({ text: text.slice(at, match.index), code: false });
    parts.push({ text: match[0], code: true });
    at = match.index + match[0].length;
  }
  parts.push({ text: text.slice(at), code: false });
  return parts;
}

export function splitCode(text: string): TextPart[] {
  return splitBy(text, FENCE).flatMap((part) => (part.code ? [part] : splitBy(part.text, INLINE)));
}

export function outsideCode(text: string, change: (prose: string) => string): string {
  return splitCode(text)
    .map((part) => (part.code ? part.text : change(part.text)))
    .join("");
}
