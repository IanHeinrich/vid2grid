import { errorText } from "../../text";
import { formatTimestamp } from "../../time";
import type { TimelineEntry, UnclearSpan, VideoTimeline } from "../../types";
import { iconButton, inlineEdit, seekButton, smallButton } from "../buttons";
import { offerUndo } from "../toast";
import {
  changed,
  currentTimeline,
  isRunningHere,
  now,
  seekShown,
  shownTimeline,
  shownVideo,
  unzoomed,
  type StudyContext,
} from "./context";
import { showOffer, zoomOffer } from "./studyProgress";

function spanText(entry: Pick<TimelineEntry, "startSeconds" | "endSeconds">): string {
  const start = formatTimestamp(entry.startSeconds);
  return entry.endSeconds > entry.startSeconds
    ? `[${start}-${formatTimestamp(entry.endSeconds)}]`
    : `[${start}]`;
}

const STUDY_HINT = "Study the video to build a timeline the model can use.";
const NONE_SAVED = "No timeline was saved for this video.";

export function renderTimeline(ctx: StudyContext, offer = zoomOffer(ctx)): void {
  const shown = shownVideo(ctx);
  const editable = shown?.current === true;
  const timeline = shownTimeline(ctx);
  const entries = timeline?.entries ?? [];
  const { summary, empty, list, zoomButton } = ctx.els;
  const title = shown ? `Timeline for ${shown.video.name}` : "Timeline";
  summary.textContent = `${title} (${entries.length})`;
  empty.textContent = shown && !editable ? NONE_SAVED : STUDY_HINT;
  empty.hidden = entries.length > 0;
  showOffer(zoomButton, editable ? offer : undefined);
  if (ctx.editing !== null && isRunningHere(ctx)) {
    ctx.editing = null;
    ctx.deps.status.show("Editing is paused while the study runs.");
  }
  if (!editable) ctx.editing = null;
  if (ctx.editing !== null) return;
  const rows = [
    ...entries.map((entry) => ({
      start: entry.startSeconds,
      item: timelineItem(ctx, entry, editable),
    })),
    ...unzoomed(timeline).map((span) => ({
      start: span.startSeconds,
      item: unclearItem(ctx, span),
    })),
  ].sort((a, b) => a.start - b.start);
  list.replaceChildren(...rows.map((row) => row.item));
}

function unclearItem(ctx: StudyContext, span: UnclearSpan): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "timeline-unclear";
  const time = seekButton(span.startSeconds, seekShown(ctx), spanText(span));
  const text = document.createElement("span");
  text.className = "timeline-text";
  text.textContent = span.reason === "" ? " Unclear" : ` Unclear: ${span.reason}`;
  item.append(time, text);
  return item;
}

function timelineItem(ctx: StudyContext, entry: TimelineEntry, editable: boolean): HTMLLIElement {
  const item = document.createElement("li");
  const time = seekButton(entry.startSeconds, seekShown(ctx), spanText(entry));
  const text = document.createElement("span");
  text.className = "timeline-text";
  text.textContent = ` ${entry.text}`;
  item.append(time, text);
  if (entry.zoomed === true) item.append(zoomedMarker());
  if (!editable) return item;
  const edit = smallButton("note-edit", "Edit", () => startEdit(ctx, item, text, entry));
  const remove = iconButton("note-delete", "Delete this entry", "×", () => removeEntry(ctx, entry));
  edit.disabled = isRunningHere(ctx);
  remove.disabled = edit.disabled;
  item.append(edit, remove);
  return item;
}

function zoomedMarker(): HTMLSpanElement {
  const marker = document.createElement("span");
  marker.className = "timeline-zoomed";
  marker.textContent = "zoomed";
  marker.title = "Written from a closer look at denser frames";
  return marker;
}

function startEdit(
  ctx: StudyContext,
  item: HTMLLIElement,
  text: HTMLElement,
  entry: TimelineEntry,
): void {
  if (ctx.editing !== null || isRunningHere(ctx)) return;
  ctx.editing = entry;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "timeline-input";
  input.value = entry.text;
  input.setAttribute("aria-label", "Timeline entry");
  inlineEdit(input, (save) => {
    // A study starting closes the editor, and its blur must not save.
    if (ctx.editing !== entry) return;
    ctx.editing = null;
    const value = input.value.trim();
    if (save && value !== "" && value !== entry.text) {
      changeEntry(ctx, entry, "Timeline entry edited", (entries, index) =>
        entries.map((current, i) => (i === index ? { ...current, text: value } : current)),
      );
    } else {
      renderTimeline(ctx);
    }
  });
  text.replaceWith(input);
  item.classList.add("is-editing");
  input.focus();
}

function removeEntry(ctx: StudyContext, entry: TimelineEntry): void {
  changeEntry(ctx, entry, "Timeline entry deleted", (entries, index) =>
    entries.filter((_, i) => i !== index),
  );
}

// A zoom step re-sorts entries and replaces some, so a row finds its entry by identity.
function changeEntry(
  ctx: StudyContext,
  entry: TimelineEntry,
  done: string,
  change: (entries: TimelineEntry[], index: number) => TimelineEntry[],
): void {
  if (isRunningHere(ctx)) return;
  const index = currentTimeline(ctx)?.entries.indexOf(entry) ?? -1;
  if (index === -1) {
    ctx.deps.status.show("That entry has changed since, so the change was dropped.");
    renderTimeline(ctx);
    return;
  }
  updateTimeline(ctx, done, (timeline) => ({
    ...timeline,
    entries: change(timeline.entries, index),
  }));
}

export function clearTimeline(ctx: StudyContext): void {
  if (isRunningHere(ctx)) return;
  ctx.finished = null;
  updateTimeline(ctx, "Timeline cleared", (timeline) => ({
    ...timeline,
    entries: [],
    nextWindow: 0,
    ...(timeline.unclear !== undefined && { unclear: [] }),
  }));
}

function updateTimeline(
  ctx: StudyContext,
  done: string,
  change: (timeline: VideoTimeline) => VideoTimeline,
): void {
  const before = currentTimeline(ctx);
  if (!before) return;
  const after = { ...change(before), updatedAt: now(ctx) };
  saveTimeline(ctx, after);
  offerTimelineUndo(ctx, done, before, after);
}

function saveTimeline(ctx: StudyContext, timeline: VideoTimeline): void {
  ctx.timelines.set(timeline.fileKey, timeline);
  changed(ctx);
  ctx.deps.store.putTimeline(timeline).catch((error: unknown) => {
    ctx.deps.status.show(`Could not save the timeline: ${errorText(error)}`, "error");
  });
}

export function dropUndo(ctx: StudyContext): void {
  ctx.pendingUndo?.dismiss();
  ctx.pendingUndo = null;
}

function offerTimelineUndo(
  ctx: StudyContext,
  done: string,
  before: VideoTimeline,
  after: VideoTimeline,
): void {
  dropUndo(ctx);
  ctx.pendingUndo = offerUndo(ctx.deps.toast, done, {
    undo: () => {
      ctx.pendingUndo = null;
      undo(ctx, before, after);
    },
  });
}

// A running study may have appended windows since, and those stay.
function undo(ctx: StudyContext, before: VideoTimeline, after: VideoTimeline): void {
  const latest = ctx.timelines.get(before.fileKey) ?? after;
  const unclear = after.unclear === before.unclear ? latest.unclear : before.unclear;
  saveTimeline(ctx, {
    ...latest,
    entries: [...before.entries, ...latest.entries.slice(after.entries.length)],
    nextWindow: Math.max(before.nextWindow, latest.nextWindow),
    ...(unclear !== undefined && { unclear }),
    updatedAt: now(ctx),
  });
}
