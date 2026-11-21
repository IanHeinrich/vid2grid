import type { AnalyseAudio } from "../../audio/videoAudio";
import { resolveModel } from "../../chat/models";
import type { AppElements } from "../../dom";
import type { AppState } from "../../state";
import type {
  ChatStore,
  ModelInfo,
  StreamChat,
  StudyPlanOptions,
  TimelineEntry,
  UnclearSpan,
  VideoAttachment,
  VideoAudio,
  VideoTimeline,
} from "../../types";
import { resolveSheetResolution } from "../../video/resolution";
import {
  planStudy,
  planZoom,
  type StudyPlan,
  type StudyPlanInput,
  type ZoomPlan,
} from "../../video/study";
import type { ToolContext } from "../../video/tools";
import type { ChatVideo } from "../knowledgeVideos";
import type { ModelPicker } from "../modelPicker";
import type { StatusLine } from "../status";
import type { Toast, ToastHandle } from "../toast";

export interface StudyDeps {
  store: ChatStore;
  status: StatusLine;
  toast: Toast;
  streamChat: StreamChat;
  confirm(message: string): boolean;
  toolContext(): ToolContext | undefined;
  openPlayer(seconds: number): void;
  // Plays a moment of a video other than the attached one.
  seekVideo(seconds: number, video: VideoAttachment): void;
  openTimeline(): void;
  onChanged(): void;
  shownVideo?: () => ChatVideo | undefined;
  analyseAudio?: AnalyseAudio;
  currentTime?: () => number | undefined;
  now?: () => number;
  storage?: Storage;
}

interface RunningBase {
  chatId: string;
  fileKey: string;
  controller: AbortController;
  timeline: VideoTimeline;
  model: ModelInfo;
  stopping: boolean;
}

export interface RunningPass extends RunningBase {
  kind: "study";
  // How many of runStudy's own entries are already in the shown timeline.
  merged: number;
  plan: StudyPlan;
}

export interface RunningZoom extends RunningBase {
  kind: "zoom";
  plan: ZoomPlan;
  // A resumed zoom counts on from the paused one, while its plan holds only the rest.
  carried: number;
  done: number;
  total: number;
}

export type RunningStudy = RunningPass | RunningZoom;

export interface FinishedZoom {
  done: number;
  total: number;
  ending: "paused" | "stopped" | "done";
}

export interface FinishedStudy {
  fileKey: string;
  stoppedAt?: { done: number; total: number };
  zoom?: FinishedZoom;
}

export interface StudyMenu {
  control: HTMLElement;
  toggle: HTMLButtonElement;
  menu: HTMLElement;
  restart: HTMLButtonElement;
  zoom: HTMLButtonElement;
}

export interface AudioNote {
  fileKey: string;
  text: string;
}

export type StudyState = "idle" | "running" | "busy" | "paused" | "done";

export interface StudyContext {
  els: AppElements["study"];
  menu: StudyMenu;
  state: AppState;
  deps: StudyDeps;
  timelines: Map<string, VideoTimeline>;
  loaded: Set<string>;
  plans: Map<string, StudyPlan>;
  running: RunningStudy | null;
  finished: FinishedStudy | null;
  audioNote: AudioNote | null;
  heard: Map<string, VideoAudio | undefined>;
  showAllAudio: string | undefined;
  editing: TimelineEntry | null;
  restart: boolean;
  pendingUndo: ToastHandle | null;
  choice: { modelId: string };
  picker: ModelPicker;
  render(): void;
}

export function now(ctx: StudyContext): number {
  return (ctx.deps.now ?? Date.now)();
}

export function storage(ctx: StudyContext): Storage {
  return ctx.deps.storage ?? localStorage;
}

export function changed(ctx: StudyContext): void {
  ctx.render();
  ctx.deps.onChanged();
}

export function videoKey(ctx: StudyContext): string | undefined {
  return ctx.state.currentChat?.video?.fileKey;
}

export function currentTimeline(ctx: StudyContext): VideoTimeline | undefined {
  const key = videoKey(ctx);
  return key === undefined ? undefined : ctx.timelines.get(key);
}

// The video the Knowledge drawer shows, which may be an older one from the chat.
export function shownVideo(ctx: StudyContext): ChatVideo | undefined {
  if (ctx.deps.shownVideo) return ctx.deps.shownVideo();
  const video = ctx.state.currentChat?.video;
  return video && { video, current: true };
}

export function seekShown(ctx: StudyContext): (seconds: number) => void {
  const shown = shownVideo(ctx);
  return (seconds) => {
    if (!shown || shown.current) ctx.deps.openPlayer(seconds);
    else ctx.deps.seekVideo(seconds, shown.video);
  };
}

export function shownTimeline(ctx: StudyContext): VideoTimeline | undefined {
  const shown = shownVideo(ctx);
  return shown && ctx.timelines.get(shown.video.fileKey);
}

export function isRunningHere(ctx: StudyContext): boolean {
  return ctx.running !== null && ctx.running.fileKey === videoKey(ctx);
}

export function studyState(ctx: StudyContext): StudyState {
  if (isRunningHere(ctx)) return "running";
  if (ctx.running !== null) return "busy";
  const timeline = currentTimeline(ctx);
  if (!timeline || timeline.nextWindow === 0) return "idle";
  return timeline.nextWindow < timeline.windowCount ? "paused" : "done";
}

export function finishedZoom(ctx: StudyContext): FinishedZoom | undefined {
  const finished = ctx.finished;
  return finished?.fileKey === videoKey(ctx) ? finished?.zoom : undefined;
}

type VideoGeometry = Omit<StudyPlanInput, keyof StudyPlanOptions>;

function videoGeometry(ctx: StudyContext, model: ModelInfo): VideoGeometry | undefined {
  const chat = ctx.state.currentChat;
  const video = chat?.video;
  if (!video || !chat) return undefined;
  return {
    durationSeconds: video.durationSeconds,
    sourceAspect: video.width / video.height,
    resolution: resolveSheetResolution(chat.settings.sheetResolution, model).px,
    model,
  };
}

export function planFor(
  ctx: StudyContext,
  model: ModelInfo,
  settings: StudyPlanOptions = {},
): StudyPlan | undefined {
  const geometry = videoGeometry(ctx, model);
  return geometry && planStudy({ ...geometry, ...settings });
}

export function unzoomed(timeline: VideoTimeline | undefined): UnclearSpan[] {
  return (timeline?.unclear ?? []).filter((span) => span.zoomed !== true);
}

export function zoomPlanFor(ctx: StudyContext, timeline: VideoTimeline): ZoomPlan | undefined {
  if (unzoomed(timeline).length === 0) return undefined;
  const geometry = videoGeometry(ctx, resolveModel(ctx.state, timeline.modelId));
  const startSeconds = timeline.plan?.startSeconds;
  const endSeconds = timeline.plan?.endSeconds;
  const plan =
    geometry &&
    planZoom({
      ...geometry,
      unclear: timeline.unclear ?? [],
      ...(startSeconds !== undefined && { startSeconds }),
      ...(endSeconds !== undefined && { endSeconds }),
    });
  return plan && plan.zooms.length > 0 ? plan : undefined;
}
