import type { SceneNote } from "./types";

export function formatTimestamp(seconds: number, tenths = false): string {
  // Whole tenths first: 1.2 - 1 is 0.19999999999999996, which would floor to the tenth below.
  const tenthsTotal = Math.floor(Math.max(0, seconds) * 10 + 1e-6);
  const whole = Math.floor(tenthsTotal / 10);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const fraction = tenths ? `.${tenthsTotal % 10}` : "";
  const secs = `${String(whole % 60).padStart(2, "0")}${fraction}`;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

// Zoomed-in looks span a few seconds, where whole seconds would label every sheet the same.
const TENTHS_BELOW_SECONDS = 10;

export function formatSpan(startSeconds: number, endSeconds: number): string {
  if (endSeconds <= startSeconds) return formatTimestamp(startSeconds, startSeconds % 1 !== 0);
  const tenths = endSeconds - startSeconds < TENTHS_BELOW_SECONDS;
  return `${formatTimestamp(startSeconds, tenths)} to ${formatTimestamp(endSeconds, tenths)}`;
}

const HOURS_MINUTES = String.raw`(?:(\d+):)?(\d{1,2}):`;
// Captures hours, minutes and seconds; written by people or models, so seconds may be one digit.
export const CLOCK_TIME = String.raw`${HOURS_MINUTES}(\d{1,2}(?:\.\d+)?)`;
// A cited timestamp needs two-digit seconds, so "[1:4]" in prose is not read as a time.
// Seconds, and minutes after hours, stop at 59, so "1:75" is not one either.
const CITED_HOURS_MINUTES = String.raw`(?:(\d+):(?=[0-5]?\d:))?(\d{1,2}):`;
const CITED_TIME = String.raw`(${CITED_HOURS_MINUTES}([0-5]\d(?:\.\d+)?))`;
const RANGE_SEPARATOR = String.raw`\s*(?:-|–|—|to)\s*`;
const BRACKETED = new RegExp(
  String.raw`\[${CITED_TIME}(?:${RANGE_SEPARATOR}${CITED_TIME})?\]`,
  "dg",
);
const PARENTHESISED = new RegExp(
  String.raw`\(${CITED_TIME}(?:${RANGE_SEPARATOR}${CITED_TIME})?\)`,
  "dg",
);
// Without brackets to vouch for it, "12:30:45:10" or "v1:22" must not read as a time.
const BARE_HOURS_MINUTES = String.raw`(?:(\d+):(?=[0-5]\d:))?(\d{1,2}):`;
const BARE_TIME = String.raw`(${BARE_HOURS_MINUTES}([0-5]\d(?:\.\d+)?))`;
const BARE = new RegExp(
  String.raw`(?<![\d:\p{L}/])${BARE_TIME}(?:${RANGE_SEPARATOR}${BARE_TIME})?(?![\d:\p{L}])`,
  "dgu",
);
// "4:30 pm" and "6:00 a.m." are times of day, not places in the video.
const MERIDIEM_AFTER = /^\s*[aApP]\.?[mM](?![\p{L}\d])/u;
// A model may round the duration up, so a time one second past the end still counts.
const DURATION_SLACK_SECONDS = 1;
const RANGE_START_GROUP = 1;
const RANGE_END_GROUP = 5;
const TIME_INPUT = new RegExp(`^${CLOCK_TIME}$`);

export function clockSeconds([hours, minutes, secs]: readonly (string | undefined)[]): number {
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs);
}

export interface TimestampMatch {
  index: number;
  length: number;
  seconds: number;
}

// Each time spans the text its seek link shows: the whole "[m:ss]", or one end of a range.
export interface CitationMatch {
  index: number;
  length: number;
  times: TimestampMatch[];
}

function citedSeconds(match: RegExpMatchArray, group: number): number {
  return clockSeconds(match.slice(group + 1, group + 4));
}

function rangeEnd(match: RegExpMatchArray, group: number): TimestampMatch[] {
  const span = match.indices?.[group];
  if (span === undefined) return [];
  const [start, end] = span;
  return [{ index: start, length: end - start, seconds: citedSeconds(match, group) }];
}

export interface CitationOptions {
  bare?: boolean;
  maxSeconds?: number;
}

function citationOf(match: RegExpMatchArray): CitationMatch {
  const { index = 0 } = match;
  const { length } = match[0];
  const times =
    match[RANGE_END_GROUP] === undefined
      ? [{ index, length, seconds: citedSeconds(match, RANGE_START_GROUP) }]
      : [...rangeEnd(match, RANGE_START_GROUP), ...rangeEnd(match, RANGE_END_GROUP)];
  return { index, length, times };
}

function plausibleBare(
  text: string,
  citation: CitationMatch,
  maxSeconds: number | undefined,
): boolean {
  return citation.times.every(
    (time) =>
      (maxSeconds === undefined || time.seconds <= maxSeconds + DURATION_SLACK_SECONDS) &&
      !MERIDIEM_AFTER.test(text.slice(time.index + time.length)),
  );
}

// Brackets and parentheses win over a bare time inside them, so each text is claimed once.
export function findCitations(
  text: string,
  { bare = true, maxSeconds }: CitationOptions = {},
): CitationMatch[] {
  const explicit = [BRACKETED, PARENTHESISED].flatMap((pattern) =>
    Array.from(text.matchAll(pattern), citationOf),
  );
  const loose = bare
    ? Array.from(text.matchAll(BARE), citationOf).filter((citation) =>
        plausibleBare(text, citation, maxSeconds),
      )
    : [];
  const found = [...explicit, ...loose];
  found.sort((a, b) => a.index - b.index);
  const kept: CitationMatch[] = [];
  let claimedTo = 0;
  for (const citation of found) {
    if (citation.index < claimedTo) continue;
    kept.push(citation);
    claimedTo = citation.index + citation.length;
  }
  return kept;
}

export function findTimestamps(text: string, options: CitationOptions = {}): TimestampMatch[] {
  return findCitations(text, options).flatMap((citation) => citation.times);
}

// Typed input: brackets optional, plain seconds allowed, and single-digit seconds accepted.
export function parseTimestamp(text: string): number | undefined {
  const trimmed = text.trim().replace(/^\[|\]$/g, "");
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const match = TIME_INPUT.exec(trimmed);
  if (match === null) return undefined;
  return clockSeconds(match.slice(1));
}

export function sceneLogLines(notes: readonly SceneNote[]): string[] {
  return [...notes]
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((note) => `[${formatTimestamp(note.timeSeconds)}] ${note.text}`);
}
