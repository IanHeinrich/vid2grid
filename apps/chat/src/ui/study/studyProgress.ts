import { usageCostUsd } from "../../api/usage";
import { resolveModel } from "../../state";
import { formatSpan } from "../../time";
import type { ModelInfo, VideoTimeline } from "../../types";
import type { ZoomPlan } from "../../video/study";
import {
  currentTimeline,
  finishedZoom,
  studyState,
  videoKey,
  zoomPlanFor,
  type FinishedStudy,
  type FinishedZoom,
  type RunningPass,
  type RunningZoom,
  type StudyContext,
} from "./context";

export function zoomOfferText(plan: ZoomPlan): string {
  const { costUsd, inputTokens, approximate } = plan.estimate;
  const cost =
    costUsd === undefined
      ? `about ${inputTokens.toLocaleString("en-US")} input tokens`
      : `about $${costUsd.toFixed(2)}`;
  const offer = `Zoom into ${count(plan.zooms.length, "unclear moment")}, ${cost}`;
  return `${offer}${approximate ? " (approximate)" : ""}`;
}

export function count(value: number, noun: string, plural = `${noun}s`): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? noun : plural}`;
}

// Offered only on request, while no study runs anywhere.
export function zoomOffer(ctx: StudyContext): string | undefined {
  const timeline = currentTimeline(ctx);
  const plan = ctx.running || !timeline ? undefined : zoomPlanFor(ctx, timeline);
  return plan && zoomOfferText(plan);
}

export function showOffer(button: HTMLButtonElement, offer: string | undefined): void {
  button.hidden = offer === undefined;
  if (offer !== undefined) button.textContent = offer;
}

interface ProgressView {
  kind: "running" | "paused" | "done";
  title: string;
  detail: string;
  done: number;
  total: number;
}

export function renderProgress(ctx: StudyContext, offer: string | undefined): void {
  const { el, title, detail, bar, pauseButton, stopButton, openButton, closeButton, zoomButton } =
    ctx.els.progress;
  const view = progressView(ctx);
  el.hidden = view === undefined;
  renderAudioLine(ctx);
  if (!view) return;
  showOffer(zoomButton, view.kind === "done" ? offer : undefined);
  title.textContent = view.title;
  detail.textContent = view.detail;
  bar.max = Math.max(1, view.total);
  bar.value = view.done;
  pauseButton.textContent = view.kind === "paused" ? "Resume" : "Pause";
  pauseButton.hidden = view.kind === "done";
  stopButton.hidden = view.kind === "done";
  openButton.hidden = view.kind !== "done";
  closeButton.hidden = view.kind !== "done";
}

export function renderAudioLine(ctx: StudyContext): void {
  const { el, audio } = ctx.els.progress;
  const note = ctx.audioNote;
  const fileKey = ctx.running?.fileKey ?? videoKey(ctx);
  const shown = !el.hidden && note !== null && note.fileKey === fileKey;
  audio.hidden = !shown;
  audio.textContent = shown ? note.text : "";
}

function progressView(ctx: StudyContext): ProgressView | undefined {
  if (ctx.running?.kind === "zoom") return zoomingView(ctx, ctx.running);
  if (ctx.running) return runningView(ctx, ctx.running);
  const timeline = currentTimeline(ctx);
  if (!timeline) return undefined;
  const zoom = finishedZoom(ctx);
  if (zoom) return zoomEndedView(ctx, timeline, zoom);
  const study = studyState(ctx);
  if (study === "paused") return pausedView(ctx, timeline);
  if (study === "done" && ctx.finished?.fileKey === timeline.fileKey) {
    return doneView(ctx, timeline, ctx.finished);
  }
  return undefined;
}

function runningView(ctx: StudyContext, running: RunningPass): ProgressView {
  const { nextWindow, windowCount } = running.timeline;
  const range = running.plan.windows[nextWindow];
  const position = `Window ${Math.min(nextWindow + 1, windowCount)} of ${windowCount}`;
  const spent = spentText(running.timeline, running.model);
  return {
    kind: "running",
    title: running.fileKey === videoKey(ctx) ? "Studying the video" : "Studying another video",
    detail: sentences(
      range ? `${position}, ${formatSpan(range.startSeconds, range.endSeconds)}` : position,
      spent && `${spent} so far`,
    ),
    done: nextWindow,
    total: windowCount,
  };
}

function zoomingView(ctx: StudyContext, running: RunningZoom): ProgressView {
  const { done, total } = running;
  const zoom = running.plan.zooms[done - running.carried];
  const position = `Moment ${Math.min(done + 1, total)} of ${total}`;
  const spent = spentText(running.timeline, running.model);
  return {
    kind: "running",
    title:
      running.fileKey === videoKey(ctx)
        ? "Zooming into unclear moments"
        : "Zooming into another video",
    detail: sentences(
      zoom ? `${position}, ${formatSpan(zoom.startSeconds, zoom.endSeconds)}` : position,
      spent && `${spent} so far`,
    ),
    done,
    total,
  };
}

const ZOOM_ENDED_TITLES: Record<FinishedZoom["ending"], (zoom: FinishedZoom) => string> = {
  paused: ({ done, total }) => `Zoom paused at ${done} of ${total}`,
  stopped: ({ done, total }) => `Zoom stopped after ${done} of ${count(total, "moment")}`,
  done: ({ total }) => `Zoom done: ${count(total, "moment")}`,
};

function zoomEndedView(
  ctx: StudyContext,
  timeline: VideoTimeline,
  zoom: FinishedZoom,
): ProgressView {
  const spent = spentText(timeline, resolveModel(ctx.state, timeline.modelId));
  const paused = zoom.ending === "paused";
  return {
    kind: paused ? "paused" : "done",
    title: ZOOM_ENDED_TITLES[zoom.ending](zoom),
    detail: sentences(entriesText(timeline), paused && spent ? `${spent} so far` : spent),
    done: zoom.done,
    total: zoom.total,
  };
}

function pausedView(ctx: StudyContext, timeline: VideoTimeline): ProgressView {
  const spent = spentText(timeline, resolveModel(ctx.state, timeline.modelId));
  return {
    kind: "paused",
    title: `Study paused at ${timeline.nextWindow} of ${timeline.windowCount}`,
    detail: sentences(entriesText(timeline), spent && `${spent} so far`),
    done: timeline.nextWindow,
    total: timeline.windowCount,
  };
}

function doneView(
  ctx: StudyContext,
  timeline: VideoTimeline,
  finished: FinishedStudy,
): ProgressView {
  const { done, total } = finished.stoppedAt ?? {
    done: timeline.windowCount,
    total: timeline.windowCount,
  };
  return {
    kind: "done",
    title: finished.stoppedAt
      ? `Study stopped after ${done} of ${count(total, "window")}`
      : `Study done: ${count(total, "window")}`,
    detail: sentences(
      entriesText(timeline),
      spentText(timeline, resolveModel(ctx.state, timeline.modelId)),
    ),
    done,
    total,
  };
}

function entriesText(timeline: VideoTimeline): string {
  return count(timeline.entries.length, "timeline entry", "timeline entries");
}

function spentText(timeline: VideoTimeline, model: ModelInfo): string | undefined {
  const { usage } = timeline;
  if (usage === undefined) return undefined;
  const tokens = count(usage.promptTokens + usage.completionTokens, "token");
  const cost = usageCostUsd(usage, model.pricing);
  return cost === undefined ? tokens : `${tokens}, $${cost.toFixed(2)}`;
}

function sentences(...parts: (string | undefined)[]): string {
  return parts
    .filter((text): text is string => text !== undefined && text !== "")
    .map((text) => `${text}.`)
    .join(" ");
}
