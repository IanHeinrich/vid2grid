import type { AppElements } from "../../dom";
import type {
  AssistantMessage,
  ChatMessage,
  ImageStore,
  ModelInfo,
  RemovedVideo,
  SeenNote,
  ToolCall,
  UserMessage,
  VideoAttachment,
} from "../../types";
import type { CoverageStrip } from "../video/coverageStrip";
import type { ModelPicker } from "../modelPicker/modelPicker";
import type { PickerSettings } from "../modelPicker/pickerModel";
import type { VideoView } from "../video/context";
import type { TurnStep } from "./activity";
import type { Lightbox } from "./lightbox";
import type { SeenRender } from "./seenDetails";
import type { MarkdownOptions } from "./markdown";
import { videoForMessage } from "../../chat/messageVideo";

export interface ConversationDeps {
  store: ImageStore;
  // The video is the one the message was about, which may no longer be the chat's current video.
  onSeek(seconds: number, video?: VideoAttachment): void;
  onCue(seconds: number): void;
  onMessageChanged(message: ChatMessage): void;
  // Calls onUnsaved when the edit could not be saved, so its text goes back to the editor.
  onEdit(message: UserMessage | AssistantMessage, text: string, onUnsaved: () => void): void;
  onReplay(): void;
  onKeepGoing(): void;
  onBranch(message: ChatMessage): void;
  onDelete(message: ChatMessage): void;
  onCopy(message: ChatMessage): void;
  isRunning(): boolean;
  videoView(): VideoView;
  onPopOut(seconds: number): void;
  onReattach(): void;
  onRemoveVideo(video: VideoAttachment): void;
  // Why a video cannot be removed now, or undefined.
  removeBlocker(): string | undefined;
  removedVideos(): readonly RemovedVideo[];
  showThinking(): boolean;
  onPrefill(text: string): void;
  focusComposer(): void;
  models(): readonly ModelInfo[];
  chatModelId(): string | undefined;
  onLookAgain?: (messageId: string, note: SeenNote) => void;
  // The chat has a looking model, so a model that cannot see images can write its replies.
  looking?: () => boolean;
  lookingName?: (modelId: string) => string;
  lookingPricing?: (modelId: string) => ModelInfo["pricing"];
  pickerSettings: PickerSettings;
  onSwitchReply(user: UserMessage, index: number): void;
  onCompare(model: ModelInfo): void;
  onVerify(message: AssistantMessage, signal: AbortSignal): Promise<AssistantMessage | undefined>;
  onMessagesChanged(): void;
  onThinkingChanged?: (thinking: boolean) => void;
  storage?: Storage;
}

export interface Entry {
  el: HTMLElement;
  urls: string[];
  disposed: boolean;
}

export interface VideoSlot {
  el: HTMLElement;
  video: VideoAttachment;
  shown: string;
  remove: HTMLButtonElement;
  coverage: CoverageStrip | undefined;
}

export interface ActivityView {
  el: HTMLLIElement;
  details: HTMLDetailsElement;
  summary: HTMLElement;
  body: HTMLElement;
  images: Entry;
  // The steps changed since the body was last built.
  dirty: boolean;
  renderedLive: boolean;
  streamKey: string | undefined;
}

export interface AnswerView {
  el: HTMLLIElement;
  prefaces: HTMLElement;
  // What the prefaces were last built from, so a streamed token below them leaves them alone.
  prefacesKey: string | undefined;
  text: HTMLElement;
  notice: HTMLElement;
  checks: HTMLElement;
  actions: HTMLElement;
  receipt: HTMLElement;
}

export interface TurnView {
  key: string;
  user: UserMessage | undefined;
  userEntry: Entry | undefined;
  steps: TurnStep[];
  activity: ActivityView;
  answer: AnswerView;
  live: string | null;
  streamingId: string | null;
  // Calls started and not yet done; a listen call can still run after a later call finishes.
  pendingCalls: ToolCall[];
}

export interface Waiting {
  turn: TurnView;
  timer: ReturnType<typeof setInterval>;
}

export interface Editor {
  id: string;
  input: HTMLTextAreaElement;
}

export interface Draft {
  id: string;
  text: string;
  focused: boolean;
}

export type FocusTarget = { kind: "message"; id: string } | { kind: "position"; index: number };

export interface ComparePopover {
  el: HTMLElement;
  picker: ModelPicker;
  stopOutside: () => void;
}

export interface ConversationContext {
  els: AppElements["conversation"];
  templates: AppElements["templates"];
  deps: ConversationDeps;
  lightbox: Lightbox;
  readyVideo: VideoAttachment | undefined;
  readyNote: boolean;
  readySuggestions: HTMLElement | null;
  readyNoteEl: HTMLElement | null;
  // Activity rows the reader opened or closed, by turn, so a re-render keeps them that way.
  activityOpen: Map<string, boolean>;
  turns: TurnView[];
  turnOf: Map<string, TurnView>;
  messages: Map<string, ChatMessage>;
  videoSlots: Map<string, VideoSlot>;
  editor: Editor | null;
  // Text of refused edits by message id, kept until it has been back in an editor.
  unsavedEdits: Map<string, string>;
  pendingFocus: FocusTarget | null;
  stickToBottom: boolean;
  waiting: Waiting | null;
  checks: Map<string, AbortController>;
  compare: ComparePopover | null;
  thinking: boolean;
  // A look is running, so there is something to cut short with Answer now.
  looking: boolean;
  // Set by initConversation, so the parts below it re-render without importing it back.
  showMessage(message: ChatMessage): void;
  renderAnswer(turn: TurnView): void;
  afterChange(): void;
}

export function newEntry(tag: string, className: string): Entry {
  const el = document.createElement(tag);
  el.className = className;
  return { el, urls: [], disposed: false };
}

export function dispose(entry: Entry): void {
  entry.disposed = true;
  entry.urls.forEach((url) => URL.revokeObjectURL(url));
  entry.urls = [];
}

export function isLatest(ctx: ConversationContext, turn: TurnView): boolean {
  return turn === ctx.turns[ctx.turns.length - 1];
}

export function underway(ctx: ConversationContext, turn: TurnView): boolean {
  return (
    turn.live !== null || turn.streamingId !== null || (isLatest(ctx, turn) && ctx.deps.isRunning())
  );
}

export function lookingName(ctx: ConversationContext, modelId: string): string {
  return ctx.deps.lookingName?.(modelId) ?? modelId;
}

export function seenRender(ctx: ConversationContext, options: MarkdownOptions): SeenRender {
  const { onLookAgain, looking } = ctx.deps;
  return {
    name: (modelId) => lookingName(ctx, modelId),
    options,
    ...(onLookAgain && looking?.()
      ? {
          // The button goes with what it dropped.
          onLookAgain: (messageId: string, note: SeenNote) => {
            ctx.pendingFocus = { kind: "message", id: messageId };
            onLookAgain(messageId, note);
          },
          running: ctx.deps.isRunning(),
        }
      : {}),
  };
}

export function messageElement(ctx: ConversationContext, id: string): HTMLElement | undefined {
  const turn = ctx.turnOf.get(id);
  if (!turn) return undefined;
  return turn.user?.id === id ? turn.userEntry?.el : turn.answer.el;
}

export function upsertStep(ctx: ConversationContext, turn: TurnView, step: TurnStep): void {
  ctx.messages.set(step.id, step);
  ctx.turnOf.set(step.id, turn);
  const index = turn.steps.findIndex((entry) => entry.id === step.id);
  if (index === -1) turn.steps.push(step);
  else turn.steps[index] = step;
  turn.activity.dirty = true;
}

export function videoAbout(
  ctx: ConversationContext,
  messageId: string | undefined,
): VideoAttachment | undefined {
  const current = ctx.deps.videoView().video;
  return videoForMessage(ctx.messages.values(), messageId, current, ctx.deps.removedVideos());
}

export function seekHandler(
  ctx: ConversationContext,
  messageId: string,
): (seconds: number) => void {
  return (seconds) => ctx.deps.onSeek(seconds, videoAbout(ctx, messageId));
}

export function turnSeekHandler(
  ctx: ConversationContext,
  turn: TurnView,
): (seconds: number) => void {
  return (seconds) => ctx.deps.onSeek(seconds, videoAbout(ctx, turn.user?.id ?? turn.steps[0]?.id));
}

// Times past the end of the video the message is about stay plain text; a zero length is unknown.
export function textOptions(
  ctx: ConversationContext,
  messageId: string | undefined,
  onSeek: (seconds: number) => void,
): MarkdownOptions {
  const duration = videoAbout(ctx, messageId)?.durationSeconds;
  return { onSeek, ...(duration === undefined || duration <= 0 ? {} : { maxSeconds: duration }) };
}

export function turnTextOptions(ctx: ConversationContext, turn: TurnView): MarkdownOptions {
  return textOptions(ctx, turn.user?.id ?? turn.steps[0]?.id, turnSeekHandler(ctx, turn));
}
