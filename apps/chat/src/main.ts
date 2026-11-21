import "./styles/index.css";
import { getBalance, listModels, streamChat } from "./api/client";
import { isVenice } from "./api/venice";
import { classifyFile } from "./attachments/images";
import { currentModel, defaultModelId } from "./chat/models";
import { openChatStore } from "./chat/store";
import { queryElements, type AppElements } from "./dom";
import { latestCalls } from "./latest";
import { loadSettings, type GlobalSettings } from "./settings";
import {
  addPending,
  createAppState,
  setChats,
  setCurrentChat,
  setModels,
  setModelsError,
  updateChat,
  upsertMessage,
  type AppState,
} from "./state";
import { errorText } from "./text";
import type { ChatMessage, ChatStore, ImageRef, ModelInfo, VideoAttachment } from "./types";
import { initBackup } from "./ui/backup";
import { initBalance, type Balance } from "./ui/balance";
import { initCastPanel, type CastPanel } from "./ui/castPanel";
import {
  initChatDrawer,
  initKnowledgeDrawer,
  type ChatDrawer,
  type KnowledgeDrawer,
} from "./ui/chatDrawer";
import { initComposer, type Composer, type ComposerDeps, type PickedFile } from "./ui/composer";
import { initConnectionTest, type ConnectionTest } from "./ui/connectionTest";
import { initConversation, type Conversation, type ConversationDeps } from "./ui/conversation";
import { downloadBlob } from "./ui/download";
import {
  initChatSettings,
  initSettingsDialog,
  type ChatSettingsDeps,
  type ChatSettingsPanel,
  type SettingsDialog,
} from "./ui/settingsDialog";
import { initSidebar, type Sidebar, type SidebarDeps } from "./ui/sidebar";
import {
  initMessageActions,
  type MessageActions,
  type MessageActionsDeps,
} from "./ui/messageActions";
import { initVideoPicker, type VideoPicker } from "./ui/knowledgeVideos";
import { initMemoryPanel, type MemoryPanel } from "./ui/memoryPanel";
import { storedPickerSettings } from "./ui/modelPicker";
import { initSceneLog, type SceneLogPanel } from "./ui/sceneLog";
import { initStudy, type Study, type StudyDeps } from "./ui/study/studyPanel";
import { initShortcuts } from "./ui/shortcuts";
import { initStatus, type StatusLine } from "./ui/status";
import { initToast, type Toast } from "./ui/toast";
import { initTurns, type Turns, type TurnsDeps } from "./ui/turns";
import { initVideoCopies, type VideoCopies } from "./ui/videoCopies";
import { initUsageMeter, type UsageMeter } from "./ui/tokenMeter";
import { initVideoPanel, toolContext, type VideoPanel, type VideoPanelDeps } from "./ui/videoPanel";
import { initWelcome, type Welcome } from "./ui/welcome";

interface DroppedFile {
  file: File;
  handle?: Promise<FileSystemHandle | null> | undefined;
}

interface App {
  state: AppState;
  store: ChatStore;
  status: StatusLine;
  conversation: Conversation;
  video: VideoPanel;
  turns: Turns;
  actions: MessageActions;
  composer: Composer;
  study: Study;
  usage: UsageMeter;
  balance: Balance;
  copies: VideoCopies;
  sidebar: Sidebar;
  chatSettings: ChatSettingsPanel;
  chatDrawer: ChatDrawer;
  knowledge: KnowledgeDrawer;
  videoPicker: VideoPicker;
  sceneLog: SceneLogPanel;
  memory: MemoryPanel;
  cast: CastPanel;
  settingsDialog: SettingsDialog;
  toast: Toast;
  welcome: Welcome;
  connectionTest: ConnectionTest;
  refresh(): void;
}

function surface(app: App, action: string, work: Promise<unknown>): void {
  work.catch((error: unknown) => app.toast.show(`Could not ${action}: ${errorText(error)}`));
}

// The balance line shows its own unavailable state, so a failed refresh stays quiet.
function refreshBalance(app: App): void {
  app.balance.refresh().catch(() => undefined);
}

const confirm = (message: string) => window.confirm(message);

function conversationDeps(app: () => App, store: ChatStore, state: AppState): ConversationDeps {
  return {
    store,
    onSeek: (seconds, video) => app().video.seek(seconds, video),
    onCue: (seconds) => app().video.cue(seconds),
    onMessageChanged: (message) =>
      surface(app(), "save the message", persistMessage(app(), message)),
    onEdit: (message, text) => surface(app(), "edit the message", app().turns.edit(message, text)),
    onReplay: () => surface(app(), "replay", app().turns.replay()),
    onKeepGoing: () => surface(app(), "keep going", app().turns.keepGoing()),
    onBranch: (message) => reportFailure(app(), "branch", app().actions.branch(message)),
    onDelete: (message) => reportFailure(app(), "delete", app().actions.remove(message)),
    onCopy: (message) => surface(app(), "copy the message", app().actions.copy(message)),
    isRunning: () => state.running,
    videoView: () => app().video.view(),
    onPopOut: (seconds) => app().video.openPlayer(seconds),
    onReattach: () => surface(app(), "reattach the video", app().video.reattach()),
    showThinking: () => state.settings.showThinking,
    onPrefill: (text) => app().composer.prefill(text),
    focusComposer: () => app().composer.focus(),
    models: () => state.models,
    chatModelId: () => currentModel(state)?.id,
    pickerSettings: storedPickerSettings(state),
    onSwitchReply: (user, index) =>
      surface(app(), "switch the reply", app().actions.switchReply(user, index)),
    onCompare: (model) => surface(app(), "compare models", app().turns.compare(model)),
    onVerify: (message, signal) => app().actions.verify(message, signal),
    onMessagesChanged: () => app().video.renderCoverage(),
    onThinkingChanged: (thinking) => app().composer.setThinking(thinking),
  };
}

function actionsDeps(
  app: () => App,
  store: ChatStore,
  status: StatusLine,
  toast: Toast,
  state: AppState,
): MessageActionsDeps {
  return {
    store,
    status,
    toast,
    streamChat,
    toolContext: () => toolContext(state, store),
    conversation: { reset: (messages) => app().conversation.reset(messages) },
    onOpen: (chatId) => openChatSafely(app(), chatId),
    onChatsChanged: () => app().sidebar.render(),
    onMessagesChanged: () => renderKnowledge(app()),
  };
}

function reportFailure(app: App, action: string, work: Promise<void>): void {
  work.catch((error: unknown) => {
    app.status.show(`Could not ${action} the message: ${errorText(error)}`, "error");
  });
}

function sidebarDeps(
  app: () => App,
  store: ChatStore,
  status: StatusLine,
  toast: Toast,
): SidebarDeps {
  return {
    store,
    status,
    toast,
    onOpen: (chatId) => openChatSafely(app(), chatId),
    onDeletingCurrent: () => {
      app().turns.stop();
      app().actions.invalidateUndo();
    },
    onDeleted: () => app().study.render(),
    onDeleteFinal: (chat) => {
      if (chat.video) {
        surface(app(), "remove the stored video", app().copies.release(chat.video.fileKey));
      }
    },
    onCurrentDeleted: () => openFallbackSafely(app()),
    onRenamed: () => app().chatSettings.render(),
    onOpenSettings: () => app().settingsDialog.open(),
    onFocusComposer: () => app().composer.focus(),
  };
}

function videoDeps(app: () => App, store: ChatStore, status: StatusLine): VideoPanelDeps {
  return {
    store,
    status,
    onChatChanged: () => app().refresh(),
    onVideoChanged: () => app().refresh(),
    onOverviewProgress: () => app().composer.updateProgress(),
    onOverview: (chatId, refs) => addOverview(app(), chatId, refs),
    studyStatus: () => app().study.status(),
    copyStatus: (fileKey) => app().copies.status(fileKey),
    loadCopy: (fileKey) => app().copies.load(fileKey),
    onAttached: (file, video) => app().copies.approve(file, video.fileKey),
    onCommitted: (file, video, replaced) => {
      app().copies.save(file, video.fileKey);
      if (!replaced) return;
      app().study.render();
      surface(app(), "remove the stored video", app().copies.release(replaced.fileKey));
    },
  };
}

function studyDeps(
  app: () => App,
  store: ChatStore,
  status: StatusLine,
  state: AppState,
  toast: Toast,
  videoPicker: VideoPicker,
): StudyDeps {
  return {
    store,
    status,
    toast,
    streamChat,
    confirm,
    toolContext: () => toolContext(state, store),
    openPlayer: (seconds) => app().video.openPlayer(seconds),
    seekVideo: (seconds, video) => app().video.seek(seconds, video),
    openTimeline: () => {
      videoPicker.showCurrent();
      app().knowledge.open("timeline");
    },
    shownVideo: () => videoPicker.shown(),
    onChanged: () => {
      app().video.render();
      refreshBalance(app());
    },
  };
}

function turnsDeps(
  app: () => App,
  store: ChatStore,
  status: StatusLine,
  conversation: Conversation,
): TurnsDeps {
  return {
    store,
    status,
    toast: { show: (text) => app().toast.show(text) },
    conversation,
    video: { renderSceneLog: () => app().sceneLog.render() },
    streamChat,
    timeline: () => app().study.timeline(),
    onChatChanged: () => app().refresh(),
    onRunningChanged: () => {
      app().composer.render();
      if (app().state.running) app().actions.invalidateUndo();
      else refreshBalance(app());
    },
    onMessageSaved: () => app().usage.render(),
  };
}

function initFirstRun(
  els: AppElements,
  state: AppState,
  store: ChatStore,
  app: () => App,
): Pick<App, "welcome" | "connectionTest"> {
  const welcome = initWelcome(els, state, {
    store,
    onOpenSettings: () => app().settingsDialog.open(),
    onTestConnection: () => {
      app().settingsDialog.open();
      surface(app(), "test the connection", app().connectionTest.run());
    },
  });
  const connectionTest = initConnectionTest(els, state, { onTested: () => welcome.render() });
  initBackup(els, {
    store,
    toast: { show: (text) => app().toast.show(text) },
    download: downloadBlob,
    onRestored: () => reloadChats(app()),
  });
  return { welcome, connectionTest };
}

async function reloadChats(app: App): Promise<void> {
  setChats(app.state, await app.store.listChats());
  app.refresh();
}

function composerDeps(
  app: () => App,
  store: ChatStore,
  status: StatusLine,
  { video, turns, conversation }: Pick<App, "video" | "turns" | "conversation">,
): ComposerDeps {
  return {
    store,
    status,
    video,
    turns,
    stopChecks: () => conversation.stopChecks(),
    onFiles: (files) => surface(app(), "attach the files", attachPicked(app(), files)),
    onPendingChanged: () => onPendingChanged(app()),
    onReady: (ready) => conversation.setReady(ready),
    onAudioChanged: () => app().usage.render(),
    onSettingsChanged: () => app().refresh(),
  };
}

function chatSettingsDeps(store: ChatStore, toast: Toast, onChanged: () => void): ChatSettingsDeps {
  return { store, toast, onChanged, onError: (message) => toast.show(message) };
}

function renderKnowledge(app: App): void {
  app.videoPicker.render();
  app.study.render();
  app.cast.render();
}

function initKnowledgePicker(els: AppElements, state: AppState, app: () => App): VideoPicker {
  return initVideoPicker(els, state, { onPick: () => renderKnowledge(app()) });
}

function initDrawer(
  els: AppElements,
  state: AppState,
  store: ChatStore,
  toast: Toast,
  { app, videoPicker }: { app: () => App; videoPicker: VideoPicker },
): Pick<App, "chatDrawer" | "knowledge" | "videoPicker" | "sceneLog" | "memory" | "cast"> {
  const seek = (seconds: number, video?: VideoAttachment) => app().video.seek(seconds, video);
  const onChanged = () => app().usage.render();
  return {
    chatDrawer: initChatDrawer(els, state, {
      onOpen: () => app().knowledge.close(),
      onClose: () => app().chatSettings.close(),
    }),
    knowledge: initKnowledgeDrawer(els, state, { onOpen: () => app().chatDrawer.close() }),
    videoPicker,
    sceneLog: initSceneLog(els, state, {
      store,
      toast,
      streamChat,
      seek,
      onChanged,
      currentTime: () => app().video.attachedPlaybackTime(),
    }),
    memory: initMemoryPanel(els, state, { store, toast, streamChat, onChanged }),
    cast: initCastPanel(els, state, {
      store,
      toast,
      streamChat,
      seek,
      onChanged,
      shownVideo: () => videoPicker.shown(),
    }),
  };
}

function wire(els: AppElements, state: AppState, store: ChatStore, status: StatusLine): App {
  const self = () => app;
  const refresh = () => refreshAll(app);
  const conversation = initConversation(els, conversationDeps(self, store, state));
  const video = initVideoPanel(els, state, videoDeps(self, store, status));
  const turns = initTurns(state, turnsDeps(self, store, status, conversation));
  const toast = initToast(els);
  const videoPicker = initKnowledgePicker(els, state, self);
  const actions = initMessageActions(state, actionsDeps(self, store, status, toast, state));
  const composer = initComposer(
    els,
    state,
    composerDeps(self, store, status, { video, turns, conversation }),
  );
  const study = initStudy(els, state, {
    ...studyDeps(self, store, status, state, toast, videoPicker),
    currentTime: () => video.attachedPlaybackTime(),
  });
  const balance = initBalance(els, state, { getBalance });
  const copies = initVideoCopies(els, state, {
    store,
    status,
    confirm,
    onProgress: () => video.render(),
  });
  const usage = initUsageMeter(els, state, {
    timeline: () => study.timeline(),
    toolsAvailable: () => toolContext(state, store) !== undefined,
    audioCoverage: () => composer.audioCoverage(),
  });
  const chatSettings = initChatSettings(els, state, chatSettingsDeps(store, toast, refresh));
  const sidebar = initSidebar(els, state, sidebarDeps(self, store, status, toast));
  const settingsDialog = initSettingsDialog(els, state, {
    loadModels: (settings) => loadModels(app, settings),
    onSaved: (previous) => onSettingsSaved(app, previous),
    onOpen: () => surface(app, "list the stored videos", copies.renderList()),
  });
  const app: App = {
    state,
    store,
    status,
    conversation,
    video,
    turns,
    actions,
    composer,
    study,
    usage,
    balance,
    copies,
    sidebar,
    chatSettings,
    settingsDialog,
    toast,
    refresh,
    ...initFirstRun(els, state, store, self),
    ...initDrawer(els, state, store, toast, { app: self, videoPicker }),
  };
  return app;
}

function onPendingChanged(app: App): void {
  app.video.render();
  app.usage.render();
  app.welcome.render();
}

function refreshAll(app: App): void {
  app.sidebar.render();
  app.chatSettings.render();
  app.chatDrawer.render();
  app.knowledge.render();
  app.videoPicker.render();
  app.sceneLog.render();
  app.memory.render();
  app.cast.render();
  app.composer.render();
  app.video.render();
  app.study.render();
  app.usage.render();
  app.conversation.refreshVideos();
  app.welcome.render();
}

function addOverview(app: App, chatId: string, refs: ImageRef[]): void {
  addPending(app.state, chatId, { kind: "overview", refs });
  if (app.state.currentChat?.id === chatId) app.composer.render();
}

async function persistMessage(app: App, message: ChatMessage): Promise<void> {
  const chat = app.state.currentChat;
  if (!chat) return;
  upsertMessage(app.state, message);
  app.usage.render();
  await app.store.putMessage(chat.id, message);
}

const startOpen = latestCalls();
let openingChatId: string | undefined;

async function openChat(app: App, chatId: string): Promise<void> {
  const { state, store } = app;
  if (state.currentChat?.id === chatId) {
    // Another click on a chat still being set up leaves that open to finish.
    if (openingChatId !== chatId) startOpen();
    return;
  }
  const isLatest = startOpen();
  openingChatId = chatId;
  app.turns.stop();
  app.actions.invalidateUndo();
  const chat = state.chats.find((entry) => entry.id === chatId) ?? (await store.getChat(chatId));
  if (!chat || !isLatest()) return;
  const messages = await store.listMessages(chatId);
  if (!isLatest()) return;
  setCurrentChat(state, chat, messages);
  fillChatModel(app);
  app.conversation.reset(messages);
  app.conversation.setRunning(state.running);
  app.status.clear();
  app.refresh();
  await app.video.restore();
  if (isLatest()) app.composer.render();
}

function openChatSafely(app: App, chatId: string): void {
  openChat(app, chatId).catch((error: unknown) => {
    app.status.show(`Could not open the chat: ${errorText(error)}`, "error");
  });
}

function openFallbackSafely(app: App): void {
  openFallbackChat(app).catch((error: unknown) => {
    app.status.show(`Could not open a chat: ${errorText(error)}`, "error");
  });
}

async function openFallbackChat(app: App): Promise<void> {
  const newest = app.state.chats[0];
  const chat = newest ?? (await app.sidebar.createChat());
  await openChat(app, chat.id);
}

function shouldLoadModels(settings: GlobalSettings): boolean {
  return settings.baseUrl.trim() !== "" && (settings.apiKey !== "" || !isVenice(settings.baseUrl));
}

const startModelLoad = latestCalls();

// A newer load owns the model list, so an older one that settles late changes nothing.
async function loadModels(app: App, settings: GlobalSettings): Promise<readonly ModelInfo[]> {
  const isLatest = startModelLoad();
  try {
    const models = await listModels(settings, { fallbackMaxImages: settings.fallbackMaxImages });
    if (!isLatest()) return app.state.models;
    setModels(app.state, models);
    fillChatModel(app);
    return models;
  } catch (error) {
    if (!isLatest()) return app.state.models;
    setModelsError(app.state, errorText(error));
    throw error;
  } finally {
    app.refresh();
  }
}

function loadModelsInBackground(app: App): void {
  loadModels(app, app.state.settings).catch((error: unknown) => {
    app.status.show(`Could not load models: ${errorText(error)}`, "error");
  });
}

// A chat made before the models loaded takes the default once there is one, so requests name a model.
function fillChatModel(app: App): void {
  const chat = app.state.currentChat;
  if (!chat || chat.settings.modelId !== "" || app.state.models.length === 0) return;
  const modelId = defaultModelId(app.state);
  if (modelId === "") return;
  updateChat(app.state, app.store, chat.id, (latest) => ({
    ...latest,
    settings: { ...latest.settings, modelId: latest.settings.modelId || modelId },
  })).then(
    () => app.refresh(),
    (error: unknown) =>
      app.status.show(`Could not save the chat's model: ${errorText(error)}`, "error"),
  );
}

function onSettingsSaved(app: App, previous: GlobalSettings): void {
  const { settings } = app.state;
  const apiChanged =
    settings.apiKey !== previous.apiKey ||
    settings.baseUrl !== previous.baseUrl ||
    settings.fallbackMaxImages !== previous.fallbackMaxImages;
  if (apiChanged) refreshBalance(app);
  if (settings.baseUrl === "") setModels(app.state, []);
  if (apiChanged && shouldLoadModels(settings)) loadModelsInBackground(app);
  else app.refresh();
}

function isFileHandle(handle: FileSystemHandle | null | undefined): handle is FileSystemFileHandle {
  return handle?.kind === "file";
}

async function handleFiles(app: App, dropped: readonly DroppedFile[]): Promise<void> {
  if (!app.state.currentChat) return;
  const ofKind = (kind: ReturnType<typeof classifyFile>) =>
    dropped.filter(({ file }) => classifyFile(file) === kind);
  const unsupported = ofKind("unsupported").map(({ file }) => file.name);
  if (unsupported.length > 0) {
    app.status.show(`Only videos and images can be attached: ${unsupported.join(", ")}`, "error");
  }
  const images = ofKind("image").map(({ file }) => file);
  if (images.length > 0) await app.composer.addImages(images);
  const [video] = ofKind("video");
  if (!video) return;
  const handle = await video.handle?.catch(() => null);
  await app.video.attach(video.file, isFileHandle(handle) ? handle : undefined);
}

function attachPicked(app: App, files: readonly PickedFile[]): Promise<void> {
  return handleFiles(
    app,
    files.map(({ file, handle }) => ({ file, handle: handle && Promise.resolve(handle) })),
  );
}

// Handles must be requested while the drop event is dispatching; the items go stale after it.
function droppedFiles(transfer: DataTransfer): DroppedFile[] {
  const fromItems = [...transfer.items].flatMap((item): DroppedFile[] => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    if (!file) return [];
    const handle = item.getAsFileSystemHandle?.();
    return [handle ? { file, handle } : { file }];
  });
  return fromItems.length > 0 ? fromItems : [...transfer.files].map((file) => ({ file }));
}

function listenForDrops(app: App, main: HTMLElement): void {
  let depth = 0;
  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
  main.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    depth += 1;
    main.classList.add("is-dragover");
  });
  main.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) main.classList.remove("is-dragover");
  });
  main.addEventListener("drop", (event) => {
    depth = 0;
    main.classList.remove("is-dragover");
    if (event.dataTransfer) {
      surface(app, "attach the files", handleFiles(app, droppedFiles(event.dataTransfer)));
    }
  });
  // A stray drop anywhere else would make the browser navigate away to the file.
  for (const type of ["dragover", "drop"]) {
    document.addEventListener(type, (event) => event.preventDefault());
  }
}

async function start(): Promise<void> {
  const els = queryElements();
  const state = createAppState(loadSettings());
  const status = initStatus(els);
  let store: ChatStore;
  try {
    store = await openChatStore();
    setChats(state, await store.listChats());
  } catch (error) {
    status.show(`Could not open the chat database: ${errorText(error)}`, "error");
    return;
  }
  const app = wire(els, state, store, status);
  listenForDrops(app, els.main);
  initShortcuts(els, {
    isRunning: () => state.running || app.conversation.isChecking(),
    stop: () => app.composer.stop(),
    editLastMessage: () => app.conversation.editLast(),
    chatDrawer: app.chatDrawer,
    knowledge: app.knowledge,
  });
  if (shouldLoadModels(state.settings)) loadModelsInBackground(app);
  refreshBalance(app);
  openFallbackSafely(app);
}

void start();
