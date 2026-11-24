import { removalKeys, withVideoBack, withVideoRemoved } from "../chat/messageVideo";
import { isRunningIn, updateChat, upsertMessage, type AppState } from "../state";
import { errorText } from "../text";
import type {
  Chat,
  ChatMessage,
  ChatStore,
  RemovedVideo,
  SceneNote,
  UserMessage,
  VideoAttachment,
} from "../types";
import type { StatusLine } from "../ui/shared/status";
import type { Toast, ToastHandle } from "../ui/shared/toast";
import type { LoadedFile, VideoPanel } from "../ui/video/videoPanel";
import type { HeldImages, ImageCleanup } from "./imageCleanup";
import { offerUndo } from "./undo";

const REPLY_RUNNING = "Stop or wait for the reply before removing the video.";
const STUDY_RUNNING = "Stop or wait for the study before removing the video.";

export interface VideoRemoval {
  // Why the current chat's videos cannot be removed now, or undefined.
  blocker(): string | undefined;
  remove(fileKey: string): Promise<void>;
  invalidateUndo(): void;
}

export interface VideoRemovalDeps {
  store: ChatStore;
  status: Pick<StatusLine, "show">;
  toast: Toast;
  images: Pick<ImageCleanup, "hold">;
  conversation: { showAll(messages: readonly ChatMessage[]): void; stopChecks(): void };
  video: Pick<VideoPanel, "detach" | "putBack">;
  isStudying(chatId: string): boolean;
  // The undo window has passed, so the stored copies can go where nothing else uses them.
  onFinal(videoKeys: string[]): void;
  onChanged(): void;
}

// The chat's own video, and what goes with it.
interface OwnVideo {
  video: VideoAttachment;
  sceneLog: readonly SceneNote[];
  loaded: LoadedFile | undefined;
  handle: FileSystemFileHandle | undefined;
  // What the chat keeps of it, or undefined when there are no messages it was about.
  record: RemovedVideo | undefined;
}

interface Removed {
  chatId: string;
  keys: ReadonlySet<string>;
  messageIds: ReadonlySet<string>;
  // Undefined when an earlier video was removed, which leaves the chat's own as it is.
  own: OwnVideo | undefined;
}

interface RemovalContext {
  state: AppState;
  deps: VideoRemovalDeps;
  pendingUndo: ToastHandle | null;
}

export function initVideoRemoval(state: AppState, deps: VideoRemovalDeps): VideoRemoval {
  const ctx: RemovalContext = { state, deps, pendingUndo: null };
  return {
    blocker: () => blocker(ctx),
    remove: (fileKey) => remove(ctx, fileKey),
    invalidateUndo: () => {
      ctx.pendingUndo?.dismiss();
      ctx.pendingUndo = null;
    },
  };
}

function blocker({ state, deps }: RemovalContext): string | undefined {
  const chat = state.currentChat;
  if (!chat) return undefined;
  if (isRunningIn(state, chat.id)) return REPLY_RUNNING;
  return deps.isStudying(chat.id) ? STUDY_RUNNING : undefined;
}

function ownVideo(chat: Chat, messages: readonly ChatMessage[]): OwnVideo | undefined {
  const { video, sceneLog } = chat;
  if (!video) return undefined;
  const throughCreatedAt = Math.max(...messages.map(({ createdAt }) => createdAt));
  const record = messages.length > 0 ? { video, throughCreatedAt } : undefined;
  return { video, sceneLog, loaded: undefined, handle: undefined, record };
}

function withoutOwnVideo(chat: Chat, { record }: OwnVideo): Chat {
  const changed: Chat = { ...chat, sceneLog: [] };
  delete changed.video;
  if (record) changed.removedVideos = [...(chat.removedVideos ?? []), record];
  return changed;
}

function withOwnVideo(chat: Chat, { video, sceneLog, record }: OwnVideo): Chat {
  const changed: Chat = { ...chat, video, sceneLog: [...sceneLog, ...chat.sceneLog] };
  const others = chat.removedVideos?.filter((entry) => !sameRecord(entry, record)) ?? [];
  delete changed.removedVideos;
  if (others.length > 0) changed.removedVideos = others;
  return changed;
}

// Compared by what they hold, since the chat may have been read from the store again.
function sameRecord(entry: RemovedVideo, record: RemovedVideo | undefined): boolean {
  return (
    entry.video.fileKey === record?.video.fileKey &&
    entry.throughCreatedAt === record.throughCreatedAt
  );
}

async function remove(ctx: RemovalContext, fileKey: string): Promise<void> {
  const { state, deps } = ctx;
  const chat = state.currentChat;
  if (!chat) return;
  const reason = blocker(ctx);
  if (reason !== undefined) {
    deps.status.show(reason, "error");
    return;
  }
  const keys = removalKeys(state.messages, chat.video, fileKey);
  const own =
    chat.video && keys.has(chat.video.fileKey) ? ownVideo(chat, state.messages) : undefined;
  const messages = state.messages.filter(
    (message): message is UserMessage =>
      message.role === "user" && message.video !== undefined && keys.has(message.video.fileKey),
  );
  const name = own?.video.name ?? messages[0]?.video?.name;
  if (name === undefined) return;
  const removed: Removed = {
    chatId: chat.id,
    keys,
    messageIds: new Set(messages.map((message) => message.id)),
    own,
  };
  // Held before anything changes, so its cached sheets are never without a use while Undo is open.
  const held = deps.images.hold({ videoKeys: [...keys] });
  try {
    await takeOut(ctx, removed, messages.map(withVideoRemoved));
  } catch (error) {
    // Best effort: the removal's own error is the one worth showing.
    await putBack(ctx, removed).catch(() => undefined);
    held.letGo();
    throw error;
  }
  showUndo(ctx, removed, name, held);
}

// The state changes before any await, so a turn started meanwhile already goes without the video.
async function takeOut(
  ctx: RemovalContext,
  removed: Removed,
  messages: readonly UserMessage[],
): Promise<void> {
  const { state, deps } = ctx;
  const { chatId, own } = removed;
  if (own) deps.conversation.stopChecks();
  const saves: Promise<unknown>[] = own
    ? [
        updateChat(state, deps.store, chatId, (chat) => withoutOwnVideo(chat, own)),
        takeHandle(deps.store, chatId, own),
      ]
    : [];
  saves.push(...showAndSave(ctx, chatId, messages));
  const loaded = deps.video.detach(chatId, removed.keys);
  if (own) own.loaded = loaded;
  deps.onChanged();
  await allSettled(saves);
}

// Each is settled before one's failure is thrown, so none is left to race what then puts things back.
async function allSettled(saves: readonly Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(saves);
  await Promise.all(saves);
}

async function takeHandle(store: ChatStore, chatId: string, own: OwnVideo): Promise<void> {
  own.handle = await store.getVideoHandle(chatId);
  if (own.handle) await store.deleteVideoHandle(chatId);
}

function showAndSave(
  { state, deps }: RemovalContext,
  chatId: string,
  messages: readonly UserMessage[],
): Promise<void>[] {
  if (state.currentChat?.id === chatId) {
    for (const message of messages) upsertMessage(state, message);
    deps.conversation.showAll(messages);
  }
  return messages.map((message) => deps.store.putMessage(chatId, message));
}

function showUndo(ctx: RemovalContext, removed: Removed, name: string, held: HeldImages): void {
  const { state, deps } = ctx;
  const { chatId, keys, own } = removed;
  ctx.pendingUndo = offerUndo(deps.toast, `Removed ${name} from this chat`, {
    undo: async () => {
      ctx.pendingUndo = null;
      await putBack(ctx, removed);
      held.letGo();
    },
    stillValid: () => {
      const chat = state.chats.find((entry) => entry.id === chatId);
      if (!chat || isRunningIn(state, chatId)) return false;
      return own === undefined || chat.video === undefined;
    },
    expired: () => {
      held.final();
      deps.onFinal([...keys]);
    },
    failed: (error) => {
      deps.toast.show(`Could not put the video back: ${errorText(error)}`);
      held.letGo();
    },
  });
}

// Built on the newest copies, so an edit or a pin made meanwhile is kept.
async function putBack(ctx: RemovalContext, { chatId, messageIds, own }: Removed): Promise<void> {
  const { state, deps } = ctx;
  const isCurrent = () => state.currentChat?.id === chatId;
  const stored = isCurrent() ? state.messages : await deps.store.listMessages(chatId);
  const latest = isCurrent() ? state.messages : stored;
  const messages = latest.flatMap((message) =>
    message.role === "user" && messageIds.has(message.id) ? [withVideoBack(message)] : [],
  );
  const saves: Promise<unknown>[] = own ? ownSaves(ctx, chatId, own) : [];
  saves.push(...showAndSave(ctx, chatId, messages));
  if (own) saves.push(deps.video.putBack(chatId, own.loaded));
  deps.onChanged();
  await allSettled(saves);
}

function ownSaves(
  { state, deps }: RemovalContext,
  chatId: string,
  own: OwnVideo,
): Promise<unknown>[] {
  return [
    updateChat(state, deps.store, chatId, (chat) => withOwnVideo(chat, own)),
    ...(own.handle ? [deps.store.putVideoHandle(chatId, own.handle)] : []),
  ];
}
