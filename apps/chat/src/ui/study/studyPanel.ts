import { resolveModel } from "../../chat/models";
import { part, type AppElements } from "../../dom";
import type { AppState } from "../../state";
import { errorText } from "../../text";
import type { Chat, ModelInfo, StudyPlanOptions, VideoTimeline } from "../../types";
import { resolveSheetResolution } from "../../video/resolution";
import {
  DEFAULT_WINDOW_SECONDS,
  newTimeline,
  runStudy,
  runZoom,
  type StudyDeps as RunDeps,
  type StudyPlan,
  type ZoomDeps,
} from "../../video/study";
import type { ToolContext } from "../../video/tools";
import { headerLabel } from "../buttons";
import { icon, type IconName } from "../icons";
import { attachMenu } from "../menu";
import { createModelPicker } from "../modelPicker";
import { storedPickerSettings } from "../pickerModel";
import { modelCallDeps } from "../../app/modelCallDeps";
import {
  changed,
  currentTimeline,
  finishedZoom,
  isRunningHere,
  now,
  planFor,
  shownVideo,
  studyState,
  videoKey,
  zoomPlanFor,
  type RunningPass,
  type RunningStudy,
  type RunningZoom,
  type StudyContext,
  type StudyDeps,
  type StudyMenu,
  type StudyState,
} from "./context";
import { listenAudioList, renderAudioList } from "./audioList";
import { listenAlong } from "./studyAudio";
import { listenSettings, openDialog, readSettings, renderEstimate } from "./studyDialog";
import { renderProgress, showOffer, zoomOffer } from "./studyProgress";
import { clearTimeline, dropUndo, renderTimeline } from "./timelineList";

export type { StudyDeps } from "./context";

export interface Study {
  open(): void;
  pause(): void;
  timeline(): VideoTimeline | undefined;
  status(): string;
  render(): void;
}

interface RunContext {
  toolCtx: ToolContext;
  chat: Chat;
}

export function initStudy(
  els: Pick<AppElements, "study" | "templates">,
  state: AppState,
  deps: StudyDeps,
): Study {
  const choice = { modelId: "" };
  const menu = studyMenu(els.study.button);
  const ctx: StudyContext = {
    els: els.study,
    menu,
    menuHandle: attachMenu({
      control: menu.control,
      button: menu.toggle,
      list: menu.menu,
      items: ".study-menu-item",
      onPick: (item) => pickMenuItem(ctx, item),
    }),
    state,
    deps,
    timelines: new Map(),
    loaded: new Set(),
    plans: new Map(),
    running: null,
    finished: null,
    audioNote: null,
    heard: new Map(),
    showAllAudio: undefined,
    editing: null,
    restart: false,
    pendingUndo: null,
    choice,
    picker: createModelPicker(
      { mount: els.study.modelPicker, ...els.templates },
      {
        models: () => state.models,
        current: () => choice.modelId,
        onPick: (id) => {
          choice.modelId = id;
          renderEstimate(ctx);
        },
        settings: storedPickerSettings(state, deps.storage),
      },
    ),
    render: () => render(ctx),
  };
  ctx.els.windowInput.value = String(DEFAULT_WINDOW_SECONDS);
  listen(ctx);
  listenSettings(ctx);
  listenProgress(ctx);
  listenAudioList(ctx);
  render(ctx);
  return {
    open: () => openDialog(ctx, false),
    pause: () => ctx.running?.controller.abort(),
    timeline: () => usableTimeline(ctx),
    status: () => statusText(ctx),
    render: () => render(ctx),
  };
}

function studyMenu(button: HTMLButtonElement): StudyMenu {
  const control = button.closest(".study-control");
  if (!(control instanceof HTMLElement)) throw new Error("Missing element: .study-control");
  return {
    control,
    toggle: part(control, ".study-menu-button", HTMLButtonElement),
    menu: part(control, ".study-menu", HTMLElement),
    restart: part(control, ".study-restart", HTMLButtonElement),
    zoom: part(control, ".study-zoom", HTMLButtonElement),
  };
}

function listen(ctx: StudyContext): void {
  const { button, dialog, zoomButton } = ctx.els;
  button.addEventListener("click", () => {
    switch (studyState(ctx)) {
      case "running":
        ctx.running?.controller.abort();
        return;
      case "paused":
        reportStudyFailure(ctx, resume(ctx));
        return;
      case "done":
        openDialog(ctx, true);
        return;
      case "idle":
        openDialog(ctx, false);
        return;
      case "busy":
        return;
    }
  });
  zoomButton.addEventListener("click", () => reportStudyFailure(ctx, startZoom(ctx)));
  dialog.addEventListener("close", () => {
    ctx.picker.close();
    const settings = readSettings(ctx);
    if (dialog.returnValue === "start" && settings) {
      reportStudyFailure(ctx, start(ctx, ctx.choice.modelId, ctx.restart, settings));
    }
  });
}

function listenProgress(ctx: StudyContext): void {
  const { pauseButton, stopButton, openButton, closeButton, zoomButton } = ctx.els.progress;
  pauseButton.addEventListener("click", () => {
    if (ctx.running) ctx.running.controller.abort();
    else if (finishedZoom(ctx)?.ending === "paused") reportStudyFailure(ctx, startZoom(ctx));
    else reportStudyFailure(ctx, resume(ctx));
  });
  stopButton.addEventListener("click", () => reportStudyFailure(ctx, stop(ctx)));
  zoomButton.addEventListener("click", () => reportStudyFailure(ctx, startZoom(ctx)));
  openButton.addEventListener("click", () => ctx.deps.openTimeline());
  closeButton.addEventListener("click", () => {
    ctx.finished = null;
    ctx.audioNote = null;
    render(ctx);
  });
}

function pickMenuItem(ctx: StudyContext, item: HTMLElement): void {
  if (item === ctx.menu.restart) openDialog(ctx, true);
  else if (item === ctx.menu.zoom) reportStudyFailure(ctx, startZoom(ctx));
  else if (item === ctx.els.clearButton) clearTimeline(ctx);
}

function reportStudyFailure(ctx: StudyContext, work: Promise<void>): void {
  work.catch((error: unknown) => {
    ctx.deps.status.show(`The study stopped: ${errorText(error)}`, "error");
  });
}

function usableTimeline(ctx: StudyContext): VideoTimeline | undefined {
  const timeline = currentTimeline(ctx);
  return timeline && timeline.entries.length > 0 ? timeline : undefined;
}

const BUTTON_ICONS: Record<StudyState, IconName> = {
  idle: "search",
  running: "pause",
  busy: "search",
  paused: "play",
  done: "search",
};

const STUDY_TOOLTIP =
  "Reads the whole video once and saves a timeline every chat with this video can use";

const BUTTON_LABELS: Record<StudyState, string> = {
  idle: "Study video",
  running: "Pause",
  busy: "Study video",
  paused: "Resume",
  done: "Restudy",
};

function buttonTitle(study: StudyState): string {
  if (study === "busy") return "Another video is being studied";
  if (study === "idle" || study === "done") return STUDY_TOOLTIP;
  return BUTTON_LABELS[study];
}

function statusText(ctx: StudyContext): string {
  const timeline = currentTimeline(ctx);
  if (isRunningHere(ctx) && ctx.running?.kind === "zoom") {
    const { done, total } = ctx.running;
    return `Zooming ${Math.min(done + 1, total)} of ${total}`;
  }
  if (isRunningHere(ctx) && ctx.running) {
    const { nextWindow, windowCount } = ctx.running.timeline;
    return `Studying ${Math.min(nextWindow + 1, windowCount)} of ${windowCount}`;
  }
  if (!timeline || timeline.nextWindow === 0) return "";
  if (timeline.nextWindow < timeline.windowCount) {
    return `Study paused at ${timeline.nextWindow} of ${timeline.windowCount}`;
  }
  return "Timeline ready";
}

async function start(
  ctx: StudyContext,
  modelId: string,
  restart: boolean,
  settings: StudyPlanOptions,
): Promise<void> {
  const key = videoKey(ctx);
  const model = resolveModel(ctx.state, modelId);
  const plan = planFor(ctx, model, settings);
  if (key === undefined || !plan || ctx.running) return;
  const existing = ctx.timelines.get(key);
  const sameStudy = existing?.modelId === model.id && existing.windowCount === plan.windows.length;
  if (!restart && sameStudy && existing.nextWindow < existing.windowCount) {
    ctx.plans.set(key, plan);
    await runFor(ctx, { ...existing, plan: settings }, plan, model);
    return;
  }
  const replacing = existing !== undefined && existing.entries.length > 0;
  if (replacing && !ctx.deps.confirm("Replace the existing timeline with a new study?")) return;
  ctx.plans.set(key, plan);
  const fresh = { ...newTimeline(key, model.id, plan, now(ctx)), plan: settings };
  await runFor(ctx, fresh, plan, model);
}

async function resume(ctx: StudyContext): Promise<void> {
  const timeline = currentTimeline(ctx);
  if (!timeline) return;
  const model = resolveModel(ctx.state, timeline.modelId);
  const plan = ctx.plans.get(timeline.fileKey) ?? planFor(ctx, model, timeline.plan);
  if (!plan || plan.windows.length !== timeline.windowCount) {
    ctx.deps.status.show("The study settings changed, so start the study again.");
    openDialog(ctx, true);
    return;
  }
  await runFor(ctx, timeline, plan, model);
}

// Stopping ends the study where it is, so the windows done so far become the whole study.
async function stop(ctx: StudyContext): Promise<void> {
  if (ctx.running) {
    ctx.running.stopping = true;
    ctx.running.controller.abort();
    return;
  }
  const zoom = finishedZoom(ctx);
  if (ctx.finished && zoom?.ending === "paused") {
    ctx.finished = { ...ctx.finished, zoom: { ...zoom, ending: "stopped" } };
    render(ctx);
    return;
  }
  const timeline = currentTimeline(ctx);
  if (timeline && studyState(ctx) === "paused") await endStudy(ctx, timeline);
}

async function endStudy(ctx: StudyContext, timeline: VideoTimeline): Promise<void> {
  const ended = { ...timeline, windowCount: timeline.nextWindow, updatedAt: now(ctx) };
  ctx.finished =
    ended.nextWindow > 0
      ? {
          fileKey: ended.fileKey,
          stoppedAt: { done: ended.nextWindow, total: timeline.windowCount },
        }
      : null;
  ctx.timelines.set(ended.fileKey, ended);
  changed(ctx);
  await ctx.deps.store.putTimeline(ended);
}

function runContext(ctx: StudyContext): RunContext | undefined {
  const toolCtx = ctx.deps.toolContext();
  const chat = ctx.state.currentChat;
  if (ctx.running) return undefined;
  if (!toolCtx || !chat) {
    ctx.deps.status.show("Reattach the video before studying it.");
    return undefined;
  }
  return { toolCtx, chat };
}

async function track(
  ctx: StudyContext,
  running: RunningStudy,
  work: () => Promise<void>,
): Promise<void> {
  ctx.running = running;
  ctx.finished = null;
  ctx.audioNote = null;
  dropUndo(ctx);
  ctx.timelines.set(running.fileKey, running.timeline);
  changed(ctx);
  try {
    await work();
  } catch (error) {
    ctx.deps.status.show(`The study stopped: ${errorText(error)}`, "error");
  } finally {
    if (ctx.running === running) ctx.running = null;
    changed(ctx);
  }
}

async function runFor(
  ctx: StudyContext,
  timeline: VideoTimeline,
  plan: StudyPlan,
  model: ModelInfo,
): Promise<void> {
  const run = runContext(ctx);
  if (!run) return;
  const running: RunningPass = {
    kind: "study",
    chatId: run.chat.id,
    fileKey: timeline.fileKey,
    controller: new AbortController(),
    timeline,
    merged: timeline.entries.length,
    plan,
    model,
    stopping: false,
  };
  await track(ctx, running, async () => {
    const listening = listenAlong(ctx, running, run.toolCtx);
    try {
      const finished = await runStudy(runDeps(ctx, running, run));
      merge(ctx, running, finished);
      if (running.stopping) {
        await endStudy(ctx, ctx.timelines.get(running.fileKey) ?? running.timeline);
      } else if (finished.nextWindow >= finished.windowCount) {
        ctx.finished = { fileKey: running.fileKey };
      }
    } catch (error) {
      running.controller.abort();
      throw error;
    } finally {
      await listening;
    }
  });
}

async function startZoom(ctx: StudyContext): Promise<void> {
  const timeline = currentTimeline(ctx);
  const plan = timeline && zoomPlanFor(ctx, timeline);
  if (!timeline || !plan) return;
  const run = runContext(ctx);
  if (!run) return;
  const paused = finishedZoom(ctx);
  const carried = paused?.ending === "paused" ? paused.done : 0;
  const running: RunningZoom = {
    kind: "zoom",
    chatId: run.chat.id,
    fileKey: timeline.fileKey,
    controller: new AbortController(),
    timeline,
    model: resolveModel(ctx.state, timeline.modelId),
    stopping: false,
    plan,
    carried,
    done: carried,
    total: carried + plan.zooms.length,
  };
  await track(ctx, running, async () => {
    await runZoom(zoomDeps(ctx, running, run));
    const { done, total } = running;
    const ending = running.stopping ? "stopped" : done < total ? "paused" : "done";
    ctx.finished = { fileKey: running.fileKey, zoom: { done, total, ending } };
  });
}

function passDeps(ctx: StudyContext, running: RunningStudy, { toolCtx, chat }: RunContext) {
  const { model, timeline, controller } = running;
  return {
    ...modelCallDeps(ctx.state, ctx.deps.streamChat, model.id, controller.signal),
    ctx: {
      ...toolCtx,
      resolution: resolveSheetResolution(chat.settings.sheetResolution, model).px,
      maxImages: model.maxImages,
    },
    model,
    timeline,
  };
}

function runDeps(ctx: StudyContext, running: RunningPass, run: RunContext): RunDeps {
  return {
    ...passDeps(ctx, running, run),
    plan: running.plan,
    saveTimeline: (saved) => ctx.deps.store.putTimeline(merge(ctx, running, saved)),
    onProgress: (progress) => {
      merge(ctx, running, progress);
      changed(ctx);
    },
  };
}

// runZoom builds each step on the shown timeline, so it is taken whole.
function zoomDeps(ctx: StudyContext, running: RunningZoom, run: RunContext): ZoomDeps {
  const show = (timeline: VideoTimeline) => {
    running.timeline = timeline;
    ctx.timelines.set(running.fileKey, timeline);
  };
  return {
    ...passDeps(ctx, running, run),
    plan: running.plan,
    current: () => ctx.timelines.get(running.fileKey) ?? running.timeline,
    saveTimeline: (saved) => {
      show(saved);
      return ctx.deps.store.putTimeline(saved);
    },
    onProgress: (progress) => {
      running.done += 1;
      show(progress);
      // Undo assumes entries were only appended since, which a zoom breaks.
      dropUndo(ctx);
      changed(ctx);
    },
  };
}

// runStudy only appends, so its new entries go onto the shown timeline, keeping edits made meanwhile.
function merge(ctx: StudyContext, running: RunningPass, studied: VideoTimeline): VideoTimeline {
  const fresh = studied.entries.slice(running.merged);
  running.merged = Math.max(running.merged, studied.entries.length);
  const shown = ctx.timelines.get(running.fileKey) ?? running.timeline;
  const merged = { ...studied, entries: [...shown.entries, ...fresh] };
  running.timeline = merged;
  ctx.timelines.set(running.fileKey, merged);
  return merged;
}

function stopOrphanedStudy(ctx: StudyContext): void {
  const running = ctx.running;
  if (!running || running.controller.signal.aborted) return;
  const chat = ctx.state.chats.find((entry) => entry.id === running.chatId);
  if (chat?.video?.fileKey !== running.fileKey) running.controller.abort();
}

function ensureLoaded(ctx: StudyContext, key: string): void {
  if (ctx.loaded.has(key)) return;
  ctx.loaded.add(key);
  ctx.deps.store
    .getTimeline(key)
    .then((timeline) => {
      if (timeline && !ctx.timelines.has(key)) ctx.timelines.set(key, timeline);
      changed(ctx);
    })
    .catch((error: unknown) => {
      ctx.deps.status.show(`Could not load the timeline: ${errorText(error)}`, "error");
    });
}

function render(ctx: StudyContext): void {
  stopOrphanedStudy(ctx);
  const key = videoKey(ctx);
  if (key !== undefined) ensureLoaded(ctx, key);
  const shown = shownVideo(ctx);
  if (shown) ensureLoaded(ctx, shown.video.fileKey);
  const { button, clearButton } = ctx.els;
  const { control, toggle, restart, zoom } = ctx.menu;
  const study = studyState(ctx);
  const entries = currentTimeline(ctx)?.entries.length ?? 0;
  const offer = zoomOffer(ctx);
  control.hidden = key === undefined;
  button.replaceChildren(icon(BUTTON_ICONS[study]), headerLabel(BUTTON_LABELS[study]));
  button.disabled = study === "busy";
  button.title = buttonTitle(study);
  restart.hidden = study !== "paused";
  clearButton.hidden = entries === 0 || study === "running";
  showOffer(zoom, offer);
  toggle.hidden = restart.hidden && clearButton.hidden && zoom.hidden;
  if (toggle.hidden) ctx.menuHandle.close();
  renderProgress(ctx, offer);
  renderTimeline(ctx, offer);
  renderAudioList(ctx);
}
