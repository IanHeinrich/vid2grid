import { isAbortError } from "../abort";
import { ApiError } from "../api/http";
import { blobToDataUrl } from "../dataUrl";
import { errorText } from "../text";
import type {
  ApiSettings,
  AssistantMessage,
  AudioCoverage,
  Chat,
  ChatMessage,
  ChatRequest,
  ImageStore,
  ModelInfo,
  RunTool,
  SceneNote,
  SeenNote,
  StreamChat,
  Thoroughness,
  ToolCall,
  ToolMessage,
  ToolSchema,
  TurnReceipt,
  VideoCast,
  VideoTimeline,
} from "../types";
import { instantSpans, seenSpans, unseenCitations } from "./coverage";
import { pinsExceedCap } from "./imageSelection";
import { askForWrittenAnswer, withTextCalls } from "./leakedToolCalls";
import type { Looker } from "./looking";
import { lookBeforeRound } from "./lookingTurn";
import { buildRequest } from "./request";
import { keptImages } from "./story";
import {
  streamAssistant,
  type StreamEnding,
  type StreamOptions,
  type Streamed,
} from "./streamRound";
import { roundsFor } from "./thoroughness";
import { estimateRequestTokens, requestImageCount, sheetSidesByUrl } from "./tokenEstimate";
import { answerToolCalls } from "./toolCalls";
import { stripToolMarkup } from "./toolMarkup";
import { transcriptTimes, transcriptTokenCap, type HeardSpeech } from "./transcript";

export { DEEP_MAX_ROUNDS, DEFAULT_MAX_ROUNDS } from "./thoroughness";
export {
  LOOP_SENTENCE_REPEATS,
  LOOP_WINDOW_SENTENCES,
  REASONING_LIMIT_CHARS,
  reasoningLimit,
  reasoningLoopWatch,
} from "./reasoningWatch";
export { stripToolMarkup } from "./toolMarkup";

export interface TurnLooking extends Looker {
  // Saves what was said of a message's images, leaving the rest of the message as it is stored.
  // Pictures that are gone from the store have nothing to wait for.
  save(messageId: string, seen: readonly SeenNote[], gone: ReadonlySet<string>): Promise<void>;
}

export interface TurnDeps {
  chat: Chat;
  messages: ChatMessage[];
  model: ModelInfo;
  api: ApiSettings;
  streamChat: StreamChat;
  runTool: RunTool | undefined;
  store: ImageStore;
  // Present when the chat has a looking model, which every image then goes to.
  looking?: TurnLooking;
  tools: readonly ToolSchema[];
  toolGuidance: string;
  // Some servers refuse any request that lists tools; with this set, the turn goes on without them.
  toolsOptional?: boolean;
  veniceParameters: boolean;
  signal: AbortSignal;
  persist(message: ChatMessage): Promise<void>;
  onEvent(event: TurnEvent): void;
  // Sheet side in px, for the token estimate sent with requestStart, where a sheet records none.
  resolution: number;
  imageTokens?: (px: number) => number;
  maxRounds?: number;
  thoroughness?: Thoroughness;
  // Aborted by the user's Answer now: the current round answers at once, with no more tool calls.
  answerNow?: AbortSignal;
  // Present only when audio is on for this message: what has been heard so far, for the context.
  audioCoverage?: AudioCoverage;
  // Read once for the turn, so every round sends the same transcript.
  speech?: HeardSpeech;
  timeline?: VideoTimeline;
  cast?: VideoCast;
  now?: () => number;
  newId?: () => string;
}

export type TurnEvent =
  | { type: "assistantStart"; message: AssistantMessage }
  // Round counts from 1.
  | { type: "requestStart"; round: number; images: number; estimatedTokens: number }
  | { type: "assistantDelta"; message: AssistantMessage }
  | { type: "assistantDone"; message: AssistantMessage }
  | { type: "lookStart"; images: number; modelId: string }
  | { type: "looked"; messageId: string; seen: readonly SeenNote[] }
  | { type: "toolStart"; call: ToolCall }
  | { type: "toolDone"; message: ToolMessage }
  | { type: "note"; note: SceneNote };

export type AnswerNowReason = "user" | "loop";

export interface TurnOutcome {
  status: "done" | "stopped" | "error";
  error?: string;
  hitRoundLimit?: true;
  strippedToolMarkup?: true;
  answeredNow?: AnswerNowReason;
  triedToLookAgain?: true;
}

export interface Turn {
  deps: TurnDeps;
  // As it was when the turn began: a note recorded mid-turn waits for the next turn's context,
  // so every round shares one context block and the prompt cache holds.
  chat: Chat;
  messages: ChatMessage[];
  maxRounds: number;
  thoroughness: Thoroughness;
  now: () => number;
  newId: () => string;
  startedAt: number;
  imagesSent: number;
  // Set once the server has refused a request for listing tools.
  toolsRefused: boolean;
  // Stored images never change, so each kept one is read and encoded once a turn, not every round.
  dataUrls: Map<string, string>;
}

interface Sent extends Streamed {
  prepared: PreparedRequest;
}

export interface RoundResult extends Sent {
  answeredNow?: AnswerNowReason;
  // Asked again for a written answer, the model still only tried to call a tool.
  triedToLookAgain?: true;
}

export interface PreparedRequest {
  request: ChatRequest;
  estimatedTokens: number;
}

const STOPPED: TurnOutcome = { status: "stopped" };

export async function runTurn(deps: TurnDeps): Promise<TurnOutcome> {
  const { model } = deps;
  if (model.vision && !deps.looking && pinsExceedCap(deps.messages, model.maxImages)) {
    return {
      status: "error",
      error: `Pinned images exceed this model's limit of ${model.maxImages}; unpin some.`,
    };
  }
  const thoroughness = deps.thoroughness ?? "normal";
  const maxRounds = deps.maxRounds ?? roundsFor(thoroughness, undefined);
  const now = deps.now ?? Date.now;
  const turn: Turn = {
    deps,
    chat: { ...deps.chat, sceneLog: [...deps.chat.sceneLog] },
    messages: [...deps.messages],
    maxRounds,
    thoroughness,
    now,
    newId: deps.newId ?? (() => crypto.randomUUID()),
    startedAt: now(),
    imagesSent: 0,
    toolsRefused: false,
    dataUrls: new Map(),
  };
  try {
    for (let round = 0; round < maxRounds; round++) {
      if (deps.signal.aborted) return STOPPED;
      const result = await askForWrittenAnswer(turn, await runRound(turn, round), round);
      const { ending, answeredNow } = result;
      const triedToLookAgain = result.triedToLookAgain === true;
      const reply = withTextCalls(turn, result);
      const settled = settleReply(reply, ending, {
        round,
        maxRounds,
        answeredNow,
        triedToLookAgain,
      });
      const { outcome } = settled;
      const message = outcome ? withReceipt(turn, settled.message, round) : settled.message;
      if (worthSaving(message, ending)) {
        turn.messages.push(message);
        await deps.persist(message);
      }
      deps.onEvent({ type: "assistantDone", message });
      if (ending.kind === "failed") return errorOutcome(ending.error);
      if (ending.kind === "aborted") return STOPPED;
      if (outcome) return outcome;
      const answered = await answerToolCalls(turn, message.toolCalls, round);
      if (!answered && !answerNowWanted(turn)) return STOPPED;
    }
    return { status: "done" };
  } catch (error) {
    if (deps.signal.aborted || isAbortError(error)) return STOPPED;
    return errorOutcome(error);
  }
}

function worthSaving(message: AssistantMessage, ending: StreamEnding): boolean {
  if (message.text.length > 0) return true;
  if (ending.kind === "failed") return false;
  if (ending.kind !== "aborted") return true;
  return message.toolCalls.length > 0 || (message.reasoning ?? "") !== "";
}

function answerNowWanted({ deps }: Turn): boolean {
  return !deps.signal.aborted && deps.answerNow?.aborted === true;
}

async function runRound(turn: Turn, round: number): Promise<RoundResult> {
  await lookBeforeRound(turn);
  if (answerNowWanted(turn)) return answerNow(turn, round, "user");
  const first = await streamPrepared(turn, round, false, { watch: true });
  if (first.ending.kind !== "cut") return first;
  return answerNow(turn, round, first.ending.reason, first.message);
}

// Asked again with the same messages, told to answer straight away; never cut short a second time.
async function answerNow(
  turn: Turn,
  round: number,
  reason: AnswerNowReason,
  cut?: AssistantMessage,
): Promise<RoundResult> {
  const streamed = await streamPrepared(turn, round, true, {
    watch: false,
    ...(cut ? { cut } : {}),
  });
  return { ...streamed, answeredNow: reason };
}

async function streamPrepared(
  turn: Turn,
  round: number,
  answeringNow: boolean,
  options: StreamOptions,
): Promise<Sent> {
  const finalRound = round === turn.maxRounds - 1;
  const prepared = await prepareRequest(turn, finalRound, answeringNow);
  const streamed = await streamAssistant(turn, prepared, round, options);
  if (!refusedTools(turn, prepared.request, streamed)) return { ...streamed, prepared };
  turn.toolsRefused = true;
  turn.imagesSent -= requestImageCount(prepared.request);
  try {
    await lookBeforeRound(turn);
  } catch (error) {
    const aborted = turn.deps.signal.aborted;
    const ending: StreamEnding = aborted ? { kind: "aborted" } : { kind: "failed", error };
    return { ...streamed, prepared, ending };
  }
  const withoutTools = await prepareRequest(turn, finalRound, answeringNow);
  const retried = await streamAssistant(turn, withoutTools, round, {
    ...options,
    retried: streamed.message,
  });
  return { ...retried, prepared: withoutTools };
}

// Any HTTP error, since llama.cpp answers 500 to a request listing tools it cannot take.
function refusedTools(
  { deps }: Turn,
  request: ChatRequest,
  { ending, producedNothing }: Streamed,
): boolean {
  if (deps.toolsOptional !== true || request.tools === undefined || !producedNothing) return false;
  if (ending.kind !== "failed" || !(ending.error instanceof ApiError)) return false;
  const { status, message } = ending.error;
  return status >= 400 && /tool/i.test(message);
}

interface RoundPosition {
  round: number;
  maxRounds: number;
  answeredNow: AnswerNowReason | undefined;
  triedToLookAgain: boolean;
}

function settleReply(
  reply: AssistantMessage,
  ending: StreamEnding,
  { round, maxRounds, answeredNow, triedToLookAgain }: RoundPosition,
): { message: AssistantMessage; outcome?: TurnOutcome } {
  const lastRound = round === maxRounds - 1;
  const finalRound = lastRound || answeredNow !== undefined;
  const { text, stripped } = stripToolMarkup(reply.text);
  // A server that ignores tool_choice can still call tools on the final round; those go unrun.
  const forcedToAnswer =
    answeredNow === undefined && lastRound && (round > 0 || reply.toolCalls.length > 0);
  const endsTurn = ending.kind === "complete" && (finalRound || reply.toolCalls.length === 0);
  const offerKeepGoing =
    forcedToAnswer || stripped || answeredNow !== undefined || triedToLookAgain;
  const message: AssistantMessage = {
    ...reply,
    text,
    ...(finalRound ? { toolCalls: [] } : {}),
    ...(endsTurn && offerKeepGoing ? { stoppedAtRoundLimit: true as const } : {}),
  };
  if (!endsTurn) return { message };
  const outcome: TurnOutcome = {
    status: "done",
    ...(forcedToAnswer ? { hitRoundLimit: true as const } : {}),
    ...(stripped && !triedToLookAgain ? { strippedToolMarkup: true as const } : {}),
    ...(answeredNow ? { answeredNow } : {}),
    ...(triedToLookAgain ? { triedToLookAgain: true as const } : {}),
  };
  return { message, outcome };
}

function withReceipt(turn: Turn, message: AssistantMessage, round: number): AssistantMessage {
  const { model, speech } = turn.deps;
  const read = transcriptTimes(turn.messages, speech, transcriptTokenCap(model));
  const shown = [...seenSpans(turn.messages), ...instantSpans(read)];
  const receipt: TurnReceipt = {
    rounds: round + 1,
    imagesSent: turn.imagesSent,
    durationMs: turn.now() - turn.startedAt,
    unseenCitations: unseenCitations(message.text, shown),
  };
  return { ...message, receipt };
}

function errorOutcome(error: unknown): TurnOutcome {
  return { status: "error", error: errorText(error) };
}

async function prepareRequest(
  turn: Turn,
  finalRound: boolean,
  answeringNow: boolean,
): Promise<PreparedRequest> {
  const { deps, messages } = turn;
  const kept = keptImages(turn.chat, messages, deps.model.maxImages);
  const dataUrls =
    deps.model.vision && !deps.looking
      ? await loadDataUrls(deps.store, kept, turn.dataUrls)
      : new Map<string, string>();
  const request = buildRequest({
    chat: turn.chat,
    messages,
    model: deps.model,
    kept,
    dataUrls,
    tools: deps.tools,
    toolGuidance: deps.toolGuidance,
    veniceParameters: deps.veniceParameters,
    allowTools: deps.runTool !== undefined && !turn.toolsRefused,
    finalRound,
    thoroughness: turn.thoroughness,
    ...(answeringNow ? { answerNow: true } : {}),
    ...(deps.audioCoverage !== undefined ? { audioCoverage: deps.audioCoverage } : {}),
    ...(deps.speech ? { speech: deps.speech } : {}),
    ...(deps.timeline ? { timeline: deps.timeline } : {}),
    ...(deps.cast ? { cast: deps.cast } : {}),
  });
  const sides = sheetSidesByUrl(messages, dataUrls);
  const estimatedTokens = estimateRequestTokens(request, deps.resolution, deps.imageTokens, sides);
  return { request, estimatedTokens };
}

async function loadDataUrls(
  store: ImageStore,
  ids: ReadonlySet<string>,
  loaded: Map<string, string>,
): Promise<ReadonlyMap<string, string>> {
  for (const id of loaded.keys()) if (!ids.has(id)) loaded.delete(id);
  const entries = await Promise.all(
    [...ids]
      .filter((id) => !loaded.has(id))
      .map(async (id): Promise<[string, string] | undefined> => {
        const blob = await store.getImage(id);
        return blob === undefined ? undefined : [id, await blobToDataUrl(blob)];
      }),
  );
  for (const entry of entries) if (entry !== undefined) loaded.set(...entry);
  return loaded;
}
