function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`Missing or mistyped element: #${id}`);
  return el;
}

function queryChatChrome() {
  return {
    sidebar: {
      newChatButton: byId("newChatButton", HTMLButtonElement),
      newFolderButton: byId("newFolderButton", HTMLButtonElement),
      searchInput: byId("chatSearchInput", HTMLInputElement),
      chatList: byId("chatList", HTMLUListElement),
      openSettingsButton: byId("openSettingsButton", HTMLButtonElement),
    },
    balance: {
      el: byId("balance", HTMLElement),
      text: byId("balanceText", HTMLElement),
      source: byId("balanceSource", HTMLElement),
    },
    header: {
      title: byId("chatTitle", HTMLHeadingElement),
      modelName: byId("chatModelName", HTMLElement),
      modelBadge: byId("chatModelBadge", HTMLElement),
      usageLine: byId("usageLine", HTMLElement),
      usageContext: byId("usageContext", HTMLElement),
      usageTotals: byId("usageTotals", HTMLElement),
      chatSettingsToggle: byId("chatSettingsToggle", HTMLButtonElement),
      knowledgeToggle: byId("knowledgeToggle", HTMLButtonElement),
    },
    video: {
      chip: byId("videoChip", HTMLButtonElement),
      chipName: byId("videoChipName", HTMLElement),
      chipMeta: byId("videoChipMeta", HTMLElement),
      reattachInput: byId("reattachInput", HTMLInputElement),
      miniPlayer: byId("miniPlayer", HTMLElement),
      miniPlayerTitle: byId("miniPlayerTitle", HTMLElement),
      miniPlayerClose: byId("miniPlayerClose", HTMLButtonElement),
      miniPlayerVideo: byId("miniPlayerVideo", HTMLVideoElement),
      miniPlayerBar: byId("miniPlayerBar", HTMLElement),
      miniPlayerResize: byId("miniPlayerResize", HTMLButtonElement),
      miniPlayerDock: byId("miniPlayerDock", HTMLButtonElement),
      miniPlayerStepBack: byId("miniPlayerStepBack", HTMLButtonElement),
      miniPlayerStepForward: byId("miniPlayerStepForward", HTMLButtonElement),
      miniPlayerSpeed: byId("miniPlayerSpeed", HTMLSelectElement),
      miniPlayerLoopAround: byId("miniPlayerLoopAround", HTMLButtonElement),
      miniPlayerLoopIn: byId("miniPlayerLoopIn", HTMLButtonElement),
      miniPlayerLoopOut: byId("miniPlayerLoopOut", HTMLButtonElement),
      miniPlayerLoopRange: byId("miniPlayerLoopRange", HTMLElement),
      miniPlayerLoopClear: byId("miniPlayerLoopClear", HTMLButtonElement),
      miniPlayerLoopTrack: byId("miniPlayerLoopTrack", HTMLElement),
      miniPlayerLoopBand: byId("miniPlayerLoopBand", HTMLElement),
    },
  };
}

function queryChatSettings() {
  return {
    chatSettings: {
      panel: byId("chatSettingsPanel", HTMLElement),
      systemPromptInput: byId("systemPromptInput", HTMLTextAreaElement),
      characterNameInput: byId("characterNameInput", HTMLInputElement),
      userNameInput: byId("userNameInput", HTMLInputElement),
      voiceSelect: byId("voiceSelect", HTMLSelectElement),
      voiceHint: byId("voiceHint", HTMLElement),
      videoReferencesSelect: byId("videoReferencesSelect", HTMLSelectElement),
      roleplayNames: byId("roleplayNames", HTMLDetailsElement),
      promptPreview: byId("promptPreview", HTMLElement),
      personaSelect: byId("personaSelect", HTMLSelectElement),
      savePersonaButton: byId("savePersonaButton", HTMLButtonElement),
      managePresetsButton: byId("managePresetsButton", HTMLButtonElement),
      presetEdited: byId("presetEdited", HTMLElement),
      updatePresetButton: byId("updatePresetButton", HTMLButtonElement),
      revertPresetButton: byId("revertPresetButton", HTMLButtonElement),
      modelPicker: byId("modelPicker", HTMLElement),
      temperatureInput: byId("temperatureInput", HTMLInputElement),
      reasoningEffortField: byId("reasoningEffortField", HTMLElement),
      reasoningEffortSelect: byId("reasoningEffortSelect", HTMLSelectElement),
      earlierImagesSelect: byId("earlierImagesSelect", HTMLSelectElement),
      sheetResolutionSelect: byId("sheetResolutionSelect", HTMLSelectElement),
      maxRoundsInput: byId("maxRoundsInput", HTMLInputElement),
      sheetResolutionAuto: byId("sheetResolutionAuto", HTMLOptionElement),
      sheetResolutionHint: byId("sheetResolutionHint", HTMLElement),
    },
    drawer: {
      backdrop: byId("chatDrawerBackdrop", HTMLElement),
      closeButton: byId("chatDrawerClose", HTMLButtonElement),
      tabList: byId("chatDrawerTabs", HTMLElement),
      body: byId("chatDrawerBody", HTMLElement),
    },
    knowledge: {
      panel: byId("knowledgePanel", HTMLElement),
      backdrop: byId("knowledgeBackdrop", HTMLElement),
      closeButton: byId("knowledgeClose", HTMLButtonElement),
      tabList: byId("knowledgeTabs", HTMLElement),
      body: byId("knowledgeBody", HTMLElement),
      videoField: byId("knowledgeVideoField", HTMLElement),
      videoSelect: byId("knowledgeVideoSelect", HTMLSelectElement),
      videoNote: byId("knowledgeVideoNote", HTMLElement),
    },
  };
}

function queryDrawerPanels() {
  return {
    sceneLog: {
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
    },
    memory: {
      storyInput: byId("storyInput", HTMLTextAreaElement),
      storyMeta: byId("storyMeta", HTMLElement),
      summarizeButton: byId("summarizeButton", HTMLButtonElement),
      clearButton: byId("clearStoryButton", HTMLButtonElement),
      status: byId("storyStatus", HTMLElement),
      stopButton: byId("storyStop", HTMLButtonElement),
    },
    cast: {
      title: byId("castTitle", HTMLElement),
      notice: byId("castNotice", HTMLElement),
      empty: byId("castEmpty", HTMLElement),
      list: byId("castList", HTMLUListElement),
      addButton: byId("addCastButton", HTMLButtonElement),
      suggestButton: byId("suggestCastButton", HTMLButtonElement),
      status: byId("castStatus", HTMLElement),
      stopButton: byId("castStop", HTMLButtonElement),
    },
  };
}

function queryStudyAndToast() {
  return {
    study: {
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
      progress: {
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
      },
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
    },
    toast: {
      el: byId("toast", HTMLElement),
      text: byId("toastText", HTMLElement),
      action: byId("toastAction", HTMLButtonElement),
      close: byId("toastClose", HTMLButtonElement),
    },
  };
}

function queryFirstRun() {
  return {
    welcome: {
      el: byId("welcome", HTMLElement),
      dismiss: byId("welcomeDismiss", HTMLButtonElement),
      steps: byId("welcomeSteps", HTMLOListElement),
    },
    connectionTest: {
      button: byId("testConnectionButton", HTMLButtonElement),
      report: byId("connectionReport", HTMLUListElement),
    },
    backup: {
      includeImagesInput: byId("backupImagesInput", HTMLInputElement),
      downloadButton: byId("downloadBackupButton", HTMLButtonElement),
      restoreButton: byId("restoreBackupButton", HTMLButtonElement),
      restoreInput: byId("restoreBackupInput", HTMLInputElement),
      status: byId("backupStatus", HTMLElement),
    },
  };
}

function queryConversationView() {
  return {
    conversation: {
      scroller: byId("conversation", HTMLElement),
      empty: byId("emptyConversation", HTMLElement),
      list: byId("messageList", HTMLOListElement),
      readyCard: byId("readyCard", HTMLElement),
      readyStarters: byId("readyStarters", HTMLElement),
      announcer: byId("turnAnnouncer", HTMLElement),
    },
    status: {
      message: byId("status", HTMLElement),
    },
    lightbox: {
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
    },
    shortcuts: {
      toggle: byId("shortcutsToggle", HTMLButtonElement),
      popover: byId("shortcutsPopover", HTMLElement),
    },
  };
}

function queryPresetManager() {
  return {
    presetManager: {
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
    },
  };
}

export function queryElements() {
  return {
    main: byId("mainColumn", HTMLElement),
    ...queryFirstRun(),
    templates: {
      modelPicker: byId("modelPickerTemplate", HTMLTemplateElement),
      modelRow: byId("modelRowTemplate", HTMLTemplateElement),
    },
    ...queryChatChrome(),
    ...queryStudyAndToast(),
    ...queryChatSettings(),
    ...queryPresetManager(),
    ...queryDrawerPanels(),
    ...queryConversationView(),
    composer: {
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
    },
    settingsDialog: {
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
      fallbackMaxImagesInput: byId("fallbackMaxImagesInput", HTMLInputElement),
      soundLabelsInput: byId("soundLabelsInput", HTMLTextAreaElement),
      backgroundSoundLabelsInput: byId("backgroundSoundLabelsInput", HTMLTextAreaElement),
      resetSoundLabelsButton: byId("resetSoundLabelsButton", HTMLButtonElement),
      refreshModelsButton: byId("refreshModelsButton", HTMLButtonElement),
      modelsStatus: byId("modelsStatus", HTMLElement),
    },
  };
}

export type AppElements = ReturnType<typeof queryElements>;

export interface StatusLine {
  show(message: string, kind?: "info" | "error"): void;
  clear(): void;
}

export function initStatus(els: Pick<AppElements, "status">): StatusLine {
  const { message } = els.status;
  return {
    show: (text, kind = "info") => {
      message.textContent = text;
      message.classList.toggle("is-error", kind === "error");
    },
    clear: () => {
      message.textContent = "";
      message.classList.remove("is-error");
    },
  };
}
