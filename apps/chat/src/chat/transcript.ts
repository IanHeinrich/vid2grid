import { sameSpans } from "../spans";
import { formatTimestamp, parseTimestamp, spanListText, timedLine } from "../time";
import type {
  AudioSpan,
  ChatMessage,
  ModelInfo,
  SentTranscript,
  UserMessage,
  VideoAttachment,
  VideoAudio,
} from "../types";
import { currentTurn, newestUserMessage } from "./imageSelection";
import { FALLBACK_CONTEXT_TOKENS } from "./summary";
import { CHARS_PER_TOKEN } from "./tokenEstimate";

const MAX_TRANSCRIPT_TOKENS = 16_000;
const TRANSCRIPT_CONTEXT_SHARE = 0.25;
const MAX_LINE_CHARS = 240;
const MAX_LINE_SECONDS = 20;
const MAX_PAUSE_SECONDS = 2;
// Substantially more speech: the text is at least a quarter longer than the last one sent.
const RESEND_GROWTH = 1.25;
const EDGE_SECONDS = 0.5;

export type HeardSpeech = Pick<VideoAudio, "fileKey" | "speechSpans" | "speech">;

export interface SpeechLine {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export function transcriptTokenCap({ contextTokens }: Pick<ModelInfo, "contextTokens">): number {
  const share = (contextTokens ?? FALLBACK_CONTEXT_TOKENS) * TRANSCRIPT_CONTEXT_SHARE;
  return Math.min(MAX_TRANSCRIPT_TOKENS, Math.floor(share));
}

function joins(line: SpeechLine, next: SpeechLine): boolean {
  return (
    next.startSeconds - line.endSeconds <= MAX_PAUSE_SECONDS &&
    next.endSeconds - line.startSeconds <= MAX_LINE_SECONDS &&
    line.text.length + 1 + next.text.length <= MAX_LINE_CHARS
  );
}

// Neighbouring cues become one line, never across a stretch that was not heard.
export function speechLines(
  { speech }: Pick<HeardSpeech, "speech">,
  spans: readonly AudioSpan[],
): SpeechLine[] {
  return spans.flatMap((span) => {
    const lines: SpeechLine[] = [];
    for (const cue of speech) {
      const text = cue.text.trim();
      if (text === "" || cue.start < span.startSeconds || cue.start >= span.endSeconds) continue;
      const next = { startSeconds: cue.start, endSeconds: cue.end, text };
      const last = lines.at(-1);
      if (last && joins(last, next)) {
        last.endSeconds = next.endSeconds;
        last.text = `${last.text} ${text}`;
      } else {
        lines.push(next);
      }
    }
    return lines;
  });
}

function lineText(line: SpeechLine): string {
  return timedLine(formatTimestamp(line.startSeconds), line.text);
}

// In UTF-8 bytes, since scripts beyond Latin take more tokens per character and more bytes too.
function tokensOf(text: string): number {
  return new TextEncoder().encode(text).length / CHARS_PER_TOKEN;
}

function fittingLines(
  lines: readonly SpeechLine[],
  capTokens: number,
): { lines: readonly SpeechLine[]; cutSeconds?: number } {
  let tokens = 0;
  for (const [index, line] of lines.entries()) {
    tokens += tokensOf(`${lineText(line)}\n`);
    if (tokens > capTokens) return { lines: lines.slice(0, index), cutSeconds: line.startSeconds };
  }
  return { lines };
}

function recordedLines(record: SentTranscript, speech: HeardSpeech): SpeechLine[] {
  const { cutSeconds = Infinity } = record;
  return speechLines(speech, record.spans).filter((line) => line.startSeconds < cutSeconds);
}

function textLength(record: SentTranscript, speech: HeardSpeech): number {
  return recordedLines(record, speech).reduce((sum, line) => sum + line.text.length, 0);
}

function transcriptNow(speech: HeardSpeech, capTokens: number): SentTranscript | undefined {
  const fitted = fittingLines(speechLines(speech, speech.speechSpans), capTokens);
  if (fitted.lines.length === 0) return undefined;
  return {
    fileKey: speech.fileKey,
    spans: speech.speechSpans.map((span) => ({ ...span })),
    ...(fitted.cutSeconds === undefined ? {} : { cutSeconds: fitted.cutSeconds }),
  };
}

// A message no reply followed may never have reached the model, so its transcript does not count.
function lastAnswered(
  messages: readonly ChatMessage[],
  fileKey: string,
): SentTranscript | undefined {
  let last: SentTranscript | undefined;
  let waiting: SentTranscript | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      waiting = message.transcript?.fileKey === fileKey ? message.transcript : undefined;
    } else if (waiting) {
      last = waiting;
    }
  }
  return last;
}

// Keep going must not change the prefix of the investigation it continues.
function heldEarlierInTurn(messages: readonly ChatMessage[], fileKey: string): boolean {
  const newest = newestUserMessage(messages);
  return currentTurn(messages).some(
    (message) =>
      message.role === "user" &&
      message.id !== newest?.id &&
      message.transcript?.fileKey === fileKey,
  );
}

// At the cap the text cannot grow, so speech heard before the last one's start counts on its own.
function reachesEarlier(next: SentTranscript, last: SentTranscript): boolean {
  const [first] = next.spans;
  const [lastFirst] = last.spans;
  if (next.cutSeconds === undefined || !first || !lastFirst) return false;
  return first.startSeconds < lastFirst.startSeconds;
}

// What the newest message should carry: the first transcript the request would hold, or one that
// has grown enough. Messages are those the request still sends, the newest included.
export function transcriptToCarry(
  messages: readonly ChatMessage[],
  speech: HeardSpeech,
  capTokens: number,
): SentTranscript | undefined {
  if (heldEarlierInTurn(messages, speech.fileKey)) return undefined;
  const next = transcriptNow(speech, capTokens);
  const last = lastAnswered(messages, speech.fileKey);
  if (!next || !last) return next;
  const grown = textLength(next, speech) >= textLength(last, speech) * RESEND_GROWTH;
  return grown || reachesEarlier(next, last) ? next : undefined;
}

export function sameTranscript(
  a: SentTranscript | undefined,
  b: SentTranscript | undefined,
): boolean {
  if (!a || !b) return a === b;
  return a.fileKey === b.fileKey && a.cutSeconds === b.cutSeconds && sameSpans(a.spans, b.spans);
}

// The times the model read on a sent transcript's lines, to the whole second the lines show.
export function transcriptTimes(
  messages: readonly ChatMessage[],
  speech: HeardSpeech | undefined,
  capTokens: number,
): number[] {
  return messages.flatMap((message) => {
    const record = message.role === "user" ? message.transcript : undefined;
    if (!record || speech?.fileKey !== record.fileKey) return [];
    const { lines } = fittingLines(recordedLines(record, speech), capTokens);
    return lines.flatMap((line) => parseTimestamp(formatTimestamp(line.startSeconds)) ?? []);
  });
}

// The ranges the text covers: what had been heard, up to the cut.
export function sentSpans({ spans, cutSeconds = Infinity }: SentTranscript): AudioSpan[] {
  return spans
    .filter((span) => span.startSeconds < cutSeconds)
    .map((span) => ({ ...span, endSeconds: Math.min(span.endSeconds, cutSeconds) }));
}

// Where the text ends, when it covers everything from the start of the video to there.
function simpleEnd(record: SentTranscript): number | undefined {
  const [first, ...more] = sentSpans(record);
  return first?.startSeconds === 0 && more.length === 0 ? first.endSeconds : undefined;
}

export function transcriptSentText(record: SentTranscript): string {
  const end = simpleEnd(record);
  return end === undefined
    ? `Transcript of ${spanListText(sentSpans(record))} sent`
    : `Transcript to ${formatTimestamp(end)} sent`;
}

export interface TranscriptContext {
  // The stored speech of the video the current turn is about, when audio is on for it.
  speech: HeardSpeech | undefined;
  video: VideoAttachment | undefined;
  capTokens: number;
  listen: boolean;
}

export interface TranscriptTexts {
  byMessage: ReadonlyMap<string, string>;
  // The request holds one in full.
  sentInFull: boolean;
}

function heardLine(record: SentTranscript, { video, listen }: TranscriptContext): string {
  const heard = spanListText(record.spans);
  const duration = video?.durationSeconds ?? Infinity;
  const [first] = record.spans;
  const whole =
    record.spans.length === 1 &&
    first !== undefined &&
    first.startSeconds <= EDGE_SECONDS &&
    first.endSeconds >= duration - EDGE_SECONDS;
  if (whole)
    return `Heard: ${heard}, the whole video. Where there is no line, no speech was heard.`;
  const how = listen ? " Call listen(start, end) to hear more." : "";
  return `Heard so far: ${heard}. The rest of the video has not been heard yet, so no lines there does not mean no speech.${how}`;
}

function leftOutLine(
  cutSeconds: number,
  record: SentTranscript,
  { listen }: TranscriptContext,
): string {
  const end = record.spans.at(-1)?.endSeconds ?? cutSeconds;
  const span = spanListText([{ startSeconds: cutSeconds, endSeconds: end }]);
  const from = Math.floor(cutSeconds);
  const how = listen ? ` Call listen(start, end) from ${from} seconds on to read it.` : "";
  return `The transcript stops here to save room: ${span} is not included.${how}`;
}

function fullText(record: SentTranscript, context: TranscriptContext): string | undefined {
  const { speech, capTokens } = context;
  if (speech?.fileKey !== record.fileKey) return undefined;
  const fitted = fittingLines(recordedLines(record, speech), capTokens);
  if (fitted.lines.length === 0) return undefined;
  const cutSeconds = fitted.cutSeconds ?? record.cutSeconds;
  return [
    "Transcript of the video's speech, from the app (not written by the user). Each line is [m:ss] and what was heard, and speech can be misheard.",
    heardLine(record, context),
    ...fitted.lines.map(lineText),
    ...(cutSeconds === undefined ? [] : [leftOutLine(cutSeconds, record, context)]),
  ].join("\n");
}

function stub(record: SentTranscript, { video, listen }: TranscriptContext): string {
  const current = record.fileKey === video?.fileKey;
  const end = simpleEnd(record);
  const range =
    end === undefined ? `, ${spanListText(sentSpans(record))}` : ` up to ${formatTimestamp(end)}`;
  const what = `Transcript of ${current ? "the" : "an earlier"} video's speech${range}`;
  const how = current && listen ? "; call listen(start, end) to read any range again" : "";
  return `[${what}. Sent earlier${how}.]`;
}

// With no listen to read it again, the model keeps the text it was given on later turns too.
function staysInFull(
  { id, transcript }: UserMessage,
  inTurn: ReadonlySet<string>,
  { video, listen }: TranscriptContext,
): boolean {
  return inTurn.has(id) || (!listen && transcript?.fileKey === video?.fileKey);
}

export function transcriptTexts(
  messages: readonly ChatMessage[],
  context: TranscriptContext,
): TranscriptTexts {
  const carriers = messages.flatMap((message) =>
    message.role === "user" && message.transcript ? [message] : [],
  );
  const inTurn = new Set(currentTurn(messages).map((message) => message.id));
  const newest = carriers.at(-1);
  const byMessage = new Map<string, string>();
  let sentInFull = false;
  for (const message of carriers) {
    if (!message.transcript) continue;
    const inFull = message === newest && staysInFull(message, inTurn, context);
    const text = inFull ? fullText(message.transcript, context) : undefined;
    byMessage.set(message.id, text ?? stub(message.transcript, context));
    if (text !== undefined) sentInFull = true;
  }
  return { byMessage, sentInFull };
}
