export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

/** Separate from `formatTimestamp` because WebVTT demands a fixed-width HH:MM:SS.mmm. */
export function formatVttTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return (
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:` +
    `${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
  );
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
