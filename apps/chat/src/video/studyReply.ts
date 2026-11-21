import { clamp } from "../spans";
import { BULLET, parseTimedLine, SPAN_AND_TEXT, timedLineOf } from "../time";
import type { TimelineEntry, TokenUsage, UnclearSpan } from "../types";
import type { StudyWindow } from "./studyPlan";
import { touchesInside } from "./zoom";

const UNCLEAR_LINE = new RegExp(String.raw`${BULLET}UNCLEAR\b\s*:?\s*${SPAN_AND_TEXT}`, "i");

export interface StudyReply {
  entries: TimelineEntry[];
  unclear: UnclearSpan[];
}

export interface StudiedWindow extends StudyReply {
  usage?: TokenUsage;
}

export function parseStudyReply(reply: string, range: StudyWindow): StudyReply {
  const entries: TimelineEntry[] = [];
  const unclear: UnclearSpan[] = [];
  let extend: ((text: string) => void) | undefined;
  let flaggedAny = false;
  for (const line of reply.split(/\r?\n/)) {
    const text = line.trim();
    if (text === "") continue;
    const flagged = UNCLEAR_LINE.exec(text);
    const timed = flagged === null ? parseTimedLine(text) : timedLineOf(flagged);
    if (timed === undefined) {
      extend?.(text);
      continue;
    }
    flaggedAny ||= flagged !== null;
    const { startSeconds: start, endSeconds: end, text: body } = timed;
    if (flagged === null) {
      const entry: TimelineEntry = { startSeconds: start, endSeconds: end, text: body };
      entries.push(entry);
      extend = (more) => {
        entry.text = `${entry.text} ${more}`.trim();
      };
    } else if (!touchesInside({ startSeconds: start, endSeconds: end }, range)) {
      extend = undefined;
    } else {
      const startSeconds = clamp(start, range.startSeconds, range.endSeconds);
      const span: UnclearSpan = {
        startSeconds,
        endSeconds: clamp(end, startSeconds, range.endSeconds),
        reason: body,
      };
      unclear.push(span);
      extend = (more) => {
        span.reason = `${span.reason} ${more}`.trim();
      };
    }
  }
  const usable = entries.filter((entry) => entry.text !== "");
  const whole = reply.trim();
  if (usable.length > 0 || flaggedAny || whole === "") return { entries: usable, unclear };
  return {
    entries: [{ startSeconds: range.startSeconds, endSeconds: range.endSeconds, text: whole }],
    unclear,
  };
}
