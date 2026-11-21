import { isAbortError, orWhenAborted } from "../abort";
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
  StreamEvent,
  Thoroughness,
  TokenUsage,
  ToolCall,
  ToolMessage,
  ToolResult,
  ToolSchema,
  TurnReceipt,
  VideoCast,
  VideoTimeline,
} from "../types";
import { seenSpans, unseenCitations } from "./coverage";
import { pinsExceedCap } from "./imageSelection";
import { buildRequest } from "./request";
import { keptImages } from "./story";
import { roundsFor } from "./thoroughness";
import { estimateRequestTokens, requestImageCount, sheetSidesByUrl } from "./tokenEstimate";

export { DEEP_MAX_ROUNDS, DEFAULT_MAX_ROUNDS } from "./thoroughness";

const NO_VIDEO = "No video is attached.";

// Generous for honest deliberation: a normal reply still thinking past this with no answer is stuck.
export const REASONING_LIMIT_CHARS = 24_000;
const REASONING_LIMIT_SCALE: Record<Thoroughness, number> = {
  normal: 1,
  thorough: 2,
  exhaustive: 4,
};
const LOOP_SENTENCE_MIN_CHARS = 25;
export const LOOP_SENTENCE_REPEATS = 4;
// Repeats count only among recent sentences, so filler said now and then across a long trace is fine.
export const LOOP_WINDOW_SENTENCES = 40;
// Far longer than any sentence worth matching; past it the unfinished sentence stops growing.
const MAX_PENDING_CHARS = 2_000;
const SENTENCE_END = /[.!?\n]+/;

export function reasoningLimit(tier: Thoroughness): number {
  return REASONING_LIMIT_CHARS * REASONING_LIMIT_SCALE[tier];
}

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

interface Turn {
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

type StreamEnding =
  | { kind: "complete" }
  | { kind: "aborted" }
  | { kind: "failed"; error: unknown }
  | { kind: "cut"; reason: AnswerNowReason };

interface Streamed {
  message: AssistantMessage;
  ending: StreamEnding;
}

interface RoundResult extends Streamed {
  answeredNow?: AnswerNowReason;
}

interface PreparedRequest {
  request: ChatRequest;
  estimatedTokens: number;
}

const STOPPED: TurnOutcome = { status: "stopped" };
const THINK_END = "</think>";

// DeepSeek's special tokens use a fullwidth bar, and a lower one-eighth block in place of spaces.
const BAR = "[\\uFF5C|]";
const SEP = "[\\u2581_ ]";
const DSML_OPEN = `<\\s*${BAR}\\s*DSML\\s*${BAR}\\s*`;
const DSML_CLOSE = `<\\s*(?:\\/\\s*${BAR}|${BAR}\\s*\\/)\\s*DSML\\s*${BAR}\\s*`;
const DSML_ANY = `<\\s*\\/?\\s*${BAR}\\s*\\/?\\s*DSML\\s*${BAR}`;
const UNTIL_CLOSED_OR_END = (close: string) => `[\\s\\S]*?(?:${close}|$)`;

// Models fall back to their native tool syntax as text, mostly when told to stop calling tools.
// Whole blocks go first, so the stray-tag patterns do not leave a block's arguments behind.
const LEAKED_TOOL_MARKUP = [
  new RegExp(
    `${DSML_OPEN}(\\w*calls|invoke)\\b[^>]*>${UNTIL_CLOSED_OR_END(`${DSML_CLOSE}\\1\\s*>`)}`,
    "gi",
  ),
  new RegExp(
    `<${BAR}\\s*tool${SEP}calls${SEP}begin\\s*${BAR}>${UNTIL_CLOSED_OR_END(`<${BAR}\\s*tool${SEP}calls${SEP}end\\s*${BAR}>`)}`,
    "gi",
  ),
  /<(tool_calls?|function_calls)>[\s\S]*?(?:<\/\1>|$)/gi,
  /<\|\s*(tool\w*?)(?:_begin)?\s*\|>[\s\S]*?<\|\s*(?:\/\s*\1|\1_end)\s*\|>/gi,
  new RegExp(`${DSML_ANY}[^>]*>`, "gi"),
  new RegExp(`<${BAR}\\s*tool${SEP}[^>]*?${BAR}>`, "gi"),
  /<\|\s*\/?\s*tool\w*\s*\|>/gi,
];

export function stripToolMarkup(text: string): { text: string; stripped: boolean } {
  const cleaned = LEAKED_TOOL_MARKUP.reduce(
    (current, pattern) => current.replace(pattern, ""),
    text,
  );
  if (cleaned === text) return { text, stripped: false };
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), stripped: true };
}

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

// Qwen3 and DeepSeek-R1 templates on local servers pre-fill <think>, so only the closing tag streams.
function splitThink(text: string, reasoning: string): Pick<AssistantMessage, "text" | "reasoning"> {
  if (reasoning.length > 0) return { text, reasoning };
  const end = text.indexOf(THINK_END);
  if (end < 0) return { text };
  const thought = text.slice(0, end).replace(/^\s*<think>/, "");
  return { reasoning: thought.trim(), text: text.slice(end + THINK_END.length).trimStart() };
}

function normaliseSentence(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function recentSentences(): (sentence: string) => number {
  const window: string[] = [];
  const counts = new Map<string, number>();
  return (sentence) => {
    window.push(sentence);
    counts.set(sentence, (counts.get(sentence) ?? 0) + 1);
    const dropped = window.length > LOOP_WINDOW_SENTENCES ? window.shift() : undefined;
    if (dropped !== undefined) counts.set(dropped, (counts.get(dropped) ?? 1) - 1);
    return counts.get(sentence) ?? 0;
  };
}

// Fed reasoning as it streams; true once a sentence keeps coming back or the reasoning runs too long.
// Only the new delta is split, so a long stream costs time in proportion to its length.
export function reasoningLoopWatch(limitChars: number): (delta: string) => boolean {
  const remember = recentSentences();
  let length = 0;
  let pending = "";
  return (delta) => {
    length += delta.length;
    if (length > limitChars) return true;
    const pieces = delta.split(SENTENCE_END);
    const last = pieces.pop() ?? "";
    if (pieces.length === 0) {
      pending = (pending + last).slice(0, MAX_PENDING_CHARS);
      return false;
    }
    const finished = [pending + (pieces[0] ?? ""), ...pieces.slice(1)];
    pending = last.slice(0, MAX_PENDING_CHARS);
    return finished.some((piece) => {
      const sentence = normaliseSentence(piece);
      if (sentence.length < LOOP_SENTENCE_MIN_CHARS) return false;
      return remember(sentence) >= LOOP_SENTENCE_REPEATS;
    });
  };
}

interface StreamCutter {
  signal: AbortSignal;
  reason(): AnswerNowReason | undefined;
  cut(reason: AnswerNowReason): void;
}

// Its own signal, so a cut ends only this stream while a stop still ends it too.
function streamCutter(deps: TurnDeps, watch: boolean): StreamCutter {
  const own = new AbortController();
  let reason: AnswerNowReason | undefined;
  const cut = (why: AnswerNowReason) => {
    reason ??= why;
    own.abort();
  };
  const answerNow = watch ? deps.answerNow : undefined;
  if (answerNow?.aborted) cut("user");
  else answerNow?.addEventListener("abort", () => cut("user"), { once: true });
  return { signal: AbortSignal.any([deps.signal, own.signal]), reason: () => reason, cut };
}

function joinReasoning(earlier: string, latest: string | undefined): string {
  return [earlier, latest ?? ""].filter((part) => part !== "").join("\n\n");
}

interface StreamOptions {
  // Watch for a reasoning loop and for Answer now; off for the answer-now retry itself.
  watch: boolean;
  // The stream this one retries: its id and reasoning carry over, marked as cut short.
  cut?: AssistantMessage;
}

interface StreamedParts {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
}

// True when the event changed what the message shows.
function applyEvent(parts: StreamedParts, event: StreamEvent): boolean {
  switch (event.type) {
    case "text":
      parts.text += event.delta;
      return true;
    case "reasoning":
      parts.reasoning += event.delta;
      return true;
    case "toolCalls":
      parts.toolCalls = [...parts.toolCalls, ...event.calls];
      return false;
    case "usage":
      parts.usage = event.usage;
      return true;
    case "done":
      return false;
  }
}

function streamedMessage(
  base: Pick<AssistantMessage, "id" | "createdAt" | "role">,
  parts: StreamedParts,
  cut: AssistantMessage | undefined,
): AssistantMessage {
  const split = splitThink(parts.text, parts.reasoning);
  const thought = joinReasoning(cut?.reasoning ?? "", split.reasoning);
  return {
    ...base,
    text: split.text,
    ...(thought !== "" || split.reasoning !== undefined ? { reasoning: thought } : {}),
    toolCalls: parts.toolCalls,
    ...(parts.usage ? { usage: parts.usage } : {}),
    ...(cut ? { reasoningCutShort: true as const } : {}),
  };
}

async function streamAssistant(
  turn: Turn,
  { request, estimatedTokens }: PreparedRequest,
  round: number,
  { watch, cut }: StreamOptions,
): Promise<Streamed> {
  const { deps } = turn;
  turn.imagesSent += requestImageCount(request);
  const base = cut
    ? { id: cut.id, createdAt: cut.createdAt, role: "assistant" as const }
    : { id: turn.newId(), createdAt: turn.now(), role: "assistant" as const };
  const parts: StreamedParts = { text: "", reasoning: "", toolCalls: [] };
  const current = () => streamedMessage(base, parts, cut);
  const looping = reasoningLoopWatch(reasoningLimit(turn.thoroughness));
  const cutter = streamCutter(deps, watch);
  deps.onEvent({ type: "assistantStart", message: current() });
  deps.onEvent({
    type: "requestStart",
    round: round + 1,
    images: requestImageCount(request),
    estimatedTokens,
  });
  try {
    if (!cutter.signal.aborted) {
      for await (const event of deps.streamChat(deps.api, request, cutter.signal)) {
        const changed = applyEvent(parts, event);
        const answering = parts.text !== "" || parts.toolCalls.length > 0;
        if (watch && event.type === "reasoning" && !answering && looping(event.delta)) {
          cutter.cut("loop");
        }
        if (changed) deps.onEvent({ type: "assistantDelta", message: current() });
        if (cutter.signal.aborted) break;
      }
    }
  } catch (error) {
    return { message: current(), ending: failedEnding(deps, cutter, error) };
  }
  return { message: current(), ending: settledEnding(deps, cutter) };
}

function settledEnding(deps: TurnDeps, cutter: StreamCutter): StreamEnding {
  if (deps.signal.aborted) return { kind: "aborted" };
  const reason = cutter.reason();
  return reason ? { kind: "cut", reason } : { kind: "complete" };
}

function failedEnding(deps: TurnDeps, cutter: StreamCutter, error: unknown): StreamEnding {
  if (!deps.signal.aborted && !isAbortError(error)) return { kind: "failed", error };
  const ending = settledEnding(deps, cutter);
  return ending.kind === "cut" ? ending : { kind: "aborted" };
}

function roundSuffix(round: number, maxRounds: number): string {
  return ` (Round ${round + 1} of ${maxRounds}. Batch several calls into one round when you can.)`;
}

function runCall({ deps }: Turn, call: ToolCall): Promise<ToolResult> {
  deps.onEvent({ type: "toolStart", call });
  return deps.runTool ? deps.runTool(call) : Promise.resolve({ text: NO_VIDEO, images: [] });
}

interface StartedCall {
  call: ToolCall;
  // Undefined when a stop came before the call's turn to run.
  result: Promise<ToolResult | undefined>;
}

function halted({ deps }: Turn): boolean {
  return deps.signal.aborted || deps.answerNow?.aborted === true;
}

// listen reads audio rather than rendering frames, so it starts at once; renders run one at a time.
function startCalls(turn: Turn, calls: readonly ToolCall[]): StartedCall[] {
  const listening = calls.map((call) => (call.name === "listen" ? runCall(turn, call) : undefined));
  let previous: Promise<ToolResult | undefined> = Promise.resolve(undefined);
  return calls.map((call, index) => {
    const started = listening[index];
    if (started) return { call, result: started };
    previous = previous.then(() => (halted(turn) ? undefined : runCall(turn, call)));
    return { call, result: previous };
  });
}

// Answer now drops whatever is still running, as a stop does, rather than waiting on a render.
function unlessAnsweringNow(
  { deps }: Turn,
  pending: Promise<ToolResult | undefined>,
): Promise<ToolResult | undefined> {
  if (!deps.answerNow) return pending;
  return orWhenAborted(pending, deps.answerNow, undefined);
}

async function answerToolCalls(
  turn: Turn,
  calls: readonly ToolCall[],
  round: number,
): Promise<boolean> {
  const { deps } = turn;
  const started = startCalls(turn, calls);
  // Results are awaited in order, so one failing after a stop or an earlier failure is never awaited.
  for (const { result } of started) result.catch(() => undefined);
  for (const { call, result: pending } of started) {
    const result = await unlessAnsweringNow(turn, pending);
    // A render cannot be cancelled once started, so a stop only discards its result.
    if (result === undefined || halted(turn)) return false;
    const message: ToolMessage = {
      id: turn.newId(),
      createdAt: turn.now(),
      role: "tool",
      toolCallId: call.id,
      text: result.text + roundSuffix(round, turn.maxRounds),
      images: result.images,
    };
    turn.messages.push(message);
    await deps.persist(message);
    deps.onEvent({ type: "toolDone", message });
    if (result.note) deps.onEvent({ type: "note", note: result.note });
  }
  return true;
}
