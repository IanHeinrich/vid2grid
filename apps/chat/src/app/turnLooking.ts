import type { TurnLooking } from "../chat/agentLoop";
import type { Looker } from "../chat/looking";
import { describedIds, withoutSwipeMarks, withSeen } from "../chat/seen";
import { upsertMessage, type AppState } from "../state";
import type { Chat, ChatMessage, ChatStore, SeenNote, StreamChat } from "../types";
import { lookingConnection } from "./lookingConnection";

export interface TurnLookingContext {
  state: AppState;
  deps: { store: ChatStore; streamChat: StreamChat; onMessageSaved(): void };
}

export function turnLooker(
  { state, deps: { store, streamChat } }: TurnLookingContext,
  chat: Chat,
  resolution: number,
): Looker | undefined {
  const connection = lookingConnection(state, chat);
  return connection && { ...connection, streamChat, store, resolution };
}

// known is the turn's own copy of the conversation, kept in step with what is saved.
export function turnLooking(
  ctx: TurnLookingContext,
  chatId: string,
  looker: Looker | undefined,
  known: ChatMessage[],
): { looking?: TurnLooking } {
  if (!looker) return {};
  return {
    looking: {
      ...looker,
      save: async (messageId, seen, gone) => {
        const update = (message: ChatMessage) => withNotes(message, messageId, seen, gone);
        known.splice(0, known.length, ...known.map(update));
        await saveSeen(ctx, chatId, messageId, update);
      },
    },
  };
}

function withNotes(
  message: ChatMessage,
  messageId: string,
  seen: readonly SeenNote[],
  gone: ReadonlySet<string>,
): ChatMessage {
  const own = message.id === messageId ? withSeen(message, seen, gone) : message;
  return withoutSwipeMarks(own, describedIds(seen));
}

// Added to each message as it is now, so a pin changed while it was looked at is kept.
async function saveSeen(
  { state, deps }: TurnLookingContext,
  chatId: string,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): Promise<void> {
  if (!state.chats.some((chat) => chat.id === chatId)) return;
  const shown = state.currentChat?.id === chatId;
  const messages = shown ? state.messages : await deps.store.listMessages(chatId);
  if (!messages.some((message) => message.id === messageId)) return;
  const changed = messages.flatMap((message) => {
    const updated = update(message);
    return updated === message ? [] : [updated];
  });
  if (shown) for (const message of changed) upsertMessage(state, message);
  for (const message of changed) await deps.store.putMessage(chatId, message);
  if (state.currentChat?.id === chatId) deps.onMessageSaved();
}
