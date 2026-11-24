import "./styles/index.css";
import { getBalance, listModels, streamChat } from "./api/client";
import { attachFiles, attachPicked } from "./app/attachFiles";
import {
  initMessageActions,
  type MessageActions,
  type MessageActionsDeps,
} from "./app/messageActions";
import { createImageCleanup, type ImageCleanup } from "./app/imageCleanup";
import { lookingName, lookingPricing } from "./app/lookingConnection";
import { createModelList, shouldLoadModels, type ModelList } from "./app/modelList";
import { createChatOpener, type ChatOpener } from "./app/openChat";
import { persistMessage } from "./app/persistMessage";
import { browserLocks, joinTabs, type Tabs } from "./app/tabs";
import { toolContext } from "./app/toolContext";
import { initTurns, type Turns, type TurnsDeps } from "./app/turns";
import { initVideoRemoval, type VideoRemoval } from "./app/videoRemoval";
import { currentModel } from "./chat/models";
import { lookingModelId } from "./chat/seen";
import { openChatStore } from "./chat/store";
import { queryElements, type AppElements } from "./dom";
import { loadSettings } from "./settings";
import { addPending, createAppState, setChats, type AppState } from "./state";
import { errorText } from "./text";
import type { ChatStore, ImageRef, VideoAttachment } from "./types";
import { initBackup } from "./ui/settings/backup";
import { initBalance, type Balance } from "./ui/shell/balance";
import { initCastPanel, type CastPanel } from "./ui/knowledge/castPanel";
import {
  initChatDrawer,
  initKnowledgeDrawer,
  type ChatDrawer,
  type KnowledgeDrawer,
} from "./ui/shell/chatDrawer";
import {
  initChatSettings,
  type ChatSettingsDeps,
  type ChatSettingsPanel,
} from "./ui/settings/chatSettingsPanel";
import { initComposer, type Composer, type ComposerDeps } from "./ui/composer/composer";
import { initConnectionTest, type ConnectionTest } from "./ui/settings/connectionTest";
import {
  initConversation,
  type Conversation,
  type ConversationDeps,
} from "./ui/conversation/conversation";
import { downloadBlob } from "./ui/shared/download";
import { listenForDrops } from "./ui/shell/fileDrop";
import {
  initSettingsDialog,
  type SettingsDialog,
  type SettingsDialogDeps,
} from "./ui/settings/settingsDialog";
import { initSidebar, type Sidebar, type SidebarDeps } from "./ui/shell/sidebar";
import { initUnusedImages, type UnusedImagesPanel } from "./ui/settings/unusedImages";
import { initVideoPicker, type VideoPicker } from "./ui/video/knowledgeVideos";
import { initMemoryPanel, type MemoryPanel } from "./ui/knowledge/memoryPanel";
import { storedPickerSettings } from "./ui/modelPicker/pickerModel";
import { initSceneLog, type SceneLogPanel } from "./ui/knowledge/sceneLog";
import { initStudy, type Study, type StudyDeps } from "./ui/study/studyPanel";
import { initShortcuts } from "./ui/shared/shortcuts";
import { initStatus, type StatusLine } from "./ui/shared/status";
import { initToast, type Toast } from "./ui/shared/toast";
import { initVideoCopies, type VideoCopies } from "./ui/video/videoCopies";
import { initUsageMeter, type UsageMeter } from "./ui/shell/tokenMeter";
import { initVideoPanel, type VideoPanel, type VideoPanelDeps } from "./ui/video/videoPanel";
import { initWelcome, type Welcome } from "./ui/shell/welcome";

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
  images: ImageCleanup;
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
  opener: ChatOpener;
  modelList: ModelList;
  removal: VideoRemoval;
  refresh(): void;
}

type UseCases = "opener" | "modelList" | "removal";

function surface(app: App, action: string, work: Promise<unknown>): void {
  work.catch((error: unknown) => app.toast.show(`Could not ${action}: ${errorText(error)}`));
}

// The balance line shows its own unavailable state, so a failed refresh stays quiet.
function refreshBalance(app: Pick<App, "balance">): void {
  app.balance.refresh().catch(() => undefined);
}

// On the status line, since a toast would end an Undo that is still open.
function surfaceQuietly(app: Pick<App, "status">, action: string, work: Promise<unknown>): void {
  work.catch((error: unknown) => {
    app.status.show(`Could not ${action}: ${errorText(error)}`, "error");
  });
}

const imagesOf = (app: () => App): Pick<ImageCleanup, "hold" | "release"> => ({
  hold: (use) => app().images.hold(use),
  release: (dropped) => app().images.release(dropped),
});

// Deleted only where nothing else uses them.
function releaseCopies(app: Pick<App, "copies" | "status">, videoKeys: readonly string[]): void {
  for (const fileKey of videoKeys) {
    surfaceQuietly(app, "remove the stored video", app.copies.release(fileKey));
  }
}

function removeVideo(app: App, { fileKey }: VideoAttachment): void {
  surface(app, "remove the video", app.removal.remove(fileKey));
}

const confirm = (message: string) => window.confirm(message);

function conversationDeps(app: () => App, store: ChatStore, state: AppState): ConversationDeps {
  return {
    store,
    onSeek: (seconds, video) => app().video.seek(seconds, video),
    onCue: (seconds) => app().video.cue(seconds),
    onMessageChanged: (message) =>
      surface(
        app(),
        "save the message",
        persistMessage({ state, store, onChanged: () => app().usage.render() }, message),
      ),
    onEdit: (message, text, onUnsaved) =>
      surface(app(), "edit the message", app().turns.edit(message, text, onUnsaved)),
    onReplay: () => surface(app(), "replay", app().turns.replay()),
    onKeepGoing: () => surface(app(), "keep going", app().turns.keepGoing()),
    onBranch: (message) => reportFailure(app(), "branch", app().actions.branch(message)),
    onDelete: (message) => reportFailure(app(), "delete", app().actions.remove(message)),
    onCopy: (message) => surface(app(), "copy the message", app().actions.copy(message)),
    isRunning: () => state.running,
    videoView: () => app().video.view(),
    onPopOut: (seconds) => app().video.openPlayer(seconds),
    onReattach: () => surface(app(), "reattach the video", app().video.reattach()),
    onRemoveVideo: (video) => removeVideo(app(), video),
    removeBlocker: () => app().removal.blocker(),
    removedVideos: () => state.currentChat?.removedVideos ?? [],
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
    onLookAgain: (messageId, note) =>
      surface(app(), "save the message", app().actions.lookAgain(messageId, note)),
    looking: () => lookingModelId(state.currentChat) !== undefined,
    lookingName: (modelId) => lookingName(state, modelId),
    lookingPricing: (modelId) => lookingPricing(state, modelId),
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
    images: imagesOf(app),
    streamChat,
    confirm,
    toolContext: () => toolContext(state, store),
    conversation: {
      reset: (messages) => app().conversation.reset(messages),
      show: (message) => app().conversation.show(message),
    },
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
    images: imagesOf(app),
    onOpen: (chatId) => openChatSafely(app(), chatId),
    onDeletingCurrent: () => {
      app().turns.stop();
      app().actions.invalidateUndo();
    },
    onDeleted: () => app().study.render(),
    onDeleteFinal: (videoKeys) => releaseCopies(app(), videoKeys),
    onCurrentDeleted: () => openFallbackSafely(app()),
    onChatChanged: () => app().refresh(),
    onRenamed: () => app().chatSettings.render(),
    onOpenSettings: () => app().settingsDialog.open(),
    onFocusComposer: () => app().composer.focus(),
  };
}

function videoDeps(app: () => App, store: ChatStore, status: StatusLine): VideoPanelDeps {
  return {
    store,
    status,
    images: imagesOf(app),
    onChatChanged: () => app().refresh(),
    onVideoChanged: () => app().refresh(),
    onOverviewProgress: () => app().composer.updateProgress(),
    onOverview: (chatId, refs) => addOverview(app(), chatId, refs),
    studyStatus: () => app().study.status(),
    copyStatus: (fileKey) => app().copies.status(fileKey),
    loadCopy: (fileKey) => app().copies.load(fileKey),
    onAttached: (file, video) => app().copies.approve(file, video.fileKey),
    audioWanted: () => app().composer.audioWanted(),
    onCommitted: (file, video, replaced) => {
      app().copies.save(file, video.fileKey);
      if (!replaced) return;
      app().study.render();
      releaseCopies(app(), [replaced.fileKey]);
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
    removeBlocker: () => app().removal.blocker(),
    onRemoveVideo: (video) => removeVideo(app(), video),
    focusComposer: () => app().composer.focus(),
    onChanged: () => {
      app().video.render();
      app().conversation.refreshVideos();
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
    images: imagesOf(app),
    streamChat,
    timeline: () => app().study.timeline(),
    onChatChanged: () => app().refresh(),
    onRunningChanged: () => {
      app().composer.render();
      if (app().state.running) {
        app().actions.invalidateUndo();
        app().removal.invalidateUndo();
      } else refreshBalance(app());
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
  const connectionTest = initConnectionTest(els, state, {
    onTested: () => welcome.render(),
    looking: () => app().settingsDialog.looking(),
    onListed: (api, models) => app().settingsDialog.listed(api, models),
  });
  initBackup(els, {
    store,
    images: imagesOf(app),
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
    images: imagesOf(app),
    stopChecks: () => conversation.stopChecks(),
    onFiles: (files) => surface(app(), "attach the files", attachPicked(app(), files)),
    onPendingChanged: () => onPendingChanged(app()),
    onReady: (ready) => conversation.setReady(ready),
    onAudioChanged: () => app().usage.render(),
    onSettingsChanged: () => app().refresh(),
  };
}

function settingsDialogDeps(
  app: () => App,
  copies: VideoCopies,
  unusedImages: UnusedImagesPanel,
): SettingsDialogDeps {
  return {
    loadModels: (settings) => app().modelList.load(settings),
    onSaved: (previous) => app().modelList.onSettingsSaved(previous),
    onListed: (api, models) => app().modelList.accept(api, models),
    onOpen: () => {
      surface(app(), "list the stored videos", copies.renderList());
      void unusedImages.render();
    },
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

function initStored(
  els: AppElements,
  state: AppState,
  store: ChatStore,
  status: StatusLine,
  { app, tabs }: { app: () => App; tabs: Tabs },
): Pick<App, "copies" | "images" | "settingsDialog"> {
  const onProgress = () => app().video.render();
  const images = createImageCleanup(state, {
    store,
    tabs,
    onVideosFreed: (videoKeys) =>
      surfaceQuietly(app(), "remove the stored video", app().copies.releaseWaiting(videoKeys)),
  });
  const isHeld = (fileKey: string) => images.holdsVideo(fileKey);
  const copies = initVideoCopies(els, state, { store, status, confirm, isHeld, onProgress });
  const unusedImages = initUnusedImages(els, { images, confirm });
  const deps = settingsDialogDeps(app, copies, unusedImages);
  return { copies, images, settingsDialog: initSettingsDialog(els, state, deps) };
}

function wire(
  els: AppElements,
  state: AppState,
  store: ChatStore,
  status: StatusLine,
  tabs: Tabs,
): App {
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
  const usage = initUsageMeter(els, state, {
    timeline: () => study.timeline(),
    toolsAvailable: () => toolContext(state, store) !== undefined,
    audioCoverage: () => composer.audioCoverage(),
  });
  const chatSettings = initChatSettings(els, state, chatSettingsDeps(store, toast, refresh));
  const sidebar = initSidebar(els, state, sidebarDeps(self, store, status, toast));
  const base: Omit<App, UseCases> = {
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
    sidebar,
    chatSettings,
    toast,
    refresh,
    ...initStored(els, state, store, status, { app: self, tabs }),
    ...initFirstRun(els, state, store, self),
    ...initDrawer(els, state, store, toast, { app: self, videoPicker }),
  };
  const app: App = { ...base, ...initUseCases(base) };
  return app;
}

function initUseCases(app: Omit<App, UseCases>): Pick<App, UseCases> {
  return {
    opener: createChatOpener(app),
    modelList: createModelList({ ...app, listModels, refreshBalance: () => refreshBalance(app) }),
    removal: initVideoRemoval(app.state, {
      ...app,
      isStudying: (chatId) => app.study.isRunningIn(chatId),
      onFinal: (videoKeys) => releaseCopies(app, videoKeys),
      onChanged: app.refresh,
    }),
  };
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

function openChatSafely(app: App, chatId: string): void {
  app.opener.open(chatId).catch((error: unknown) => {
    app.status.show(`Could not open the chat: ${errorText(error)}`, "error");
  });
}

function openFallbackSafely(app: App): void {
  app.opener.openFallback().catch((error: unknown) => {
    app.status.show(`Could not open a chat: ${errorText(error)}`, "error");
  });
}

async function start(): Promise<void> {
  const els = queryElements();
  const state = createAppState(loadSettings());
  const status = initStatus(els);
  // Joined before anything is read, so no other tab deletes images this one is about to use.
  const tabs = await joinTabs(browserLocks());
  let store: ChatStore;
  try {
    store = await openChatStore();
    setChats(state, await store.listChats());
  } catch (error) {
    status.show(`Could not open the chat database: ${errorText(error)}`, "error");
    return;
  }
  const app = wire(els, state, store, status, tabs);
  listenForDrops(els.main, (files) => surface(app, "attach the files", attachFiles(app, files)));
  initShortcuts(els, {
    isRunning: () => state.running || app.conversation.isChecking(),
    stop: () => app.composer.stop(),
    editLastMessage: () => app.conversation.editLast(),
    chatDrawer: app.chatDrawer,
    knowledge: app.knowledge,
  });
  if (shouldLoadModels(state.settings)) app.modelList.loadInBackground();
  app.modelList.loadLookingInBackground();
  refreshBalance(app);
  openFallbackSafely(app);
}

void start();
