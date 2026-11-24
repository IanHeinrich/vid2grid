function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing or mistyped element: #${id}`);
  return el;
}

export function part<T extends Element>(root: ParentNode, selector: string, type: new () => T): T {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`Missing or mistyped element: ${selector}`);
  return el;
}

function queryWelcome() {
  return {
    el: byId("welcome", HTMLElement),
    dismiss: byId("welcomeDismiss", HTMLButtonElement),
    steps: byId("welcomeSteps", HTMLOListElement),
  };
}

function queryConnectionTest() {
  return {
    button: byId("testConnectionButton", HTMLButtonElement),
    status: byId("connectionReport", HTMLElement),
  };
}

function queryBackup() {
  return {
    includeImagesInput: byId("backupImagesInput", HTMLInputElement),
    downloadButton: byId("downloadBackupButton", HTMLButtonElement),
    restoreButton: byId("restoreBackupButton", HTMLButtonElement),
    restoreInput: byId("restoreBackupInput", HTMLInputElement),
    status: byId("backupStatus", HTMLElement),
  };
}

function queryTemplates() {
  return {
    modelPicker: byId("modelPickerTemplate", HTMLTemplateElement),
    modelRow: byId("modelRowTemplate", HTMLTemplateElement),
  };
}

function querySidebar() {
  return {
    newChatButton: byId("newChatButton", HTMLButtonElement),
    newFolderButton: byId("newFolderButton", HTMLButtonElement),
    searchInput: byId("chatSearchInput", HTMLInputElement),
    chatList: byId("chatList", HTMLUListElement),
    openSettingsButton: byId("openSettingsButton", HTMLButtonElement),
  };
}

function queryBalance() {
  return {
    el: byId("balance", HTMLElement),
    text: byId("balanceText", HTMLElement),
    source: byId("balanceSource", HTMLElement),
  };
}

function queryHeader() {
  return {
    title: byId("chatTitle", HTMLHeadingElement),
    modelName: byId("chatModelName", HTMLElement),
    modelBadge: byId("chatModelBadge", HTMLElement),
    usageLine: byId("usageLine", HTMLElement),
    usageContext: byId("usageContext", HTMLElement),
    usageTotals: byId("usageTotals", HTMLElement),
    chatSettingsToggle: byId("chatSettingsToggle", HTMLButtonElement),
    knowledgeToggle: byId("knowledgeToggle", HTMLButtonElement),
  };
}

function queryVideo() {
  return {
    chip: byId("videoChip", HTMLButtonElement),
    chipName: byId("videoChipName", HTMLElement),
    chipMeta: byId("videoChipMeta", HTMLElement),
    reattachInput: byId("reattachInput", HTMLInputElement),
  };
}

function queryMiniPlayer() {
  return {
    el: byId("miniPlayer", HTMLElement),
    title: byId("miniPlayerTitle", HTMLElement),
    close: byId("miniPlayerClose", HTMLButtonElement),
    video: byId("miniPlayerVideo", HTMLVideoElement),
    bar: byId("miniPlayerBar", HTMLElement),
    resize: byId("miniPlayerResize", HTMLButtonElement),
    dock: byId("miniPlayerDock", HTMLButtonElement),
    stepBack: byId("miniPlayerStepBack", HTMLButtonElement),
    stepForward: byId("miniPlayerStepForward", HTMLButtonElement),
    speed: byId("miniPlayerSpeed", HTMLSelectElement),
    loopAround: byId("miniPlayerLoopAround", HTMLButtonElement),
    loopIn: byId("miniPlayerLoopIn", HTMLButtonElement),
    loopOut: byId("miniPlayerLoopOut", HTMLButtonElement),
    loopRange: byId("miniPlayerLoopRange", HTMLElement),
    loopClear: byId("miniPlayerLoopClear", HTMLButtonElement),
    loopTrack: byId("miniPlayerLoopTrack", HTMLElement),
    loopBand: byId("miniPlayerLoopBand", HTMLElement),
  };
}

function queryStudyProgress() {
  return {
    el: byId("studyProgress", HTMLElement),
    title: byId("studyProgressTitle", HTMLElement),
    detail: byId("studyProgressDetail", HTMLElement),
    audio: byId("studyProgressAudio", HTMLElement),
    bar: byId("studyProgressBar", HTMLProgressElement),
    pauseButton: byId("studyProgressPause", HTMLButtonElement),
    stopButton: byId("studyProgressStop", HTMLButtonElement),
    openButton: byId("studyProgressOpen", HTMLButtonElement),
    zoomButton: byId("studyProgressZoom", HTMLButtonElement),
    closeButton: byId("studyProgressClose", HTMLButtonElement),
  };
}

function queryStudy() {
  return {
    button: byId("studyButton", HTMLButtonElement),
    dialog: byId("studyDialog", HTMLDialogElement),
    modelPicker: byId("studyModelPicker", HTMLElement),
    estimate: byId("studyEstimate", HTMLElement),
    planSummary: byId("studyPlanSummary", HTMLElement),
    startButton: byId("studyStartButton", HTMLButtonElement),
    windowInput: byId("studyWindowInput", HTMLInputElement),
    windowValue: byId("studyWindowValue", HTMLOutputElement),
    densityInput: byId("studyDensityInput", HTMLSelectElement),
    fromInput: byId("studyFromInput", HTMLInputElement),
    toInput: byId("studyToInput", HTMLInputElement),
    fromCurrentButton: byId("studyFromCurrentButton", HTMLButtonElement),
    wholeVideoButton: byId("studyWholeVideoButton", HTMLButtonElement),
    audioInput: byId("studyAudioInput", HTMLInputElement),
    progress: queryStudyProgress(),
    section: byId("timelineSection", HTMLElement),
    summary: byId("timelineSummary", HTMLElement),
    empty: byId("timelineEmpty", HTMLElement),
    list: byId("timelineList", HTMLOListElement),
    zoomButton: byId("timelineZoomButton", HTMLButtonElement),
    clearButton: byId("clearTimelineButton", HTMLButtonElement),
    audioSection: byId("timelineAudio", HTMLElement),
    audioTitle: byId("timelineAudioTitle", HTMLElement),
    audioCoverage: byId("timelineAudioCoverage", HTMLElement),
    audioList: byId("timelineAudioList", HTMLOListElement),
    audioMore: byId("timelineAudioMore", HTMLButtonElement),
  };
}

function queryToast() {
  return {
    el: byId("toast", HTMLElement),
    text: byId("toastText", HTMLElement),
    action: byId("toastAction", HTMLButtonElement),
    close: byId("toastClose", HTMLButtonElement),
  };
}

function queryChatSettings() {
  return {
    panel: byId("chatSettingsPanel", HTMLElement),
    systemPromptInput: byId("systemPromptInput", HTMLTextAreaElement),
    characterNameInput: byId("characterNameInput", HTMLInputElement),
    userNameInput: byId("userNameInput", HTMLInputElement),
    voiceSelect: byId("voiceSelect", HTMLSelectElement),
    voiceHint: byId("voiceHint", HTMLElement),
    videoReferencesSelect: byId("videoReferencesSelect", HTMLSelectElement),
    characterNames: byId("characterNames", HTMLDetailsElement),
    promptPreview: byId("promptPreview", HTMLElement),
    personaSelect: byId("personaSelect", HTMLSelectElement),
    savePersonaButton: byId("savePersonaButton", HTMLButtonElement),
    managePresetsButton: byId("managePresetsButton", HTMLButtonElement),
    presetEdited: byId("presetEdited", HTMLElement),
    updatePresetButton: byId("updatePresetButton", HTMLButtonElement),
    revertPresetButton: byId("revertPresetButton", HTMLButtonElement),
    modelPicker: byId("modelPicker", HTMLElement),
    lookingModelPicker: byId("lookingModelPicker", HTMLElement),
    textOnlyWarning: byId("textOnlyWarning", HTMLElement),
    lookingModelServer: byId("lookingModelServer", HTMLElement),
    temperatureInput: byId("temperatureInput", HTMLInputElement),
    reasoningEffortField: byId("reasoningEffortField", HTMLElement),
    reasoningEffortSelect: byId("reasoningEffortSelect", HTMLSelectElement),
    earlierImagesSelect: byId("earlierImagesSelect", HTMLSelectElement),
    sheetResolutionSelect: byId("sheetResolutionSelect", HTMLSelectElement),
    maxRoundsInput: byId("maxRoundsInput", HTMLInputElement),
    sheetResolutionAuto: byId("sheetResolutionAuto", HTMLOptionElement),
    sheetResolutionHint: byId("sheetResolutionHint", HTMLElement),
  };
}

function queryDrawer() {
  return {
    backdrop: byId("chatDrawerBackdrop", HTMLElement),
    closeButton: byId("chatDrawerClose", HTMLButtonElement),
    tabList: byId("chatDrawerTabs", HTMLElement),
    body: byId("chatDrawerBody", HTMLElement),
  };
}

function queryKnowledge() {
  return {
    panel: byId("knowledgePanel", HTMLElement),
    backdrop: byId("knowledgeBackdrop", HTMLElement),
    closeButton: byId("knowledgeClose", HTMLButtonElement),
    tabList: byId("knowledgeTabs", HTMLElement),
    body: byId("knowledgeBody", HTMLElement),
    videoField: byId("knowledgeVideoField", HTMLElement),
    videoSelect: byId("knowledgeVideoSelect", HTMLSelectElement),
    videoNote: byId("knowledgeVideoNote", HTMLElement),
  };
}

function queryPresetManager() {
  return {
    dialog: byId("presetManagerDialog", HTMLDialogElement),
    list: byId("presetList", HTMLUListElement),
    empty: byId("presetEmpty", HTMLElement),
    editor: byId("presetEditor", HTMLElement),
    nameInput: byId("presetNameInput", HTMLInputElement),
    systemPromptInput: byId("presetSystemPromptInput", HTMLTextAreaElement),
    characterNameInput: byId("presetCharacterNameInput", HTMLInputElement),
    userNameInput: byId("presetUserNameInput", HTMLInputElement),
    voiceSelect: byId("presetVoiceSelect", HTMLSelectElement),
    voiceHint: byId("presetVoiceHint", HTMLElement),
    videoReferencesSelect: byId("presetVideoReferencesSelect", HTMLSelectElement),
    newButton: byId("newPresetButton", HTMLButtonElement),
    duplicateButton: byId("duplicatePresetButton", HTMLButtonElement),
    deleteButton: byId("deletePresetButton", HTMLButtonElement),
    applyButton: byId("applyPresetButton", HTMLButtonElement),
  };
}

function querySceneLog() {
  return {
    title: byId("sceneLogTitle", HTMLElement),
    count: byId("sceneLogCount", HTMLElement),
    empty: byId("sceneLogEmpty", HTMLElement),
    list: byId("sceneLogList", HTMLOListElement),
    addButton: byId("addNoteButton", HTMLButtonElement),
    condenseButton: byId("condenseButton", HTMLButtonElement),
    status: byId("sceneLogStatus", HTMLElement),
    stopButton: byId("sceneLogStop", HTMLButtonElement),
    preview: byId("condensePreview", HTMLElement),
    previewList: byId("condenseList", HTMLOListElement),
    acceptButton: byId("acceptCondenseButton", HTMLButtonElement),
    discardButton: byId("discardCondenseButton", HTMLButtonElement),
  };
}

function queryMemory() {
  return {
    storyInput: byId("storyInput", HTMLTextAreaElement),
    storyMeta: byId("storyMeta", HTMLElement),
    summarizeButton: byId("summarizeButton", HTMLButtonElement),
    clearButton: byId("clearStoryButton", HTMLButtonElement),
    status: byId("storyStatus", HTMLElement),
    stopButton: byId("storyStop", HTMLButtonElement),
  };
}

function queryCast() {
  return {
    title: byId("castTitle", HTMLElement),
    notice: byId("castNotice", HTMLElement),
    empty: byId("castEmpty", HTMLElement),
    list: byId("castList", HTMLUListElement),
    addButton: byId("addCastButton", HTMLButtonElement),
    suggestButton: byId("suggestCastButton", HTMLButtonElement),
    status: byId("castStatus", HTMLElement),
    stopButton: byId("castStop", HTMLButtonElement),
  };
}

function queryConversation() {
  return {
    scroller: byId("conversation", HTMLElement),
    empty: byId("emptyConversation", HTMLElement),
    list: byId("messageList", HTMLOListElement),
    readyCard: byId("readyCard", HTMLElement),
    readyStarters: byId("readyStarters", HTMLElement),
    announcer: byId("turnAnnouncer", HTMLElement),
  };
}

function queryStatus() {
  return {
    message: byId("status", HTMLElement),
  };
}

function queryLightbox() {
  return {
    dialog: byId("lightbox", HTMLDialogElement),
    image: byId("lightboxImage", HTMLImageElement),
    label: byId("lightboxLabel", HTMLElement),
    counter: byId("lightboxCounter", HTMLElement),
    pin: byId("lightboxPin", HTMLButtonElement),
    prev: byId("lightboxPrev", HTMLButtonElement),
    next: byId("lightboxNext", HTMLButtonElement),
    close: byId("lightboxClose", HTMLButtonElement),
    stage: byId("lightboxStage", HTMLElement),
    zoomIn: byId("lightboxZoomIn", HTMLButtonElement),
    zoomOut: byId("lightboxZoomOut", HTMLButtonElement),
    ask: byId("lightboxAsk", HTMLButtonElement),
    hint: byId("lightboxHint", HTMLElement),
  };
}

function queryShortcuts() {
  return {
    toggle: byId("shortcutsToggle", HTMLButtonElement),
    popover: byId("shortcutsPopover", HTMLElement),
  };
}

function queryComposer() {
  return {
    form: byId("composer", HTMLFormElement),
    pendingList: byId("pendingList", HTMLUListElement),
    attachButton: byId("attachButton", HTMLButtonElement),
    attachInput: byId("attachInput", HTMLInputElement),
    thoroughnessControl: byId("thoroughnessControl", HTMLElement),
    thoroughnessButton: byId("thoroughnessButton", HTMLButtonElement),
    thoroughnessLabel: byId("thoroughnessLabel", HTMLElement),
    thoroughnessMenu: byId("thoroughnessMenu", HTMLElement),
    reasoningControl: byId("reasoningControl", HTMLElement),
    reasoningButton: byId("reasoningButton", HTMLButtonElement),
    reasoningLabel: byId("reasoningLabel", HTMLElement),
    reasoningMenu: byId("reasoningMenu", HTMLElement),
    audioToggle: byId("audioToggle", HTMLButtonElement),
    messageInput: byId("messageInput", HTMLTextAreaElement),
    answerNowButton: byId("answerNowButton", HTMLButtonElement),
    sendButton: byId("sendButton", HTMLButtonElement),
    hint: byId("composerHint", HTMLElement),
  };
}

function queryLookingSettings() {
  return {
    modelPicker: byId("defaultLookingPicker", HTMLElement),
    ownServerInput: byId("lookingOwnServerInput", HTMLInputElement),
    serverFields: byId("lookingServerFields", HTMLElement),
    baseUrlInput: byId("lookingBaseUrlInput", HTMLInputElement),
    apiKeyInput: byId("lookingApiKeyInput", HTMLInputElement),
    refreshButton: byId("refreshLookingButton", HTMLButtonElement),
    modelsStatus: byId("lookingModelsStatus", HTMLElement),
    changedNote: byId("lookingChanged", HTMLElement),
    destination: byId("lookingDestination", HTMLElement),
    testButton: byId("testLookingButton", HTMLButtonElement),
    testStatus: byId("lookingReport", HTMLElement),
  };
}

function querySettingsDialog() {
  return {
    dialog: byId("settingsDialog", HTMLDialogElement),
    form: byId("settingsForm", HTMLFormElement),
    apiKeyInput: byId("apiKeyInput", HTMLInputElement),
    baseUrlInput: byId("baseUrlInput", HTMLInputElement),
    defaultModelPicker: byId("defaultModelPicker", HTMLElement),
    privateOnlyInput: byId("privateOnlyInput", HTMLInputElement),
    showThinkingInput: byId("showThinkingInput", HTMLInputElement),
    keepCopiesInput: byId("keepCopiesInput", HTMLInputElement),
    askAboveInput: byId("askAboveInput", HTMLInputElement),
    storageUsage: byId("storageUsage", HTMLElement),
    storedVideoList: byId("storedVideoList", HTMLUListElement),
    unusedImagesText: byId("unusedImagesText", HTMLElement),
    unusedImagesStatus: byId("unusedImagesStatus", HTMLElement),
    deleteUnusedImagesButton: byId("deleteUnusedImagesButton", HTMLButtonElement),
    fallbackMaxImagesInput: byId("fallbackMaxImagesInput", HTMLInputElement),
    soundLabelsInput: byId("soundLabelsInput", HTMLTextAreaElement),
    backgroundSoundLabelsInput: byId("backgroundSoundLabelsInput", HTMLTextAreaElement),
    resetSoundLabelsButton: byId("resetSoundLabelsButton", HTMLButtonElement),
    refreshModelsButton: byId("refreshModelsButton", HTMLButtonElement),
    modelsStatus: byId("modelsStatus", HTMLElement),
  };
}

export function queryElements() {
  return {
    main: byId("mainColumn", HTMLElement),
    welcome: queryWelcome(),
    connectionTest: queryConnectionTest(),
    backup: queryBackup(),
    templates: queryTemplates(),
    sidebar: querySidebar(),
    balance: queryBalance(),
    header: queryHeader(),
    video: queryVideo(),
    miniPlayer: queryMiniPlayer(),
    study: queryStudy(),
    toast: queryToast(),
    chatSettings: queryChatSettings(),
    drawer: queryDrawer(),
    knowledge: queryKnowledge(),
    presetManager: queryPresetManager(),
    sceneLog: querySceneLog(),
    memory: queryMemory(),
    cast: queryCast(),
    conversation: queryConversation(),
    status: queryStatus(),
    lightbox: queryLightbox(),
    shortcuts: queryShortcuts(),
    composer: queryComposer(),
    settingsDialog: querySettingsDialog(),
    lookingSettings: queryLookingSettings(),
  };
}

export type AppElements = ReturnType<typeof queryElements>;
