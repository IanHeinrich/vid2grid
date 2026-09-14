import { formatTimestamp } from "../render/timestampFormat";

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export function formatVttTimestamp(seconds: number): string {
  return formatTimestamp(Math.max(0, seconds), {
    showHours: true,
    showMinutes: true,
    showMilliseconds: true,
  });
}

export function cuesToVtt(cues: TranscriptCue[]): string {
  if (cues.length === 0) return "WEBVTT\n";
  const body = cues
    .map(
      (cue) => `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}`,
    )
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

export function vttToPlainText(vtt: string): string {
  return vtt
    .split("\n")
    .filter((line) => line.trim() !== "" && line !== "WEBVTT" && !line.includes("-->"))
    .join(" ")
    .trim();
}

export function cuesInWindow(
  cues: TranscriptCue[],
  windowStart: number,
  windowEnd: number,
): TranscriptCue[] {
  return cues.filter((cue) => cue.start < windowEnd && cue.end > windowStart);
}
