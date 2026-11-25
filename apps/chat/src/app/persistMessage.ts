import { withCurrentSeen } from "../chat/seen";
import { upsertMessage, type AppState } from "../state";
import type { ChatMessage, ChatStore } from "../types";

export interface PersistMessageDeps {
  state: AppState;
  store: ChatStore;
  onChanged(): void;
}

export async function persistMessage(
  deps: PersistMessageDeps,
  message: ChatMessage,
): Promise<void> {
  const { state, store } = deps;
  const chat = state.currentChat;
  if (!chat) return;
  const updated = withCurrentSeen(message, state.messages);
  upsertMessage(state, updated);
  deps.onChanged();
  await store.putMessage(chat.id, updated);
}
