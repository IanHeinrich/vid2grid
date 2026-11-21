import { addUsage } from "../api/usage";
import { clamp } from "../spans";
import { formatSpan, timedLine } from "../time";
import type { TimelineEntry, UnclearSpan, VideoTimeline } from "../types";
import type { StudyWindow } from "./studyPlan";
import type { StudiedWindow } from "./studyReply";

function overlaps(span: StudyWindow, range: StudyWindow): boolean {
  return span.startSeconds <= range.endSeconds && span.endSeconds >= range.startSeconds;
}

function overlapSeconds(span: StudyWindow, range: StudyWindow): number {
  return (
    Math.min(span.endSeconds, range.endSeconds) - Math.max(span.startSeconds, range.startSeconds)
  );
}

export function coarseContext(timeline: VideoTimeline, zoom: StudyWindow): string {
  const entries = timeline.entries
    .filter((entry) => overlaps(entry, zoom))
    .map((entry) => timedLine(formatSpan(entry.startSeconds, entry.endSeconds), entry.text));
  const unclear = (timeline.unclear ?? [])
    .filter((span) => span.zoomed !== true && overlaps(span, zoom))
    .map((span) =>
      timedLine(formatSpan(span.startSeconds, span.endSeconds), `unclear: ${span.reason}`),
    );
  const lines = [...entries, ...unclear];
  return lines.length === 0
    ? "The coarse timeline has nothing for this stretch."
    : ["Coarse timeline for this stretch:", ...lines].join("\n");
}

// A reply with no entries leaves the coarse entries and the flag, so the zoom can be retried.
export function applyZoom(
  timeline: VideoTimeline,
  zoom: StudyWindow,
  studied: StudiedWindow,
): VideoTimeline {
  const usage = addUsage(timeline.usage, studied.usage);
  const withUsage = { ...timeline, updatedAt: Date.now(), ...(usage !== undefined && { usage }) };
  const zoomed = clampedInside(studied.entries, zoom).map((entry): TimelineEntry => ({
    ...entry,
    zoomed: true,
  }));
  if (zoomed.length === 0) return withUsage;
  const mostlyInside = (entry: TimelineEntry) =>
    overlapSeconds(entry, zoom) >= (entry.endSeconds - entry.startSeconds) / 2;
  const entries = [...timeline.entries.filter((entry) => !mostlyInside(entry)), ...zoomed].sort(
    (a, b) => a.startSeconds - b.startSeconds,
  );
  return { ...withUsage, entries, unclear: markZoomed(timeline.unclear ?? [], zoom) };
}

// A moment counts when it lies in the zoom; a longer entry only when it runs into it.
export function touchesInside(entry: StudyWindow, zoom: StudyWindow): boolean {
  const overlap = overlapSeconds(entry, zoom);
  return overlap > 0 || (overlap === 0 && entry.startSeconds === entry.endSeconds);
}

export function clampedInside(
  entries: readonly TimelineEntry[],
  span: StudyWindow,
): TimelineEntry[] {
  return entries
    .filter((entry) => touchesInside(entry, span))
    .map((entry) => {
      const startSeconds = clamp(entry.startSeconds, span.startSeconds, span.endSeconds);
      const endSeconds = clamp(entry.endSeconds, startSeconds, span.endSeconds);
      return { ...entry, startSeconds, endSeconds };
    });
}

// The part of a span the zoom covered is marked; any part outside it stays flagged.
function markZoomed(unclear: readonly UnclearSpan[], zoom: StudyWindow): UnclearSpan[] {
  return unclear.flatMap((span): UnclearSpan[] => {
    if (span.zoomed === true || !overlaps(span, zoom)) return [span];
    const covered: UnclearSpan = {
      ...span,
      startSeconds: Math.max(span.startSeconds, zoom.startSeconds),
      endSeconds: Math.min(span.endSeconds, zoom.endSeconds),
      zoomed: true,
    };
    const before = span.startSeconds < zoom.startSeconds;
    const after = span.endSeconds > zoom.endSeconds;
    return [
      ...(before ? [{ ...span, endSeconds: zoom.startSeconds }] : []),
      covered,
      ...(after ? [{ ...span, startSeconds: zoom.endSeconds }] : []),
    ];
  });
}
