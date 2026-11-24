import { isAbortError, orWhenAborted } from "../../abort";
import type { ImageCleanup } from "../../app/imageCleanup";
import { pictureModel } from "../../app/lookingConnection";
import { sendBlocker } from "../../app/sendBlocker";
import type { Turns } from "../../app/turns";
import { downscaleUpload, type ScaledImage } from "../../attachments/images";
import {
  cachedAudioCoverage,
  loadAudio,
  onAudioChanged,
  settingsLabels,
} from "../../audio/videoAudio";
import { pinsExceedCap } from "../../chat/imageSelection";
import { chatModelId, currentModel, resolveModel } from "../../chat/models";
import { lookingModelId } from "../../chat/seen";
import { effortFor, roundsFor, withEffort } from "../../chat/thoroughness";
import type { AppElements } from "../../dom";
import {
  addPending,
  clearPending,
  currentPending,
  overviewFor,
  pendingFor,
  pendingImages,
  pendingHolder,
  pendingVideo,
  removePending,
  removePendingVideo,
  setPendingPinned,
  shownVideo,
  updateChat,
  type AppState,
  type PendingAttachment,
} from "../../state";
import { errorText, plural } from "../../text";
import type {
  AudioCoverage,
  ChatMessage,
  ChatSettings,
  ChatStore,
  ImageRef,
  ModelInfo,
  Thoroughness,
  UserMessage,
  VideoAttachment,
} from "../../types";
import { resolveSheetResolution } from "../../video/resolution";
import { iconButton, pinToggle } from "../shared/buttons";
import { attachMenu } from "../shared/menu";
import type { StatusLine } from "../shared/status";
import { overviewText, videoSummary } from "../video/overviewText";
import type { VideoPanel } from "../video/videoPanel";

const MAX_INPUT_HEIGHT_PX = 240;
const AUDIO_KEY = "vid2grid-chat-audio";
const AUDIO_TITLE =
  "Lets the model read what is heard in the video (speech and sounds), analysed on this computer";
const AUDIO_NEEDS_VIDEO = "Attach a video to let the model hear it";
const OVERVIEW_EXPLAINED =
  "Sent with your message. Remove it and the model starts blind and must call look itself.";
const THOROUGHNESS: readonly Thoroughness[] = ["normal", "thorough", "exhaustive"];
const THOROUGHNESS_HINTS: Record<Thoroughness, (rounds: number) => string> = {
  normal: (rounds) => `Up to ${plural(rounds, "look")}`,
  thorough: (rounds) => `Up to ${plural(rounds, "look")}, stops once confident`,
  exhaustive: (rounds) => `Up to ${plural(rounds, "look")}, most thorough and costly`,
};
const MENU_ITEM = '[role="menuitemradio"]';
const ATTACH_PICKER_TYPES = [
  {
    description: "Videos and images",
    accept: {
      "video/*": [".mp4", ".webm", ".mov", ".mkv", ".m4v"],
      "image/*": [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"],
    },
  },
];

export interface PickedFile {
  file: File;
  handle?: FileSystemFileHandle;
}

export interface Composer {
  render(): void;
  addImages(files: readonly File[]): Promise<void>;
  updateProgress(): void;
  focus(): void;
  // Puts text at the start of the message, keeping anything already typed after it.
  prefill(text: string): void;
  stop(): void;
  // True while the latest round streams reasoning and no answer text yet, so Answer now can show.
  setThinking(thinking: boolean): void;
  // What has been heard so far when audio is on for the next message, otherwise undefined.
  audioCoverage(): AudioCoverage | undefined;
  // The toggle as the user left it, whether or not a video is attached to hear.
  audioWanted(): boolean;
}

export interface ComposerDeps {
  store: ChatStore;
  status: StatusLine;
  video: Pick<
    VideoPanel,
    "overviewRendering" | "whenOverviewReady" | "view" | "pendingView" | "commit"
  >;
  turns: Pick<Turns, "run" | "stop" | "answerNow">;
  images: Pick<ImageCleanup, "release">;
  // A timestamp check runs beside the turn, so Stop ends it too.
  stopChecks(): void;
  onFiles(files: PickedFile[]): void;
  onPendingChanged(): void;
  // The pending video once its overview is ready, or undefined, whenever either may have changed.
  onReady(video: VideoAttachment | undefined): void;
  onAudioChanged?: () => void;
  // After a thoroughness or reasoning pick is saved, so the Model tab shows the same level.
  onSettingsChanged?: () => void;
  downscale?: typeof downscaleUpload;
  now?: () => number;
  newId?: () => string;
  storage?: Storage;
}

interface ComposerContext {
  els: AppElements["composer"];
  state: AppState;
  deps: ComposerDeps;
  reasoningItemsKey: string;
  thinking: boolean;
  audio: boolean;
  loadedAudioKey: string | undefined;
  pendingUrls: string[];
  pendingRender: number;
}

function storedAudioOn(storage: Storage = localStorage): boolean {
  return storage.getItem(AUDIO_KEY) === "on";
}

export function initComposer(
  els: Pick<AppElements, "composer">,
  state: AppState,
  deps: ComposerDeps,
): Composer {
  const ctx: ComposerContext = {
    els: els.composer,
    state,
    deps,
    reasoningItemsKey: "",
    thinking: false,
    audio: storedAudioOn(deps.storage),
    loadedAudioKey: undefined,
    pendingUrls: [],
    pendingRender: 0,
  };
  listen(ctx);
  listenForAudio(ctx);
  const render = () => {
    renderControls(ctx);
    renderPending(ctx);
    if (ctx.loadedAudioKey !== audioVideoKey(ctx)) loadHeard(ctx);
  };
  render();
  return {
    render,
    addImages: (files) => addImages(ctx, files),
    updateProgress: () => updateProgress(ctx),
    focus: () => ctx.els.messageInput.focus(),
    prefill: (text) => prefill(ctx, text),
    stop: () => stop(ctx),
    setThinking: (thinking) => {
      ctx.thinking = thinking;
      renderControls(ctx);
    },
    audioCoverage: () => audioCoverage(ctx),
    audioWanted: () => ctx.audio,
  };
}

function audioVideoKey(ctx: ComposerContext): string | undefined {
  const chat = ctx.state.currentChat;
  return chat ? shownVideo(ctx.state, chat.id)?.fileKey : undefined;
}

function audioOn(ctx: ComposerContext): boolean {
  return ctx.audio && audioVideoKey(ctx) !== undefined;
}

function audioCoverage(ctx: ComposerContext): AudioCoverage | undefined {
  const fileKey = audioVideoKey(ctx);
  if (!ctx.audio || fileKey === undefined) return undefined;
  return cachedAudioCoverage(fileKey, settingsLabels(ctx.state.settings));
}

function listenForAudio(ctx: ComposerContext): void {
  onAudioChanged((audio) => {
    if (audioOn(ctx) && audio.fileKey === audioVideoKey(ctx)) ctx.deps.onAudioChanged?.();
  });
}

// Audio that cannot be read counts as not analysed yet, as it does for the turn itself.
function loadHeard(ctx: ComposerContext): void {
  const fileKey = audioVideoKey(ctx);
  ctx.loadedAudioKey = fileKey;
  if (fileKey === undefined || !ctx.audio) return;
  void loadAudio(ctx.deps.store, fileKey).catch(() => undefined);
}

function toggleAudio(ctx: ComposerContext): void {
  ctx.audio = !ctx.audio;
  (ctx.deps.storage ?? localStorage).setItem(AUDIO_KEY, ctx.audio ? "on" : "off");
  renderControls(ctx);
  ctx.deps.onAudioChanged?.();
  loadHeard(ctx);
}

function stop(ctx: ComposerContext): void {
  ctx.deps.turns.stop();
  ctx.deps.stopChecks();
}

// The button hides once pressed, so focus moves on rather than dropping to the page.
function answerNow(ctx: ComposerContext): void {
  const { answerNowButton, sendButton, messageInput } = ctx.els;
  const hadFocus = document.activeElement === answerNowButton;
  ctx.thinking = false;
  ctx.deps.turns.answerNow();
  renderControls(ctx);
  if (!hadFocus) return;
  if (ctx.state.running && !sendButton.disabled) sendButton.focus();
  else messageInput.focus();
}

function listen(ctx: ComposerContext): void {
  const { form, messageInput, attachButton, attachInput, audioToggle, answerNowButton } = ctx.els;
  messageInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit(ctx);
  });
  messageInput.addEventListener("input", () => fitInput(messageInput));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (ctx.state.running) stop(ctx);
    else void submit(ctx);
  });
  answerNowButton.addEventListener("click", () => answerNow(ctx));
  audioToggle.addEventListener("click", () => toggleAudio(ctx));
  attachButton.addEventListener("click", () => void pickFiles(ctx));
  attachInput.addEventListener("change", () => {
    const files = [...(attachInput.files ?? [])].map((file) => ({ file }));
    attachInput.value = "";
    if (files.length > 0) ctx.deps.onFiles(files);
  });
  listenToMenus(ctx);
}

function listenToMenus(ctx: ComposerContext): void {
  const { thoroughnessControl, thoroughnessButton, thoroughnessMenu } = ctx.els;
  const { reasoningControl, reasoningButton, reasoningMenu } = ctx.els;
  attachMenu({
    control: thoroughnessControl,
    button: thoroughnessButton,
    list: thoroughnessMenu,
    items: MENU_ITEM,
    onPick: (item) => {
      const tier = THOROUGHNESS.find((known) => known === item.dataset["value"]) ?? "normal";
      saveSettings(ctx, (settings) => withThoroughness(settings, tier));
    },
  });
  attachMenu({
    control: reasoningControl,
    button: reasoningButton,
    list: reasoningMenu,
    items: MENU_ITEM,
    onPick: (item) =>
      saveSettings(ctx, (settings) => withEffort(settings, item.dataset["value"] ?? "")),
  });
}

function withThoroughness(settings: ChatSettings, tier: Thoroughness): ChatSettings {
  const next = { ...settings };
  if (tier === "normal") delete next.thoroughness;
  else next.thoroughness = tier;
  return next;
}

// The chat is updated in state before the save, so the controls show the pick at once.
function saveSettings(
  ctx: ComposerContext,
  change: (settings: ChatSettings) => ChatSettings,
): void {
  const chatId = ctx.state.currentChat?.id;
  if (chatId === undefined) return;
  updateChat(ctx.state, ctx.deps.store, chatId, (chat) => ({
    ...chat,
    settings: change(chat.settings),
  }))
    .then(() => ctx.deps.onSettingsChanged?.())
    .catch((error: unknown) => {
      ctx.deps.status.show(`Could not save the chat settings: ${errorText(error)}`, "error");
    });
  renderControls(ctx);
}

function chatThoroughness(ctx: ComposerContext): Thoroughness {
  return ctx.state.currentChat?.settings.thoroughness ?? "normal";
}

// A level the chat's model does not offer counts as unset, as when the model changes.
function chatEffort(ctx: ComposerContext): string {
  const efforts = currentModel(ctx.state)?.reasoningEffortOptions ?? [];
  const effort = ctx.state.currentChat?.settings.reasoningEffort ?? "";
  return efforts.includes(effort) ? effort : "";
}

// The picker hands back a file handle too, so the video can be reopened in a later session.
async function pickFiles(ctx: ComposerContext): Promise<void> {
  if (!window.showOpenFilePicker) {
    ctx.els.attachInput.click();
    return;
  }
  try {
    const handles = await window.showOpenFilePicker({ multiple: true, types: ATTACH_PICKER_TYPES });
    const files = await Promise.all(
      handles.map(async (handle) => ({ file: await handle.getFile(), handle })),
    );
    if (files.length > 0) ctx.deps.onFiles(files);
  } catch (error) {
    if (!isAbortError(error)) {
      ctx.deps.status.show(`Could not open the files: ${errorText(error)}`, "error");
    }
  }
}

function prefill(ctx: ComposerContext, text: string): void {
  const input = ctx.els.messageInput;
  const rest = input.value.trimStart();
  const joiner = rest === "" || text.endsWith(" ") ? "" : " ";
  input.value = `${text}${joiner}${rest}`;
  input.focus();
  input.setSelectionRange(text.length, text.length);
  fitInput(input);
}

function fitInput(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
}

function renderControls(ctx: ComposerContext): void {
  const { sendButton, hint } = ctx.els;
  const { running } = ctx.state;
  const blocker = sendBlocker(ctx.state);
  sendButton.textContent = running ? "Stop" : "Send";
  sendButton.classList.toggle("is-stop", running);
  sendButton.disabled = !running && blocker !== null;
  ctx.els.answerNowButton.hidden = !(running && ctx.thinking);
  renderThoroughness(ctx);
  renderReasoning(ctx);
  renderAudioToggle(ctx);
  hint.textContent = blocker ?? "";
  hint.hidden = blocker === null;
}

function checkItem(list: HTMLElement, value: string): void {
  for (const item of list.querySelectorAll<HTMLElement>(MENU_ITEM)) {
    item.setAttribute("aria-checked", String(item.dataset["value"] === value));
  }
}

function thoroughnessName(ctx: ComposerContext, tier: Thoroughness): string {
  const item = ctx.els.thoroughnessMenu.querySelector(`[data-value="${tier}"]`);
  return item?.querySelector(".composer-menu-name")?.textContent ?? tier;
}

function renderThoroughness(ctx: ComposerContext): void {
  const { thoroughnessButton, thoroughnessLabel, thoroughnessMenu } = ctx.els;
  const maxRounds = ctx.state.currentChat?.settings.maxRounds;
  for (const item of thoroughnessMenu.querySelectorAll<HTMLElement>(MENU_ITEM)) {
    const tier = THOROUGHNESS.find((known) => known === item.dataset["value"]);
    const hint = item.querySelector(".composer-menu-hint");
    if (tier && hint) hint.textContent = THOROUGHNESS_HINTS[tier](roundsFor(tier, maxRounds));
  }
  const tier = chatThoroughness(ctx);
  checkItem(thoroughnessMenu, tier);
  const name = thoroughnessName(ctx, tier);
  thoroughnessLabel.textContent = name;
  thoroughnessButton.setAttribute("aria-label", `Thoroughness: ${name}`);
  thoroughnessButton.classList.toggle("is-on", tier !== "normal");
}

function renderReasoning(ctx: ComposerContext): void {
  const { reasoningControl, reasoningButton, reasoningLabel, reasoningMenu } = ctx.els;
  const model = currentModel(ctx.state);
  const efforts = model?.reasoningEffortOptions ?? [];
  reasoningControl.hidden = efforts.length === 0;
  const effort = chatEffort(ctx);
  if (model && efforts.length > 0) renderReasoningItems(ctx, model);
  checkItem(reasoningMenu, effort);
  reasoningLabel.textContent = effort === "" ? "Reasoning" : `Reasoning: ${effort}`;
  reasoningButton.classList.toggle("is-on", effort !== "");
}

// Built again only when the choices change, so an open menu keeps its focus.
function renderReasoningItems(ctx: ComposerContext, model: ModelInfo): void {
  const tierEffort = effortFor(chatThoroughness(ctx), model, undefined, undefined);
  const level = tierEffort ?? model.defaultReasoningEffort;
  const name = level === undefined ? "Default" : `Default (${level})`;
  const hint = defaultEffortSource(ctx, tierEffort);
  const key = JSON.stringify([model.reasoningEffortOptions, name, hint]);
  if (key === ctx.reasoningItemsKey) return;
  ctx.reasoningItemsKey = key;
  ctx.els.reasoningMenu.replaceChildren(
    menuItem("", name, hint),
    ...model.reasoningEffortOptions.map((effort) => menuItem(effort, effort, "")),
  );
}

function defaultEffortSource(ctx: ComposerContext, tierEffort: string | undefined): string {
  if (tierEffort === undefined) return "The model's own default";
  return `Set by ${thoroughnessName(ctx, chatThoroughness(ctx))}`;
}

function menuItem(value: string, name: string, hint: string): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "composer-menu-item";
  item.setAttribute("role", "menuitemradio");
  item.tabIndex = -1;
  item.dataset["value"] = value;
  const label = document.createElement("span");
  label.className = "composer-menu-name";
  label.textContent = name;
  item.append(label);
  if (hint !== "") {
    const detail = document.createElement("span");
    detail.className = "composer-menu-hint";
    detail.textContent = hint;
    item.append(detail);
  }
  return item;
}

function renderAudioToggle(ctx: ComposerContext): void {
  const { audioToggle } = ctx.els;
  const on = audioOn(ctx);
  audioToggle.disabled = audioVideoKey(ctx) === undefined;
  audioToggle.title = audioToggle.disabled ? AUDIO_NEEDS_VIDEO : AUDIO_TITLE;
  audioToggle.setAttribute("aria-pressed", String(on));
  audioToggle.classList.toggle("is-on", on);
}

function renderPending(ctx: ComposerContext): void {
  ctx.pendingUrls.forEach((url) => URL.revokeObjectURL(url));
  ctx.pendingUrls = [];
  ctx.pendingRender += 1;
  const { pendingList } = ctx.els;
  const pending = currentPending(ctx.state);
  pendingList.replaceChildren(
    ...pending.map((attachment, index) => pendingItem(ctx, attachment, index)),
  );
  pendingList.hidden = pending.length === 0;
  ctx.deps.onReady(readyVideo(ctx));
}

function readyVideo(ctx: ComposerContext): VideoAttachment | undefined {
  const chat = ctx.state.currentChat;
  const video = pendingVideo(currentPending(ctx.state));
  if (!chat || !video) return undefined;
  return overviewFor(ctx.state, chat.id)?.kind === "ready" ? video : undefined;
}

function pendingChanged(ctx: ComposerContext): void {
  renderPending(ctx);
  // What is attached can be what a chat's model cannot be sent.
  renderControls(ctx);
  ctx.deps.onPendingChanged();
}

function pendingItem(
  ctx: ComposerContext,
  attachment: PendingAttachment,
  index: number,
): HTMLLIElement {
  const chatId = ctx.state.currentChat?.id ?? "";
  if (attachment.kind === "video") return videoItem(ctx, attachment.video);
  const item = document.createElement("li");
  item.className = `pending-item pending-${attachment.kind}`;
  const first = attachment.kind === "image" ? attachment.ref : attachment.refs[0];
  if (first) item.append(pendingThumb(ctx, first));
  const label = document.createElement("span");
  label.className = "pending-label";
  label.textContent =
    attachment.kind === "image"
      ? attachment.ref.source.name
      : `Overview: ${attachment.refs.length} sheet${attachment.refs.length === 1 ? "" : "s"}`;
  item.append(label);
  if (attachment.kind === "overview") {
    const explained = document.createElement("span");
    explained.className = "pending-detail";
    explained.textContent = OVERVIEW_EXPLAINED;
    item.append(explained);
  }
  if (attachment.kind === "image") {
    const pinned = attachment.ref.pinned;
    item.append(
      pinToggle(pinned, () => {
        setPendingPinned(ctx.state, chatId, index, !pinned);
        pendingChanged(ctx);
      }),
    );
  }
  item.append(
    removeButton(ctx, label.textContent, (chatId) => removePending(ctx.state, chatId, index)),
  );
  return item;
}

function removeButton(
  ctx: ComposerContext,
  what: string,
  remove: (chatId: string) => readonly PendingAttachment[],
): HTMLButtonElement {
  return iconButton("pending-remove", `Remove ${what}`, "×", () => {
    const dropped = remove(ctx.state.currentChat?.id ?? "");
    pendingChanged(ctx);
    void ctx.deps.images.release(pendingHolder(dropped));
  });
}

function progressText(ctx: ComposerContext): string {
  const chat = ctx.state.currentChat;
  return chat ? overviewText(overviewFor(ctx.state, chat.id)) : "";
}

function videoItem(ctx: ComposerContext, video: VideoAttachment): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "pending-item pending-video";
  const pending = ctx.deps.video.pendingView();
  const view = pending.video?.fileKey === video.fileKey ? pending : ctx.deps.video.view();
  if (view.url && view.video?.fileKey === video.fileKey) {
    const thumb = document.createElement("video");
    thumb.className = "pending-thumb";
    thumb.muted = true;
    thumb.preload = "metadata";
    thumb.src = view.url;
    item.append(thumb);
  }
  const label = document.createElement("span");
  label.className = "pending-label";
  label.textContent = videoSummary(video);
  const progress = document.createElement("span");
  progress.className = "pending-progress";
  progress.textContent = progressText(ctx);
  item.append(
    label,
    progress,
    removeButton(ctx, label.textContent, (chatId) => removePendingVideo(ctx.state, chatId)),
  );
  return item;
}

// Overview progress ticks often, so only the text changes and the video thumbnail is left alone.
function updateProgress(ctx: ComposerContext): void {
  const progress = ctx.els.pendingList.querySelector(".pending-progress");
  if (progress) progress.textContent = progressText(ctx);
  ctx.deps.onReady(readyVideo(ctx));
}

function pendingThumb(ctx: ComposerContext, ref: ImageRef): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "pending-thumb";
  img.alt = "";
  const token = ctx.pendingRender;
  ctx.deps.store
    .getImage(ref.id)
    .then((blob) => {
      if (blob === undefined || token !== ctx.pendingRender) return;
      const url = URL.createObjectURL(blob);
      ctx.pendingUrls.push(url);
      img.src = url;
    })
    .catch(() => {
      img.alt = "Image not found";
    });
  return img;
}

// The picture is still worth attaching without its larger copy, so a failed save is not an error.
async function storeOriginal(
  store: ChatStore,
  original: ScaledImage | undefined,
): Promise<string | undefined> {
  if (original === undefined) return undefined;
  try {
    return await store.putImage(original.blob);
  } catch {
    return undefined;
  }
}

async function addImages(ctx: ComposerContext, files: readonly File[]): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat) return;
  const downscale = ctx.deps.downscale ?? downscaleUpload;
  for (const file of files) {
    try {
      const own = resolveModel(ctx.state, chatModelId(ctx.state, chat));
      const model = pictureModel(ctx.state, chat, own);
      const { px } = resolveSheetResolution(chat.settings.sheetResolution, model);
      const { sent, original } = await downscale(file, px);
      const id = await ctx.deps.store.putImage(sent.blob);
      const originalId = await storeOriginal(ctx.deps.store, original);
      addPending(ctx.state, chat.id, {
        kind: "image",
        ref: {
          id,
          source: {
            kind: "upload",
            name: file.name,
            ...(originalId !== undefined && { originalId }),
          },
          pinned: false,
        },
      });
      if (ctx.state.currentChat?.id === chat.id) pendingChanged(ctx);
    } catch (error) {
      ctx.deps.status.show(`Could not read ${file.name}: ${errorText(error)}`, "error");
    }
  }
}

function hasContent(ctx: ComposerContext, chatId: string): boolean {
  const images = pendingImages(pendingFor(ctx.state, chatId));
  return ctx.els.messageInput.value.trim() !== "" || images.length > 0;
}

async function submit(ctx: ComposerContext): Promise<void> {
  const chat = ctx.state.currentChat;
  if (ctx.state.running || !chat) return;
  const blocker = sendBlocker(ctx.state);
  if (blocker !== null) {
    ctx.deps.status.show(blocker, "error");
    return;
  }
  const waitsForOverview = ctx.deps.video.overviewRendering();
  if (!waitsForOverview && !hasContent(ctx, chat.id)) return;
  await ctx.deps.turns.run(async (signal) => {
    if (waitsForOverview && !(await waitForOverview(ctx, signal))) return undefined;
    const taken = readMessage(ctx, chat.id);
    if (!taken) return undefined;
    // Saved before anything is cleared, so a failure leaves the message as it was.
    if (taken.message.video) await ctx.deps.video.commit(chat.id, taken.message.video);
    const cleared = clearTaken(ctx, chat.id, taken);
    return {
      message: taken.message,
      onUnsaved: () => putBack(ctx, chat.id, taken, cleared),
    };
  });
}

async function waitForOverview(ctx: ComposerContext, signal: AbortSignal): Promise<boolean> {
  ctx.deps.status.show("Finishing overview…");
  await orWhenAborted(ctx.deps.video.whenOverviewReady(), signal, undefined);
  ctx.deps.status.clear();
  return !signal.aborted;
}

function takeInput(
  ctx: ComposerContext,
  chatId: string,
): { text: string; images: ImageRef[]; video: VideoAttachment | undefined } {
  const pending = pendingFor(ctx.state, chatId);
  return {
    text: ctx.els.messageInput.value.trim(),
    images: pendingImages(pending),
    video: pendingVideo(pending),
  };
}

interface TakenMessage {
  message: UserMessage;
  pending: readonly PendingAttachment[];
}

// Read once the overview is done, so text typed while it finished goes out too.
function readMessage(ctx: ComposerContext, chatId: string): TakenMessage | undefined {
  const { state, deps } = ctx;
  const model = currentModel(state);
  if (state.currentChat?.id !== chatId || model === null) return undefined;
  const { text, images, video } = takeInput(ctx, chatId);
  if (text === "" && images.length === 0) {
    deps.status.show(
      "Nothing was sent: the overview did not finish and there is no text or image.",
    );
    return undefined;
  }
  const thoroughness = chatThoroughness(ctx);
  const effort = chatEffort(ctx);
  const audio = audioOn(ctx);
  const message: UserMessage = {
    id: (deps.newId ?? (() => crypto.randomUUID()))(),
    createdAt: (deps.now ?? Date.now)(),
    role: "user",
    text,
    images,
    ...(video ? { video } : {}),
    ...(thoroughness === "normal" ? {} : { thoroughness }),
    ...(effort === "" ? {} : { reasoningEffort: effort }),
    ...(audio ? { audio: true } : {}),
  };
  const messages: ChatMessage[] = [...state.messages, message];
  const looking = lookingModelId(state.currentChat) !== undefined;
  if (!looking && pinsExceedCap(messages, model.maxImages)) {
    deps.status.show(
      `Pinned images exceed the model's limit of ${model.maxImages}. Unpin some to send.`,
      "error",
    );
    return undefined;
  }
  return { message, pending: pendingFor(state, chatId) };
}

// Only what was sent is cleared: input typed or items added since stay for the next message.
// Returns whether the text was cleared, rather than left as it had changed since.
function clearTaken(ctx: ComposerContext, chatId: string, taken: TakenMessage): boolean {
  const { messageInput } = ctx.els;
  const unchanged = messageInput.value.trim() === taken.message.text;
  if (unchanged) {
    messageInput.value = "";
    fitInput(messageInput);
  }
  const left = pendingFor(ctx.state, chatId).filter((item) => !taken.pending.includes(item));
  clearPending(ctx.state, chatId);
  for (const item of left) addPending(ctx.state, chatId, item);
  pendingChanged(ctx);
  renderControls(ctx);
  ctx.deps.status.clear();
  return unchanged;
}

// Before what was typed or added since; a video added since stays in place of the one taken.
function putBack(
  ctx: ComposerContext,
  chatId: string,
  { message, pending }: TakenMessage,
  cleared: boolean,
): void {
  const { messageInput } = ctx.els;
  if (cleared || !messageInput.value.trimStart().startsWith(message.text)) {
    const texts = [message.text, messageInput.value];
    messageInput.value = texts.filter((text) => text.trim() !== "").join("\n");
    fitInput(messageInput);
  }
  const added = pendingFor(ctx.state, chatId);
  const replaced = pendingVideo(added) !== undefined;
  const back = replaced ? pending.filter(({ kind }) => kind === "image") : pending;
  clearPending(ctx.state, chatId);
  for (const item of [...back, ...added]) addPending(ctx.state, chatId, item);
  pendingChanged(ctx);
  renderControls(ctx);
}
