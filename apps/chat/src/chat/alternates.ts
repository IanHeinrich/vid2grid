import type {
  AlternateReply,
  AssistantMessage,
  ChatMessage,
  ModelInfo,
  ToolMessage,
  UserMessage,
} from "../types";
import type { TurnDeps, TurnOutcome } from "./agentLoop";

// Only the latest turn swipes: an earlier turn's alternates are kept but not switchable.

export type ReplyMessage = AssistantMessage | ToolMessage;

export interface ArchivedReply {
  user: UserMessage;
  removeIds: string[];
}

export interface SwitchedReply {
  user: UserMessage;
  // Put after deleting removeIds; their createdAt places them right after the user message.
  restore: ReplyMessage[];
  removeIds: string[];
}

export function replyCount(user: UserMessage): number {
  return (user.alternates?.length ?? 0) + 1;
}

export function currentReplyIndex(user: UserMessage): number {
  const last = user.alternates?.length ?? 0;
  return Math.min(Math.max(0, user.replyIndex ?? last), last);
}

function findUser(
  messages: readonly ChatMessage[],
  userMessageId: string,
): { user: UserMessage; index: number } | undefined {
  const index = messages.findIndex((message) => message.id === userMessageId);
  const user = messages[index];
  return user?.role === "user" ? { user, index } : undefined;
}

function isLatestTurn(messages: readonly ChatMessage[], userMessageId: string): boolean {
  const users = messages.filter((message) => message.role === "user");
  return users.at(-1)?.id === userMessageId;
}

export function canSwipe(messages: readonly ChatMessage[], userMessageId: string): boolean {
  const found = findUser(messages, userMessageId);
  return found !== undefined && isLatestTurn(messages, userMessageId) && replyCount(found.user) > 1;
}

function replyAfter(messages: readonly ChatMessage[], index: number): ReplyMessage[] {
  const reply: ReplyMessage[] = [];
  for (const message of messages.slice(index + 1)) {
    if (message.role === "user") break;
    reply.push(message);
  }
  return reply;
}

function withReplyModel(user: UserMessage, modelId: string | undefined): UserMessage {
  const updated = { ...user };
  delete updated.replyModelId;
  return modelId === undefined ? updated : { ...updated, replyModelId: modelId };
}

function shownAsAlternate(
  user: UserMessage,
  reply: ReplyMessage[],
  fallbackModelId: string | undefined,
): AlternateReply {
  const modelId = user.replyModelId ?? fallbackModelId;
  return {
    messages: reply,
    ...(modelId === undefined ? {} : { modelId }),
    createdAt: reply[0]?.createdAt ?? user.createdAt,
  };
}

function swipeOrder(user: UserMessage, shown: AlternateReply): AlternateReply[] {
  const alternates = user.alternates ?? [];
  const at = currentReplyIndex(user);
  return [...alternates.slice(0, at), shown, ...alternates.slice(at)];
}

// Replay: the shown reply joins the alternates and the reply about to be written goes last.
export function archiveCurrentReply(
  messages: readonly ChatMessage[],
  userMessageId: string,
  modelId: string,
): ArchivedReply | undefined {
  const found = findUser(messages, userMessageId);
  if (!found) return undefined;
  const { user, index } = found;
  const reply = replyAfter(messages, index);
  const alternates =
    reply.length > 0
      ? swipeOrder(user, shownAsAlternate(user, reply, modelId))
      : [...(user.alternates ?? [])];
  const archived: UserMessage = {
    ...withReplyModel(user, undefined),
    alternates,
    replyIndex: alternates.length,
  };
  return { user: archived, removeIds: reply.map((message) => message.id) };
}

// shownModelId labels the shown reply when the user message does not already name its model.
export function switchReply(
  messages: readonly ChatMessage[],
  userMessageId: string,
  index: number,
  shownModelId?: string,
): SwitchedReply | undefined {
  const found = findUser(messages, userMessageId);
  if (!found || !canSwipe(messages, userMessageId)) return undefined;
  const { user } = found;
  if (index === currentReplyIndex(user) || index < 0 || index >= replyCount(user)) return undefined;
  const reply = replyAfter(messages, found.index);
  const order = swipeOrder(user, shownAsAlternate(user, reply, shownModelId));
  const target = order[index];
  if (!target) return undefined;
  // An empty reply, left by a failed replay, is dropped rather than kept as a swipe.
  const keep = (alternate: AlternateReply, at: number) =>
    at !== index && alternate.messages.length > 0;
  const alternates = order.filter(keep);
  const replyIndex = order.slice(0, index).filter(keep).length;
  const switched: UserMessage = {
    ...withReplyModel(user, target.modelId),
    alternates,
    replyIndex,
  };
  const restore = target.messages.map((message, offset) => ({
    ...message,
    createdAt: user.createdAt + offset + 1,
  }));
  return { user: switched, restore, removeIds: reply.map((message) => message.id) };
}

export interface CompareDeps {
  runTurn(deps: TurnDeps): Promise<TurnOutcome>;
  // Everything runTurn needs apart from the history and the model; chat's model id is replaced.
  turn: Omit<TurnDeps, "messages" | "model">;
  saveUser(message: UserMessage): Promise<void>;
  removeMessages(ids: readonly string[]): Promise<void>;
}

export interface CompareInput {
  messages: readonly ChatMessage[];
  userMessageId: string;
  // Labels the shown reply when the user message does not already name its model.
  currentModelId: string;
  model: ModelInfo;
}

export interface CompareResult {
  user: UserMessage;
  outcome: TurnOutcome;
}

// The other model's reply is shown once written; the reply it replaces stays a swipe away.
export async function compareWithModel(
  deps: CompareDeps,
  input: CompareInput,
): Promise<CompareResult | undefined> {
  const { messages, userMessageId, model } = input;
  if (!isLatestTurn(messages, userMessageId)) return undefined;
  const archived = archiveCurrentReply(messages, userMessageId, input.currentModelId);
  if (!archived) return undefined;
  const user = withReplyModel(archived.user, model.id);
  // Saved first: until it is, the archived reply exists only in the messages about to be removed.
  await deps.saveUser(user);
  await deps.removeMessages(archived.removeIds);
  const removed = new Set(archived.removeIds);
  const history = messages.flatMap((message) => {
    if (removed.has(message.id)) return [];
    return [message.id === user.id ? user : message];
  });
  const { chat } = deps.turn;
  const outcome = await deps.runTurn({
    ...deps.turn,
    chat: { ...chat, settings: { ...chat.settings, modelId: model.id } },
    messages: history,
    model,
  });
  return { user, outcome };
}
