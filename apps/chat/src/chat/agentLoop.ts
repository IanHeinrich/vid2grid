import { isAbortError } from "../abort";
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
  StreamChat,
  Thoroughness,
  ToolCall,
  ToolMessage,
  ToolSchema,
  TurnReceipt,
  VideoCast,
  VideoTimeline,
} from "../types";
import { seenSpans, unseenCitations } from "./coverage";
import { pinsExceedCap } from "./imageSelection";
import { buildRequest } from "./request";
import { keptImages } from "./story";
import { streamAssistant, type StreamEnding, type Streamed } from "./streamRound";
import { roundsFor } from "./thoroughness";
import { estimateRequestTokens, sheetSidesByUrl } from "./tokenEstimate";
import { answerToolCalls } from "./toolCalls";
import { stripToolMarkup } from "./toolMarkup";

export { DEEP_MAX_ROUNDS, DEFAULT_MAX_ROUNDS } from "./thoroughness";
export {
  LOOP_SENTENCE_REPEATS,
  LOOP_WINDOW_SENTENCES,
  REASONING_LIMIT_CHARS,
  reasoningLimit,
  reasoningLoopWatch,
} from "./reasoningWatch";
export { stripToolMarkup } from "./toolMarkup";

export interface TurnDeps {
  chat: Chat;
  messages: ChatMessage[];
  model: ModelInfo;
  api: ApiSettings;
  streamChat: StreamChat;
  runTool: RunTool | undefined;
  store: ImageStore;
  tools: readonly ToolSchema[];
  toolGuidance: string;
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
  // Stored images never change, so each kept one is read and encoded once a turn, not every round.
  dataUrls: Map<string, string>;
}

interface RoundResult extends Streamed {
  answeredNow?: AnswerNowReason;
}

export interface PreparedRequest {
  request: ChatRequest;
  estimatedTokens: number;
}

const STOPPED: TurnOutcome = { status: "stopped" };

export async function runTurn(deps: TurnDeps): Promise<TurnOutcome> {
  const { model } = deps;
  if (model.vision && pinsExceedCap(deps.messages, model.maxImages)) {
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
    dataUrls: new Map(),
  };
  try {
    for (let round = 0; round < maxRounds; round++) {
      if (deps.signal.aborted) return STOPPED;
      const { message: reply, ending, answeredNow } = await runRound(turn, round);
      const settled = settleReply(reply, ending, { round, maxRounds, answeredNow });
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
  if (answerNowWanted(turn)) return answerNow(turn, round, "user");
  const finalRound = round === turn.maxRounds - 1;
  const prepared = await prepareRequest(turn, finalRound, false);
  const first = await streamAssistant(turn, prepared, round, { watch: true });
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
  const prepared = await prepareRequest(turn, round === turn.maxRounds - 1, true);
  const streamed = await streamAssistant(turn, prepared, round, {
    watch: false,
    ...(cut ? { cut } : {}),
  });
  return { ...streamed, answeredNow: reason };
}

interface RoundPosition {
  round: number;
  maxRounds: number;
  answeredNow: AnswerNowReason | undefined;
}

function settleReply(
  reply: AssistantMessage,
  ending: StreamEnding,
  { round, maxRounds, answeredNow }: RoundPosition,
): { message: AssistantMessage; outcome?: TurnOutcome } {
  const lastRound = round === maxRounds - 1;
  const finalRound = lastRound || answeredNow !== undefined;
  const { text, stripped } = stripToolMarkup(reply.text);
  // A server that ignores tool_choice can still call tools on the final round; those go unrun.
  const forcedToAnswer =
    answeredNow === undefined && lastRound && (round > 0 || reply.toolCalls.length > 0);
  const endsTurn = ending.kind === "complete" && (finalRound || reply.toolCalls.length === 0);
  const offerKeepGoing = forcedToAnswer || stripped || answeredNow !== undefined;
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
    ...(stripped ? { strippedToolMarkup: true as const } : {}),
    ...(answeredNow ? { answeredNow } : {}),
  };
  return { message, outcome };
}

function withReceipt(turn: Turn, message: AssistantMessage, round: number): AssistantMessage {
  const receipt: TurnReceipt = {
    rounds: round + 1,
    imagesSent: turn.imagesSent,
    durationMs: turn.now() - turn.startedAt,
    unseenCitations: unseenCitations(message.text, seenSpans(turn.messages)),
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
  const dataUrls = deps.model.vision
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
    allowTools: deps.runTool !== undefined,
    finalRound,
    thoroughness: turn.thoroughness,
    ...(answeringNow ? { answerNow: true } : {}),
    ...(deps.audioCoverage !== undefined ? { audioCoverage: deps.audioCoverage } : {}),
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
