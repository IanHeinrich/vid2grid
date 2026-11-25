import { modelVisionProfile } from "@vid2grid/core";
import { orWhenAborted } from "../abort";
import {
  runTurn,
  type AnswerNowReason,
  type TurnDeps,
  type TurnEvent,
  type TurnOutcome,
} from "../chat/agentLoop";
import { archiveCurrentReply, compareWithModel } from "../chat/alternates";
import { NEW_CHAT_TITLE, titleFromMessage } from "../chat/chats";
import { newestUserMessage } from "../chat/imageSelection";
import { videoForImage } from "../chat/messageVideo";
import { currentModel } from "../chat/models";
import { visibleMessages } from "../chat/story";
import { shouldSummarize, summarizeStory } from "../chat/summary";
import { messageThoroughness, roundsFor } from "../chat/thoroughness";
import {
  sameTranscript,
  transcriptToCarry,
  transcriptTokenCap,
  type HeardSpeech,
} from "../chat/transcript";
import { imagesOf } from "../imageRefs";
import {
  isRunningIn,
  removeMessages,
  setRunning,
  updateChat,
  upsertMessage,
  type AppState,
} from "../state";
import { errorText } from "../text";
import type {
  AssistantMessage,
  AudioCoverage,
  Chat,
  ChatMessage,
  ChatStore,
  ModelInfo,
  RunTool,
  SceneNote,
  StorySoFar,
  StreamChat,
  Thoroughness,
  ToolSchema,
  UserMessage,
  VideoCast,
  VideoTimeline,
} from "../types";
import { resolveSheetResolution } from "../video/resolution";
import { createToolRunner, type ToolContext } from "../video/tools";
import type { StatusLine } from "../ui/shared/status";
import type { Toast } from "../ui/shared/toast";
import type { ImageCleanup } from "./imageCleanup";
import { modelCallDeps } from "./modelCallDeps";
import { estimateTokens } from "./requestEstimate";
import { conversationTools, toolContext } from "./toolContext";
import { turnAudio, type AudioStatus, type TurnAudio } from "./turnAudio";

export const KEEP_GOING_TEXT = "Keep going: continue investigating from your notes, then answer.";
const STRIPPED_NOTE =
  "The model tried to keep calling tools after its limit; you can let it keep going.";
export const ANSWERED_NOW_NOTES: Record<AnswerNowReason, string> = {
  user: "Answered without further thinking.",
  loop: "Thinking was going in circles, so it was cut short.",
};
const STOPPED: TurnOutcome = { status: "stopped" };
export const SUMMARIZING_STATUS = "Summarizing earlier messages…";

export interface TurnRequest {
  message?: UserMessage;
  // Absent means the message's own tier.
  thoroughness?: Thoroughness;
  // Absent means the message's own audio flag.
  audio?: boolean;
  // Writes the latest reply again with this model, keeping the shown one as a swipe.
  compareWith?: ModelInfo;
  // The message could not be saved, so what it was made from goes back to the user.
  onUnsaved?: () => void;
}

export interface Turns {
  // Prepare watches the signal itself: a message it returns is saved even if Stop came meanwhile.
  run(prepare: (signal: AbortSignal) => Promise<TurnRequest | undefined>): Promise<void>;
  replay(): Promise<void>;
  compare(model: ModelInfo): Promise<void>;
  edit(
    message: UserMessage | AssistantMessage,
    text: string,
    onUnsaved?: () => void,
  ): Promise<void>;
  keepGoing(): Promise<void>;
  stop(): void;
  // Cuts the running round short: it answers from what it has seen, with no more tool calls.
  answerNow(): void;
}

export interface TurnView {
  reset(messages: readonly ChatMessage[]): void;
  show(message: ChatMessage): void;
  apply(event: TurnEvent): void;
  showError(text: string): void;
  endTurn(): void;
  clearErrors(): void;
  setRunning(running: boolean): void;
}

export interface TurnsDeps {
  store: ChatStore;
  status: StatusLine;
  toast?: Pick<Toast, "show">;
  conversation: TurnView;
  video: { renderSceneLog(): void };
  images: Pick<ImageCleanup, "release">;
  streamChat: StreamChat;
  timeline(): VideoTimeline | undefined;
  onChatChanged(): void;
  onRunningChanged(): void;
  onMessageSaved(): void;
  now?: () => number;
  newId?: () => string;
}

interface TurnControllers {
  controller: AbortController;
  answerNow: AbortController;
}

interface TurnsContext {
  state: AppState;
  deps: TurnsDeps;
  // By chat, so a reply still stopping in one chat leaves another free to send.
  running: Map<string, TurnControllers>;
}

interface TurnFlags {
  thoroughness: Thoroughness;
  audio: boolean;
}

interface TurnSignals {
  signal: AbortSignal;
  answerNow: AbortSignal;
}

interface TurnSetup {
  chat: Chat;
  model: ModelInfo;
  thoroughness: Thoroughness;
  audioCoverage: AudioCoverage | undefined;
  speech: HeardSpeech | undefined;
  timeline: VideoTimeline | undefined;
  cast: VideoCast | undefined;
  videoLoaded: boolean;
}

export function initTurns(state: AppState, deps: TurnsDeps): Turns {
  const ctx: TurnsContext = { state, deps, running: new Map() };
  return {
    run: (prepare) => run(ctx, prepare),
    replay: () => replay(ctx),
    compare: (model) => compare(ctx, model),
    edit: (message, text, onUnsaved) => edit(ctx, message, text, onUnsaved),
    keepGoing: () => keepGoing(ctx),
    stop: () => currentTurn(ctx)?.controller.abort(),
    answerNow: () => currentTurn(ctx)?.answerNow.abort(),
  };
}

function currentTurn(ctx: TurnsContext): TurnControllers | undefined {
  const chatId = ctx.state.currentChat?.id;
  return chatId === undefined ? undefined : ctx.running.get(chatId);
}

function setRunningState(ctx: TurnsContext, chatId: string, running: boolean): void {
  setRunning(ctx.state, running, chatId);
  ctx.deps.conversation.setRunning(ctx.state.running);
  ctx.deps.onRunningChanged();
}

async function run(
  ctx: TurnsContext,
  prepare: (signal: AbortSignal) => Promise<TurnRequest | undefined>,
): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat || isRunningIn(ctx.state, chat.id)) return;
  const controller = new AbortController();
  const answerNow = new AbortController();
  ctx.running.set(chat.id, { controller, answerNow });
  ctx.deps.conversation.clearErrors();
  setRunningState(ctx, chat.id, true);
  try {
    const { signal } = controller;
    const request = await prepare(signal);
    if (!request) return;
    // The composer has already cleared the message, so it is kept even when no reply follows.
    if (request.message) {
      await saveUserMessage(ctx, chat.id, request.message, request.onUnsaved);
    }
    const stopped = signal.aborted || ctx.state.currentChat?.id !== chat.id;
    if (stopped && !request.message) return;
    const turnChat = await touchChat(ctx, chat.id, request.message);
    if (stopped) return;
    const audio = request.audio ?? request.message?.audio === true;
    const thoroughness =
      request.thoroughness ?? (request.message ? messageThoroughness(request.message) : "normal");
    const signals = { signal, answerNow: answerNow.signal };
    if (turnChat) {
      await runChatTurn(ctx, turnChat, { thoroughness, audio }, signals, request.compareWith);
    }
  } catch (error) {
    ctx.deps.status.show(errorText(error), "error");
  } finally {
    ctx.running.delete(chat.id);
    setRunningState(ctx, chat.id, false);
    if (ctx.state.currentChat?.id === chat.id) ctx.deps.conversation.endTurn();
  }
}

async function orUnsaved(saving: Promise<void>, onUnsaved?: () => void): Promise<void> {
  try {
    await saving;
  } catch (error) {
    onUnsaved?.();
    throw error;
  }
}

async function saveUserMessage(
  ctx: TurnsContext,
  chatId: string,
  message: UserMessage,
  onUnsaved?: () => void,
): Promise<void> {
  await orUnsaved(ctx.deps.store.putMessage(chatId, message), onUnsaved);
  if (ctx.state.currentChat?.id !== chatId) return;
  upsertMessage(ctx.state, message);
  ctx.deps.conversation.show(message);
}

async function touchChat(
  ctx: TurnsContext,
  chatId: string,
  message: UserMessage | undefined,
): Promise<Chat | undefined> {
  const text = message && !message.continuation ? message.text : "";
  const updated = await updateChat(ctx.state, ctx.deps.store, chatId, (chat) => ({
    ...chat,
    title: chat.title === NEW_CHAT_TITLE && text !== "" ? titleFromMessage(text) : chat.title,
    updatedAt: (ctx.deps.now ?? Date.now)(),
  }));
  if (!updated) return undefined;
  ctx.deps.onChatChanged();
  return updated;
}

function summarize(
  ctx: TurnsContext,
  { chat, model }: TurnSetup,
  signal: AbortSignal,
): Promise<StorySoFar | undefined> {
  const { state, deps } = ctx;
  const summarizing = summarizeStory(
    {
      ...modelCallDeps(state, deps.streamChat, model.id, signal),
      ...(deps.now ? { now: deps.now } : {}),
    },
    { chat, messages: [...state.messages] },
  );
  return orWhenAborted(summarizing, signal, undefined);
}

// A failed summary only means the request goes out longer, so the turn carries on without one.
async function withStorySoFar(
  ctx: TurnsContext,
  turn: TurnSetup,
  signal: AbortSignal,
): Promise<Chat> {
  const { deps } = ctx;
  const { chat, model } = turn;
  const estimate = estimateTokens({ ...turn, messages: ctx.state.messages });
  if (!shouldSummarize(estimate, model.contextTokens)) return chat;
  deps.status.show(SUMMARIZING_STATUS);
  let story: StorySoFar | undefined;
  try {
    story = await summarize(ctx, turn, signal);
    if (story && !signal.aborted) await saveStory(ctx, chat.id, story);
  } catch (error) {
    deps.status.clear();
    if (signal.aborted) return chat;
    const text = `Could not summarize earlier messages: ${errorText(error)}`;
    if (deps.toast) deps.toast.show(text);
    else deps.status.show(text, "error");
    return chat;
  }
  deps.status.clear();
  return story && !signal.aborted ? { ...chat, storySoFar: story } : chat;
}

async function saveStory(ctx: TurnsContext, chatId: string, story: StorySoFar): Promise<void> {
  const updated = await updateChat(ctx.state, ctx.deps.store, chatId, (chat) => ({
    ...chat,
    storySoFar: story,
  }));
  if (updated) ctx.deps.onChatChanged();
}

// A cast that cannot be read only leaves the names out, so the turn goes ahead without it.
function loadCast(ctx: TurnsContext, chat: Chat): Promise<VideoCast | undefined> {
  const key = chat.video?.fileKey;
  if (key === undefined) return Promise.resolve(undefined);
  return ctx.deps.store.getCast(key).catch(() => undefined);
}

interface TurnTools {
  tools: ToolSchema[];
  toolGuidance: string;
  runTool: RunTool | undefined;
}

interface TurnToolsInput {
  chat: Chat;
  model: ModelInfo;
  resolution: number;
  toolCtx: ToolContext | undefined;
  heard: TurnAudio;
  // Grows as the turn saves messages.
  messages: readonly ChatMessage[];
}

function turnTools(ctx: TurnsContext, input: TurnToolsInput): TurnTools {
  const { chat, model, resolution, toolCtx, heard, messages } = input;
  const { tools, guidance } = conversationTools(model, messages, {
    videoLoaded: toolCtx !== undefined,
    listen: heard.on && heard.coverage.canListen,
  });
  if (tools.length === 0) return { tools, toolGuidance: guidance, runTool: undefined };
  const { maxImages } = model;
  const runTool = createToolRunner({
    store: ctx.deps.store,
    resolution,
    maxImages,
    tools,
    knownImages: () => messages.flatMap(imagesOf),
    videoOfImage: (id) =>
      videoForImage(messages, id, toolCtx?.video ?? chat.video, chat.removedVideos),
    ...(toolCtx ? { sheets: { ...toolCtx, resolution, maxImages } } : {}),
    ...(heard.on && heard.listen ? { audio: heard.listen } : {}),
  });
  return { tools, toolGuidance: guidance, runTool };
}

function answerNotice(outcome: TurnOutcome): string | undefined {
  const notes = [
    outcome.answeredNow ? ANSWERED_NOW_NOTES[outcome.answeredNow] : "",
    outcome.strippedToolMarkup ? STRIPPED_NOTE : "",
  ].filter((note) => note !== "");
  return notes.length > 0 ? notes.join(" ") : undefined;
}

function audioFor(
  ctx: TurnsContext,
  on: boolean,
  { chat, toolCtx }: { chat: Chat; toolCtx: ToolContext | undefined },
  signal: AbortSignal,
): Promise<TurnAudio> {
  const { store, status } = ctx.deps;
  const { settings } = ctx.state;
  const keys = { fileKey: toolCtx?.video.fileKey, chatVideoKey: chat.video?.fileKey };
  return turnAudio({ on, ...keys, store, settings, status, signal });
}

async function recordTranscript(
  { state, deps }: TurnsContext,
  chat: Chat,
  model: ModelInfo,
  speech: HeardSpeech | undefined,
): Promise<void> {
  const visible = visibleMessages(chat, state.messages);
  const newest = newestUserMessage(visible);
  if (newest?.audio !== true) return;
  const carried = speech && transcriptToCarry(visible, speech, transcriptTokenCap(model));
  const own = newest.transcript?.fileKey === chat.video?.fileKey ? newest.transcript : undefined;
  const transcript = carried ?? own;
  if (sameTranscript(transcript, newest.transcript)) return;
  const message: UserMessage = { ...newest };
  if (transcript) message.transcript = transcript;
  else delete message.transcript;
  await deps.store.putMessage(chat.id, message);
  if (state.currentChat?.id !== chat.id) return;
  upsertMessage(state, message);
  deps.conversation.show(message);
}

async function runChatTurn(
  ctx: TurnsContext,
  touched: Chat,
  { thoroughness, audio }: TurnFlags,
  { signal, answerNow }: TurnSignals,
  compareWith?: ModelInfo,
): Promise<void> {
  const { state, deps } = ctx;
  const ended = () => signal.aborted || state.currentChat?.id !== touched.id;
  const model = compareWith ?? currentModel(state);
  if (model === null || ended()) return;
  const toolCtx = toolContext(state, deps.store);
  const timeline = deps.timeline();
  const cast = await loadCast(ctx, touched);
  const heard = await audioFor(ctx, audio, { chat: touched, toolCtx }, signal);
  if (ended()) return;
  const { speech } = heard;
  // A comparison asks exactly what the first model was asked.
  const records = audio && !compareWith;
  if (records) await recordTranscript(ctx, touched, model, speech);
  if (ended()) return;
  const audioCoverage = heard.on ? heard.coverage : undefined;
  const videoLoaded = toolCtx !== undefined;
  const loaded = { audioCoverage, speech, timeline, cast, videoLoaded };
  const setup: TurnSetup = { chat: touched, model, thoroughness, ...loaded };
  const chat = await withStorySoFar(ctx, setup, signal);
  if (ended()) return;
  // The summary may have folded away the message that carried the transcript.
  if (records && chat !== touched) await recordTranscript(ctx, chat, model, speech);
  if (ended()) return;
  const { api, veniceParameters } = modelCallDeps(state, deps.streamChat, model.id, signal);
  const resolution = resolveSheetResolution(chat.settings.sheetResolution, model).px;
  // Kept here rather than read from state, so recall still finds images if the user switches chats.
  const known: ChatMessage[] = [...state.messages];
  const turnDeps: TurnDeps = {
    chat,
    messages: [...state.messages],
    model,
    api,
    ...turnTools(ctx, { chat, model, resolution, toolCtx, heard, messages: known }),
    toolsOptional: !videoLoaded,
    streamChat: deps.streamChat,
    store: deps.store,
    veniceParameters,
    signal,
    answerNow,
    resolution,
    ...withImageTokens(modelVisionProfile(model.id).imageTokens),
    thoroughness,
    ...(heard.on ? { audioCoverage: heard.coverage } : {}),
    ...(speech ? { speech } : {}),
    maxRounds: roundsFor(thoroughness, chat.settings.maxRounds),
    ...(timeline ? { timeline } : {}),
    ...(cast ? { cast } : {}),
    persist: persister(ctx, chat.id, known),
    onEvent: (event) => onTurnEvent(ctx, chat, event, heard.progress),
  };
  const turn = compareWith ? compareTurn(ctx, turnDeps, compareWith) : runTurn(turnDeps);
  // A render in progress cannot be cancelled, so Stop releases the composer without waiting for it.
  const outcome = await orWhenAborted(turn, signal, STOPPED);
  heard.progress.clear();
  if (state.currentChat?.id === chat.id) showOutcome(ctx, outcome);
}

function persister(
  { state, deps }: TurnsContext,
  chatId: string,
  known: ChatMessage[],
): TurnDeps["persist"] {
  return async (message) => {
    known.push(message);
    if (!state.chats.some((entry) => entry.id === chatId)) return;
    await deps.store.putMessage(chatId, message);
    if (state.currentChat?.id !== chatId) return;
    upsertMessage(state, message);
    deps.onMessageSaved();
  };
}

function showOutcome({ deps }: TurnsContext, outcome: TurnOutcome): void {
  if (outcome.status === "error") {
    deps.conversation.showError(outcome.error ?? "The request failed.");
  }
  const notice = answerNotice(outcome);
  if (notice !== undefined) deps.status.show(notice);
}

function withImageTokens(imageTokens: ((px: number) => number) | undefined) {
  return imageTokens ? { imageTokens } : {};
}

async function compareTurn(
  ctx: TurnsContext,
  turn: TurnDeps,
  model: ModelInfo,
): Promise<TurnOutcome> {
  const { state, deps } = ctx;
  const chatId = turn.chat.id;
  const user = state.messages[lastUserIndex(ctx)];
  if (user?.role !== "user") return STOPPED;
  const compared = await compareWithModel(
    {
      runTurn,
      turn,
      saveUser: async (message) => {
        await deps.store.putMessage(chatId, message);
        upsertMessage(state, message);
        deps.conversation.reset(state.messages);
      },
      removeMessages: async (ids) => {
        if (ids.length > 0) await deps.store.deleteMessages(chatId, ids);
        removeMessages(state, ids);
      },
    },
    {
      messages: state.messages,
      userMessageId: user.id,
      currentModelId: turn.chat.settings.modelId,
      model,
    },
  );
  return compared?.outcome ?? STOPPED;
}

function onTurnEvent(ctx: TurnsContext, chat: Chat, event: TurnEvent, progress: AudioStatus): void {
  if (event.type === "toolDone") progress.clear();
  if (event.type === "note") {
    addNote(ctx, chat.id, event.note).catch((error: unknown) => {
      ctx.deps.status.show(`Could not save the note: ${errorText(error)}`, "error");
    });
    return;
  }
  if (ctx.state.currentChat?.id === chat.id) ctx.deps.conversation.apply(event);
}

async function addNote(ctx: TurnsContext, chatId: string, note: SceneNote): Promise<void> {
  const updated = await updateChat(ctx.state, ctx.deps.store, chatId, (chat) => ({
    ...chat,
    sceneLog: [...chat.sceneLog, note],
  }));
  if (updated && ctx.state.currentChat?.id === chatId) ctx.deps.video.renderSceneLog();
}

function lastUserIndex(ctx: TurnsContext): number {
  const { messages } = ctx.state;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

async function truncateAfter(
  ctx: TurnsContext,
  chatId: string,
  index: number,
): Promise<readonly ChatMessage[]> {
  const removed = ctx.state.messages.slice(index + 1);
  const ids = removed.map((message) => message.id);
  if (ids.length > 0) await ctx.deps.store.deleteMessages(chatId, ids);
  removeMessages(ctx.state, ids);
  ctx.deps.conversation.reset(ctx.state.messages);
  return removed;
}

// Replay keeps the reply it replaces as a swipe.
async function archiveReply(ctx: TurnsContext, chat: Chat, user: UserMessage): Promise<void> {
  const archived = archiveCurrentReply(ctx.state.messages, user.id, chat.settings.modelId);
  if (!archived) return;
  await ctx.deps.store.putMessage(chat.id, archived.user);
  if (archived.removeIds.length > 0) {
    await ctx.deps.store.deleteMessages(chat.id, archived.removeIds);
  }
  removeMessages(ctx.state, archived.removeIds);
  upsertMessage(ctx.state, archived.user);
  ctx.deps.conversation.reset(ctx.state.messages);
}

function replay(ctx: TurnsContext): Promise<void> {
  return run(ctx, async () => {
    const chat = ctx.state.currentChat;
    const user = ctx.state.messages[lastUserIndex(ctx)];
    if (!chat || user?.role !== "user") return undefined;
    await archiveReply(ctx, chat, user);
    return { thoroughness: messageThoroughness(user), audio: user.audio === true };
  });
}

function compare(ctx: TurnsContext, model: ModelInfo): Promise<void> {
  return run(ctx, () => {
    const user = ctx.state.messages[lastUserIndex(ctx)];
    if (user?.role !== "user") return Promise.resolve(undefined);
    return Promise.resolve({
      thoroughness: messageThoroughness(user),
      audio: user.audio === true,
      compareWith: model,
    });
  });
}

async function rerunEdited(
  ctx: TurnsContext,
  chatId: string,
  message: UserMessage,
  index: number,
  onUnsaved?: () => void,
): Promise<void> {
  let removed: readonly ChatMessage[] = [];
  let saved = false;
  await run(ctx, async () => {
    await ctx.deps.store.putMessage(chatId, message);
    saved = true;
    upsertMessage(ctx.state, message);
    removed = await truncateAfter(ctx, chatId, index);
    return { thoroughness: messageThoroughness(message), audio: message.audio === true };
  });
  if (!saved) onUnsaved?.();
  // Not before the reply is written: nothing is released while one runs.
  await ctx.deps.images.release({ messages: removed });
}

async function edit(
  ctx: TurnsContext,
  message: UserMessage | AssistantMessage,
  text: string,
  onUnsaved?: () => void,
): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat || ctx.state.running) {
    onUnsaved?.();
    return;
  }
  if (message.role === "user" && text === "" && message.images.length === 0 && !message.video) {
    ctx.deps.status.show("A message needs some text or an image.", "error");
    ctx.deps.conversation.show(message);
    return;
  }
  const updated = { ...message, text };
  const index = lastUserIndex(ctx);
  if (updated.role === "user" && ctx.state.messages[index]?.id === updated.id) {
    await rerunEdited(ctx, chat.id, updated, index, onUnsaved);
    return;
  }
  await orUnsaved(ctx.deps.store.putMessage(chat.id, updated), onUnsaved);
  upsertMessage(ctx.state, updated);
  ctx.deps.conversation.show(updated);
}

function keepGoing(ctx: TurnsContext): Promise<void> {
  const found = ctx.state.messages[lastUserIndex(ctx)];
  const previous = found?.role === "user" ? found : undefined;
  const thoroughness = previous ? messageThoroughness(previous) : "normal";
  const audio = previous?.audio === true;
  const effort = previous?.reasoningEffort;
  const message: UserMessage = {
    id: (ctx.deps.newId ?? (() => crypto.randomUUID()))(),
    createdAt: (ctx.deps.now ?? Date.now)(),
    role: "user",
    text: KEEP_GOING_TEXT,
    images: [],
    continuation: true,
    ...(thoroughness !== "normal" ? { thoroughness } : {}),
    ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    ...(audio ? { audio: true } : {}),
  };
  return run(ctx, () => Promise.resolve({ message, thoroughness, audio }));
}
