import { vi } from "vitest";
import type { ImageStore } from "../../src/types";
import type { ConversationDeps } from "../../src/ui/conversation/conversation";

export function conversationDeps(
  store: ImageStore,
  overrides: Partial<ConversationDeps> = {},
): ConversationDeps {
  return {
    store,
    onSeek: vi.fn(),
    onCue: vi.fn(),
    onMessageChanged: vi.fn(),
    onEdit: vi.fn(),
    onReplay: vi.fn(),
    onKeepGoing: vi.fn(),
    onBranch: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onPopOut: vi.fn(),
    onReattach: vi.fn(),
    onRemoveVideo: vi.fn(),
    removeBlocker: () => undefined,
    removedVideos: () => [],
    isRunning: () => false,
    videoView: () => ({ video: undefined, url: null }),
    showThinking: () => false,
    onPrefill: vi.fn(),
    focusComposer: vi.fn(),
    models: () => [],
    chatModelId: () => "m",
    pickerSettings: {
      privateOnly: () => false,
      setPrivateOnly: vi.fn(),
      favourites: () => [],
      setFavourites: vi.fn(),
    },
    onSwitchReply: vi.fn(),
    onCompare: vi.fn(),
    onVerify: vi.fn(() => Promise.resolve(undefined)),
    onMessagesChanged: vi.fn(),
    ...overrides,
  };
}
