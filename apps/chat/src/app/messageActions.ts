import { switchReply, type SwitchedReply } from "../chat/alternates";
import { currentModel } from "../chat/models";
import { videoKeysOf } from "../chat/store";
import { storyForBranch } from "../chat/story";
import { imagesOf } from "../imageRefs";
import { extractTimedClaims, verifyClaims } from "../chat/verify";
import { blobToDataUrl } from "../dataUrl";
import {
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
import type { StatusLine } from "../ui/shared/status";
import type { Toast, ToastHandle } from "../ui/shared/toast";
import type { HeldImages, ImageCleanup } from "./imageCleanup";
import { offerUndo } from "./undo";
import { modelCallDeps } from "./modelCallDeps";
import { conversationTools } from "./toolContext";

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
  conversation: { reset(messages: readonly ChatMessage[]): void };
  toast: Toast;
  images: Pick<ImageCleanup, "hold">;
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

function videoKeysIn(messages: readonly ChatMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === "user" && message.video ? [message.video.fileKey] : [],
  );
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
  const held = deps.images.hold({ messages: copied, videoKeys: videoKeysOf(copy, copied) });
  try {
    await saveBranch(deps.store, chat.id, copy, copied);
  } finally {
    held.letGo();
  }
  replaceChat(state, copy);
  deps.onChatsChanged();
  deps.onOpen(copy.id);
}

async function saveBranch(
  store: ChatStore,
  fromId: string,
  copy: Chat,
  messages: readonly ChatMessage[],
): Promise<void> {
  await store.putChat(copy);
  for (const message of messages) await store.putMessage(copy.id, message);
  const handle = await store.getVideoHandle(fromId);
  if (handle) await store.putVideoHandle(copy.id, handle);
}

async function remove(ctx: MessageActionsContext, message: ChatMessage): Promise<void> {
  const { state, deps } = ctx;
  const chat = state.currentChat;
  if (!chat || state.running) return;
  const group = messageGroup(state.messages, message);
  if (group.length === 0) return;
  const ids = group.map((entry) => entry.id);
  // Held before anything is deleted, so the images are never without a use while Undo is open.
  const held = deps.images.hold({ messages: group, videoKeys: videoKeysIn(group) });
  try {
    await deps.store.deleteMessages(chat.id, ids);
  } catch (error) {
    held.letGo();
    throw error;
  }
  removeMessages(state, ids);
  deps.conversation.reset(state.messages);
  deps.onMessagesChanged?.();
  showUndo(ctx, chat.id, group, held);
}

function invalidateUndo(ctx: MessageActionsContext): void {
  ctx.pendingUndo?.dismiss();
  ctx.pendingUndo = null;
}

function showUndo(
  ctx: MessageActionsContext,
  chatId: string,
  messages: ChatMessage[],
  held: HeldImages,
): void {
  const { state } = ctx;
  ctx.pendingUndo = offerUndo(ctx.deps.toast, "Message deleted", {
    undo: () => undo(ctx, chatId, messages).then(() => held.letGo()),
    stillValid: () => !state.running && state.currentChat?.id === chatId,
    expired: () => held.final(),
    failed: (error) => {
      ctx.deps.status.show(`Could not undo: ${errorText(error)}`, "error");
      held.final();
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
  // Between the saves, the reply switched to is in no saved message.
  const held = deps.images.hold({ messages: switched.restore });
  try {
    await saveSwitch(deps.store, chat.id, switched);
  } finally {
    held.letGo();
  }
  if (state.currentChat?.id !== chat.id) return;
  removeMessages(state, switched.removeIds);
  upsertMessage(state, switched.user);
  restoreMessages(state, switched.restore);
  deps.conversation.reset(state.messages);
}

async function saveSwitch(
  store: ChatStore,
  chatId: string,
  { user, removeIds, restore }: SwitchedReply,
): Promise<void> {
  // Saved first: until it is, the shown reply exists only in the messages about to be removed.
  await store.putMessage(chatId, user);
  if (removeIds.length > 0) await store.deleteMessages(chatId, removeIds);
  for (const message of restore) await store.putMessage(chatId, message);
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
  const runTool = createToolRunner({
    store: toolCtx.store,
    resolution: toolCtx.resolution,
    maxImages: toolCtx.maxImages,
    sheets: { ...toolCtx, signal },
    tools: conversationTools(model, state.messages, { videoLoaded: true, listen: false }).tools,
    knownImages: () => knownImages,
  });
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
