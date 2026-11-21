import { latestCalls } from "../latest";
import { setCurrentChat } from "../state";
import type { Chat } from "../types";
import type { StatusLine } from "../ui/status";
import type { MessageActions } from "./messageActions";
import { fillChatModel, type FillChatModelDeps } from "./modelList";
import type { Turns, TurnView } from "./turns";

export interface ChatOpener {
  open(chatId: string): Promise<void>;
  // The newest chat, or a new one when there is none.
  openFallback(): Promise<void>;
}

export interface ChatOpenerDeps extends FillChatModelDeps {
  status: Pick<StatusLine, "show" | "clear">;
  turns: Pick<Turns, "stop">;
  actions: Pick<MessageActions, "invalidateUndo">;
  conversation: Pick<TurnView, "reset" | "setRunning">;
  video: { restore(): Promise<void> };
  composer: { render(): void };
  sidebar: { createChat(): Promise<Chat> };
}

interface OpenerContext {
  deps: ChatOpenerDeps;
  startOpen: ReturnType<typeof latestCalls>;
  openingChatId: string | undefined;
}

export function createChatOpener(deps: ChatOpenerDeps): ChatOpener {
  const ctx: OpenerContext = { deps, startOpen: latestCalls(), openingChatId: undefined };
  return {
    open: (chatId) => openChat(ctx, chatId),
    openFallback: async () => {
      const newest = deps.state.chats[0];
      const chat = newest ?? (await deps.sidebar.createChat());
      await openChat(ctx, chat.id);
    },
  };
}

async function openChat(ctx: OpenerContext, chatId: string): Promise<void> {
  const { deps } = ctx;
  const { state, store } = deps;
  if (state.currentChat?.id === chatId) {
    // Another click on a chat still being set up leaves that open to finish.
    if (ctx.openingChatId !== chatId) ctx.startOpen();
    return;
  }
  const isLatest = ctx.startOpen();
  ctx.openingChatId = chatId;
  deps.turns.stop();
  deps.actions.invalidateUndo();
  const chat = state.chats.find((entry) => entry.id === chatId) ?? (await store.getChat(chatId));
  if (!chat || !isLatest()) return;
  const messages = await store.listMessages(chatId);
  if (!isLatest()) return;
  setCurrentChat(state, chat, messages);
  fillChatModel(deps);
  deps.conversation.reset(messages);
  deps.conversation.setRunning(state.running);
  deps.status.clear();
  deps.refresh();
  await deps.video.restore();
  if (isLatest()) deps.composer.render();
}
