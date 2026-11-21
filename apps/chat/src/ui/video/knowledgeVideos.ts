import type { AppElements } from "../../dom";
import type { AppState } from "../../state";
import type { ChatMessage, VideoAttachment } from "../../types";
import { olderVideos } from "../conversation/messageVideo";

export interface ChatVideo {
  video: VideoAttachment;
  current: boolean;
}

export interface VideoPicker {
  shown(): ChatVideo | undefined;
  showCurrent(): void;
  render(): void;
}

export interface VideoPickerDeps {
  onPick(): void;
}

// A pick holds only while the same chat keeps the same attached video.
interface VideoPick {
  chatId: string;
  currentKey: string | undefined;
  fileKey: string;
}

interface PickerContext {
  els: AppElements["knowledge"];
  state: AppState;
  deps: VideoPickerDeps;
  pick: VideoPick | null;
}

export function chatVideos(
  current: VideoAttachment | undefined,
  messages: readonly ChatMessage[],
): ChatVideo[] {
  const older = olderVideos(messages, current).map((video) => ({ video, current: false }));
  return current ? [{ video: current, current: true }, ...older] : older;
}

export function initVideoPicker(
  els: Pick<AppElements, "knowledge">,
  state: AppState,
  deps: VideoPickerDeps,
): VideoPicker {
  const ctx: PickerContext = { els: els.knowledge, state, deps, pick: null };
  ctx.els.videoSelect.addEventListener("change", () => {
    const chat = state.currentChat;
    if (!chat) return;
    ctx.pick = {
      chatId: chat.id,
      currentKey: chat.video?.fileKey,
      fileKey: ctx.els.videoSelect.value,
    };
    render(ctx);
    deps.onPick();
  });
  render(ctx);
  return {
    shown: () => shown(ctx),
    showCurrent: () => {
      ctx.pick = null;
      render(ctx);
      deps.onPick();
    },
    render: () => render(ctx),
  };
}

function videos(ctx: PickerContext): ChatVideo[] {
  return chatVideos(ctx.state.currentChat?.video, ctx.state.messages);
}

function shown(ctx: PickerContext): ChatVideo | undefined {
  const all = videos(ctx);
  const chat = ctx.state.currentChat;
  const pick = ctx.pick;
  const stillValid = pick?.chatId === chat?.id && pick?.currentKey === chat?.video?.fileKey;
  const picked = stillValid
    ? all.find((entry) => entry.video.fileKey === pick?.fileKey)
    : undefined;
  return picked ?? all[0];
}

function option({ video, current }: ChatVideo): HTMLOptionElement {
  return new Option(current ? `${video.name} (current)` : video.name, video.fileKey);
}

function render(ctx: PickerContext): void {
  const { videoField, videoSelect, videoNote } = ctx.els;
  const all = videos(ctx);
  const picked = shown(ctx);
  videoField.hidden = all.length === 0;
  videoSelect.replaceChildren(...all.map(option));
  videoSelect.value = picked?.video.fileKey ?? "";
  videoSelect.disabled = all.length < 2;
  videoNote.hidden = picked === undefined || picked.current;
}
