import { formatClock } from "../presentation";
import type { TranscriptCue } from "../transcript/vtt";
import type { SoundEvent } from "./soundEvents";

const LOUD_DB = 6;
const QUIET_DB = -6;
const SCORE_DECIMALS = 2;

export interface AudioTrack {
  speech: TranscriptCue[];
  events: SoundEvent[];
  startSeconds: number;
  durationSeconds: number;
}

export interface AudioTrackRange {
  startSeconds: number;
  endSeconds: number;
}

interface TimedLine {
  start: number;
  end: number;
  line: string;
}

function loudnessWord(loudnessDb: number): string {
  if (loudnessDb >= LOUD_DB) return "loud";
  if (loudnessDb <= QUIET_DB) return "quiet";
  return "moderate";
}

function signedDb(loudnessDb: number): string {
  const rounded = Math.round(loudnessDb);
  return `${rounded > 0 ? "+" : ""}${rounded} dB`;
}

function soundEventLine(event: SoundEvent): string {
  const parts = [
    `${event.label} ${event.score.toFixed(SCORE_DECIMALS)}`,
    `${loudnessWord(event.loudnessDb)} (${signedDb(event.loudnessDb)})`,
  ];
  if (event.ratePerMinute !== undefined) parts.push(`about ${Math.round(event.ratePerMinute)}/min`);
  return `[${formatClock(event.startSeconds)}-${formatClock(event.endSeconds)}] ${parts.join(", ")}`;
}

// Whisper writes a non-speech sound it hears as a lone tag, such as "(laughter)" or "[music]".
const LONE_TAG = /^(?:\(([^()[\]]+)\)|\[([^()[\]]+)\])$/;

function speechLine(cue: TranscriptCue): string {
  const tag = LONE_TAG.exec(cue.text.trim());
  const sound = (tag?.[1] ?? tag?.[2])?.trim();
  return sound
    ? `[${formatClock(cue.start)}] sound: ${sound}`
    : `[${formatClock(cue.start)}] "${cue.text}"`;
}

export function audioTrackLines(track: AudioTrack, range?: AudioTrackRange): string[] {
  const lines: TimedLine[] = [
    ...track.speech
      .filter((cue) => cue.text !== "")
      .map((cue) => ({ start: cue.start, end: cue.end, line: speechLine(cue) })),
    ...track.events.map((event) => ({
      start: event.startSeconds,
      end: event.endSeconds,
      line: soundEventLine(event),
    })),
  ];
  return lines
    .filter(
      (entry) => !range || (entry.start < range.endSeconds && entry.end >= range.startSeconds),
    )
    .sort((a, b) => a.start - b.start)
    .map((entry) => entry.line);
}
