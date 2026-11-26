// DeepSeek's special tokens use a fullwidth bar, and a lower one-eighth block in place of spaces.
const BAR = "[\\uFF5C|]";
const SEP = "[\\u2581_ ]";
const DSML_OPEN = `<\\s*${BAR}\\s*DSML\\s*${BAR}\\s*`;
const DSML_CLOSE = `<\\s*(?:\\/\\s*${BAR}|${BAR}\\s*\\/)\\s*DSML\\s*${BAR}\\s*`;
const DSML_ANY = `<\\s*\\/?\\s*${BAR}\\s*\\/?\\s*DSML\\s*${BAR}`;
const UNTIL_CLOSED_OR_END = (close: string) => `[\\s\\S]*?(?:${close}|$)`;

// Models fall back to their native tool syntax as text, mostly when told to stop calling tools.
// Whole blocks go first, so the stray-tag patterns do not leave a block's arguments behind.
const LEAKED_TOOL_MARKUP = [
  new RegExp(
    `${DSML_OPEN}(\\w*calls|invoke)\\b[^>]*>${UNTIL_CLOSED_OR_END(`${DSML_CLOSE}\\1\\s*>`)}`,
    "gi",
  ),
  new RegExp(
    `<${BAR}\\s*tool${SEP}calls${SEP}begin\\s*${BAR}>${UNTIL_CLOSED_OR_END(`<${BAR}\\s*tool${SEP}calls${SEP}end\\s*${BAR}>`)}`,
    "gi",
  ),
  /<(tool_calls?|function_calls)>[\s\S]*?(?:<\/\1>|$)/gi,
  // Gemma 4 puts the bar after "<" in an opening tag and before ">" in a closing one.
  /<\|\s*(tool_call|tool_response)\s*>[\s\S]*?(?:<\s*\1\s*\|>|$)/gi,
  /<\|\s*(tool\w*?)(?:_begin)?\s*\|>[\s\S]*?<\|\s*(?:\/\s*\1|\1_end)\s*\|>/gi,
  new RegExp(`${DSML_ANY}[^>]*>`, "gi"),
  new RegExp(`<${BAR}\\s*tool${SEP}[^>]*?${BAR}>`, "gi"),
  /<\|\s*\/?\s*tool\w*\s*\|>/gi,
  /<\s*tool_(?:call|response)\s*\|>/gi,
];

export function stripToolMarkup(text: string): { text: string; stripped: boolean } {
  const cleaned = LEAKED_TOOL_MARKUP.reduce(
    (current, pattern) => current.replace(pattern, ""),
    text,
  );
  if (cleaned === text) return { text, stripped: false };
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), stripped: true };
}
