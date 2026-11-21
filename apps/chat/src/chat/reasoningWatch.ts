import type { Thoroughness } from "../types";

// Generous for honest deliberation: a normal reply still thinking past this with no answer is stuck.
export const REASONING_LIMIT_CHARS = 24_000;
const REASONING_LIMIT_SCALE: Record<Thoroughness, number> = {
  normal: 1,
  thorough: 2,
  exhaustive: 4,
};
const LOOP_SENTENCE_MIN_CHARS = 25;
export const LOOP_SENTENCE_REPEATS = 4;
// Repeats count only among recent sentences, so filler said now and then across a long trace is fine.
export const LOOP_WINDOW_SENTENCES = 40;
// Far longer than any sentence worth matching; past it the unfinished sentence stops growing.
const MAX_PENDING_CHARS = 2_000;
const SENTENCE_END = /[.!?\n]+/;

export function reasoningLimit(tier: Thoroughness): number {
  return REASONING_LIMIT_CHARS * REASONING_LIMIT_SCALE[tier];
}

function normaliseSentence(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function recentSentences(): (sentence: string) => number {
  const window: string[] = [];
  const counts = new Map<string, number>();
  return (sentence) => {
    window.push(sentence);
    counts.set(sentence, (counts.get(sentence) ?? 0) + 1);
    const dropped = window.length > LOOP_WINDOW_SENTENCES ? window.shift() : undefined;
    if (dropped !== undefined) counts.set(dropped, (counts.get(dropped) ?? 1) - 1);
    return counts.get(sentence) ?? 0;
  };
}

// Fed reasoning as it streams; true once a sentence keeps coming back or the reasoning runs too long.
// Only the new delta is split, so a long stream costs time in proportion to its length.
export function reasoningLoopWatch(limitChars: number): (delta: string) => boolean {
  const remember = recentSentences();
  let length = 0;
  let pending = "";
  return (delta) => {
    length += delta.length;
    if (length > limitChars) return true;
    const pieces = delta.split(SENTENCE_END);
    const last = pieces.pop() ?? "";
    if (pieces.length === 0) {
      pending = (pending + last).slice(0, MAX_PENDING_CHARS);
      return false;
    }
    const finished = [pending + (pieces[0] ?? ""), ...pieces.slice(1)];
    pending = last.slice(0, MAX_PENDING_CHARS);
    return finished.some((piece) => {
      const sentence = normaliseSentence(piece);
      if (sentence.length < LOOP_SENTENCE_MIN_CHARS) return false;
      return remember(sentence) >= LOOP_SENTENCE_REPEATS;
    });
  };
}
