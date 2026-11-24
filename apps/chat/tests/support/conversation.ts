import { vi } from "vitest";
import { createMemoryStore } from "../../src/chat/store";
import type { AppElements } from "../../src/dom";
import type {
  AssistantMessage,
  ChatMessage,
  ChatStore,
  RemovedVideo,
  UserMessage,
  VideoAttachment,
} from "../../src/types";
import type { ConversationDeps } from "../../src/ui/conversation/conversation";
import type { VideoView } from "../../src/ui/video/context";
import { conversationDeps } from "./conversationDeps";
import { assistant, model, sheet, tool, user } from "./factories";
import { mountPage } from "./page";

type Verify = (
  message: AssistantMessage,
  signal: AbortSignal,
) => Promise<AssistantMessage | undefined>;

export let els: AppElements;
export let store: ChatStore;
export let spies: ReturnType<typeof makeSpies>;
let view: VideoView;
let showThinking: boolean;
let running: boolean;
let verifying: Verify;

export const MODELS = [
  model("chat-model", { name: "Chat Model", pricing: { inputPerMTok: 1, outputPerMTok: 2 } }),
  model("other-model", { name: "Other Model" }),
];

export const beach: VideoAttachment = {
  name: "beach.mp4",
  fileKey: "beach-key",
  durationSeconds: 90,
  width: 640,
  height: 360,
};

function makeSpies() {
  return {
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
    removeBlocker: vi.fn((): string | undefined => undefined),
    removedVideos: vi.fn((): readonly RemovedVideo[] => []),
    onPrefill: vi.fn(),
    focusComposer: vi.fn(),
    onSwitchReply: vi.fn(),
    onCompare: vi.fn(),
    onMessagesChanged: vi.fn(),
  };
}

export function setView(next: VideoView): void {
  view = next;
}

export function setShowThinking(next: boolean): void {
  showThinking = next;
}

export function setRunning(next: boolean): void {
  running = next;
}

export function setVerifying(next: Verify): void {
  verifying = next;
}

export function deps(): ConversationDeps {
  return conversationDeps(store, {
    ...spies,
    isRunning: () => running,
    videoView: () => view,
    showThinking: () => showThinking,
    models: () => MODELS,
    chatModelId: () => "chat-model",
    onVerify: (message, signal) => verifying(message, signal),
  });
}

export function look(id: string, start: number, end: number) {
  return { id, name: "look", arguments: JSON.stringify({ start, end }) };
}

export function list(): HTMLElement {
  return els.conversation.list;
}

export function buttonsLabelled(label: string): HTMLButtonElement[] {
  return [...list().querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.getAttribute("aria-label") === label || button.textContent === label,
  );
}

export function resetConversation(): void {
  els = mountPage();
  store = createMemoryStore();
  view = { video: beach, url: "blob:beach" };
  showThinking = false;
  running = false;
  spies = makeSpies();
  localStorage.clear();
  verifying = () => Promise.resolve(undefined);
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:image-${++next}`);
  URL.revokeObjectURL = vi.fn();
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  Element.prototype.setPointerCapture = vi.fn();
}

export function investigation(): ChatMessage[] {
  return [
    user("u1", "What happens?"),
    assistant("a1", "Let me look.", {
      reasoning: "Scan first.",
      toolCalls: [look("c1", 36, 39), { id: "c2", name: "frames", arguments: '{"times":[40,41]}' }],
    }),
    tool("t1", "c1", [sheet("s1", 36, 39)]),
    tool("t2", "c2", [sheet("s2", 40, 41)]),
    assistant("a2", "", {
      toolCalls: [{ id: "c3", name: "note", arguments: '{"t":40,"text":"x"}' }],
    }),
    tool(
      "t3",
      "c3",
      [],
      "Noted at 0:40. (Round 2 of 8. Batch several calls into one round when you can.)",
    ),
    assistant("a3", "She waves at [0:40].", { reasoning: "Done." }),
  ];
}

export function openActivity(): HTMLDetailsElement {
  const details = list().querySelector<HTMLDetailsElement>(".activity details");
  if (!details) throw new Error("No activity row");
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
  return details;
}

export function exchanges(): ChatMessage[] {
  return [
    user("u1", "One"),
    assistant("a1", "First"),
    user("u2", "Two"),
    assistant("a2", "Second"),
    user("u3", "Three"),
    assistant("a3", "Third"),
  ];
}

export function userWithVideo(video: VideoAttachment): UserMessage {
  return user("u1", "Look", { video });
}
