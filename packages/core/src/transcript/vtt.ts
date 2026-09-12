export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

/** WebVTT requires a fixed-width HH:MM:SS.mmm timestamp, unlike the adaptive,
 * component-dropping format `paintCollageSheet` burns into grid cells. */
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

/** Strips VTT structure down to just the spoken text, for lightweight gallery previews. */
export function vttToPlainText(vtt: string): string {
  return vtt
    .split("\n")
    .filter((line) => line.trim() !== "" && line !== "WEBVTT" && !line.includes("-->"))
    .join(" ")
    .trim();
}

/** A cue belongs to a sheet's window if it overlaps `[windowStart, windowEnd)` at all. */
export function cuesInWindow(
  cues: TranscriptCue[],
  windowStart: number,
  windowEnd: number,
): TranscriptCue[] {
  return cues.filter((cue) => cue.start < windowEnd && cue.end > windowStart);
}
