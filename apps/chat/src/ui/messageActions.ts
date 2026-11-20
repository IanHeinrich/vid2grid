import { switchReply } from "../chat/alternates";
import { blobToDataUrl } from "../chat/dataUrl";
import { imagesOf, storyForBranch } from "../chat/history";
import { extractTimedClaims, verifyClaims } from "../chat/verify";
import type { StatusLine } from "../dom";
import {
  currentModel,
  removeMessages,
  replaceChat,
  restoreMessages,
  upsertMessage,
  type AppState,
} from "../state";
import { errorText } from "../text";
import type {
  AssistantMessage,
  Chat,
  ChatMessage,
  ChatStore,
  ClaimCheck,
  ImageRef,
  ImageStore,
  RunTool,
  StreamChat,
  UserMessage,
} from "../types";
import { createToolRunner, type ToolContext } from "../video/tools";
import type { Conversation } from "./conversation";
import { modelCallDeps } from "./modelTask";
import type { Toast, ToastHandle } from "./toast";

const REATTACH_TO_CHECK = "Reattach the video to check the timestamps.";

export interface MessageActions {
  branch(message: ChatMessage): Promise<void>;
  remove(message: ChatMessage): Promise<void>;
  copy(message: ChatMessage): Promise<void>;
  switchReply(user: UserMessage, index: number): Promise<void>;
  verify(message: AssistantMessage, signal: AbortSignal): Promise<AssistantMessage | undefined>;
  invalidateUndo(): void;
}

export interface MessageActionsDeps {
  store: ChatStore;
  status: StatusLine;
  conversation: Pick<Conversation, "reset">;
  toast: Toast;
  streamChat: StreamChat;
  toolContext(): ToolContext | undefined;
  onOpen(chatId: string): void;
  onChatsChanged(): void;
  // Deleting or restoring a message can add or drop one of the chat's videos.
  onMessagesChanged?: () => void;
  clipboard?: Pick<Clipboard, "writeText">;
  newId?: () => string;
  now?: () => number;
}

interface MessageActionsContext {
  state: AppState;
  deps: MessageActionsDeps;
  pendingUndo: ToastHandle | null;
}

export function initMessageActions(state: AppState, deps: MessageActionsDeps): MessageActions {
  const ctx: MessageActionsContext = { state, deps, pendingUndo: null };
  return {
    branch: (message) => branch(ctx, message),
    remove: (message) => remove(ctx, message),
    copy: (message) => copy(ctx, message),
    switchReply: (user, index) => switchTo(ctx, user, index),
    verify: (message, signal) => verify(ctx, message, signal),
    invalidateUndo: () => invalidateUndo(ctx),
  };
}

function endsAReply(message: ChatMessage | undefined): boolean {
  if (message?.role === "user") return true;
  return message?.role === "assistant" && message.toolCalls.length === 0;
}

// A reply is its tool rounds and final text: back to the user message or finished reply before it.
export function messageGroup(
  messages: readonly ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const end = messages.findIndex((entry) => entry.id === message.id);
  if (end === -1) return [];
  if (message.role !== "assistant") return [message];
  let start = end;
  while (start > 0 && !endsAReply(messages[start - 1])) start -= 1;
  return messages.slice(start, end + 1);
}

async function branch(ctx: MessageActionsContext, message: ChatMessage): Promise<void> {
  const { state, deps } = ctx;
  const chat = state.currentChat;
  if (!chat || state.running) return;
  const end = state.messages.findIndex((entry) => entry.id === message.id);
  if (end === -1) return;
  // Taken before any await, so a turn started meanwhile cannot slip a half-written reply in.
  const copied = state.messages.slice(0, end + 1);
  const now = (deps.now ?? Date.now)();
  const copy: Chat = {
    ...chat,
    id: (deps.newId ?? (() => crypto.randomUUID()))(),
    title: `${chat.title} (branch)`,
    createdAt: now,
    updatedAt: now,
    sceneLog: [...chat.sceneLog],
  };
  const story = storyForBranch(chat.storySoFar, copied);
  if (story) copy.storySoFar = story;
  else delete copy.storySoFar;
  await deps.store.putChat(copy);
  for (const entry of copied) await deps.store.putMessage(copy.id, entry);
  const handle = await deps.store.getVideoHandle(chat.id);
  if (handle) await deps.store.putVideoHandle(copy.id, handle);
  replaceChat(state, copy);
  deps.onChatsChanged();
  deps.onOpen(copy.id);
}

async function remove(ctx: MessageActionsContext, message: ChatMessage): Promise<void> {
  const { state, deps } = ctx;
  const chat = state.currentChat;
  if (!chat || state.running) return;
  const group = messageGroup(state.messages, message);
  if (group.length === 0) return;
  const ids = group.map((entry) => entry.id);
  await deps.store.deleteMessages(chat.id, ids);
  removeMessages(state, ids);
  deps.conversation.reset(state.messages);
  deps.onMessagesChanged?.();
  showUndo(ctx, chat.id, group);
}

function invalidateUndo(ctx: MessageActionsContext): void {
  ctx.pendingUndo?.dismiss();
  ctx.pendingUndo = null;
}

function showUndo(ctx: MessageActionsContext, chatId: string, messages: ChatMessage[]): void {
  ctx.pendingUndo = ctx.deps.toast.show("Message deleted", {
    label: "Undo",
    run: () => {
      undo(ctx, chatId, messages).catch((error: unknown) => {
        ctx.deps.status.show(`Could not undo: ${errorText(error)}`, "error");
      });
    },
  });
}

async function undo(
  ctx: MessageActionsContext,
  chatId: string,
  messages: ChatMessage[],
): Promise<void> {
  ctx.pendingUndo = null;
  const { state } = ctx;
  if (state.running || state.currentChat?.id !== chatId) return;
  for (const message of messages) await ctx.deps.store.putMessage(chatId, message);
  if (state.currentChat?.id !== chatId) return;
  restoreMessages(state, messages);
  ctx.deps.conversation.reset(state.messages);
  ctx.deps.onMessagesChanged?.();
}

async function copy(ctx: MessageActionsContext, message: ChatMessage): Promise<void> {
  const clipboard = ctx.deps.clipboard ?? navigator.clipboard;
  try {
    await clipboard.writeText(message.text);
    ctx.deps.toast.show("Copied");
  } catch (error) {
    ctx.deps.toast.show(`Could not copy: ${errorText(error)}`);
  }
}

async function switchTo(
  ctx: MessageActionsContext,
  user: UserMessage,
  index: number,
): Promise<void> {
  const { state, deps } = ctx;
  const chat = state.currentChat;
  if (!chat || state.running) return;
  invalidateUndo(ctx);
  const switched = switchReply(state.messages, user.id, index, chat.settings.modelId);
  if (!switched) return;
  if (switched.removeIds.length > 0) await deps.store.deleteMessages(chat.id, switched.removeIds);
  await deps.store.putMessage(chat.id, switched.user);
  for (const message of switched.restore) await deps.store.putMessage(chat.id, message);
  if (state.currentChat?.id !== chat.id) return;
  removeMessages(state, switched.removeIds);
  upsertMessage(state, switched.user);
  restoreMessages(state, switched.restore);
  deps.conversation.reset(state.messages);
}

async function renderFrames(runTool: RunTool, times: number[]): Promise<ImageRef[]> {
  const result = await runTool({
    id: "verify",
    name: "frames",
    arguments: JSON.stringify({ times }),
  });
  if (result.images.length === 0) throw new Error(result.text);
  return result.images;
}

async function loadImage(store: ImageStore, ref: ImageRef): Promise<string> {
  const blob = await store.getImage(ref.id);
  if (blob === undefined) throw new Error("A rendered frame is missing from the image store.");
  return blobToDataUrl(blob);
}

async function verify(
  ctx: MessageActionsContext,
  message: AssistantMessage,
  signal: AbortSignal,
): Promise<AssistantMessage | undefined> {
  const { state, deps } = ctx;
  const chat = state.currentChat;
  const model = currentModel(state);
  const claims = extractTimedClaims(message.text);
  if (!chat || model === null || claims.length === 0) return undefined;
  const toolCtx = deps.toolContext();
  if (!toolCtx) {
    deps.toast.show(REATTACH_TO_CHECK);
    return undefined;
  }
  const knownImages = state.messages.flatMap(imagesOf);
  const runTool = createToolRunner({ ...toolCtx, knownImages: () => knownImages });
  try {
    const checks = await verifyClaims(
      {
        ...modelCallDeps(state, deps.streamChat, model.id, signal),
        renderFrames: (times) => renderFrames(runTool, times),
        loadImage: (ref) => loadImage(deps.store, ref),
      },
      claims,
    );
    return await saveVerification(ctx, chat.id, message, checks);
  } catch (error) {
    if (!signal.aborted) deps.toast.show(`Could not check the timestamps: ${errorText(error)}`);
    return undefined;
  }
}

// The reply may have been edited or deleted while the check ran; then the verdicts no longer apply.
async function saveVerification(
  ctx: MessageActionsContext,
  chatId: string,
  message: AssistantMessage,
  verification: ClaimCheck[],
): Promise<AssistantMessage | undefined> {
  const { state, deps } = ctx;
  if (!state.chats.some((chat) => chat.id === chatId)) return undefined;
  const latest =
    state.currentChat?.id === chatId
      ? state.messages.find((entry) => entry.id === message.id)
      : (await deps.store.listMessages(chatId)).find((entry) => entry.id === message.id);
  if (latest?.role !== "assistant" || latest.text !== message.text) return undefined;
  const updated: AssistantMessage = { ...latest, verification };
  await deps.store.putMessage(chatId, updated);
  if (state.currentChat?.id === chatId) upsertMessage(state, updated);
  return updated;
}
