import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import { VENICE_BASE_URL } from "../src/api/venice";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  addPending,
  createAppState,
  currentPending,
  isRunningIn,
  pendingFor,
  removeChat,
  replaceChat,
  setCurrentChat,
  setModels,
  setOverviewStatus,
  setPendingVideo,
  setRunning,
  type AppState,
} from "../src/state";
import type {
  ChatSettings,
  ChatStore,
  ImageRef,
  ModelInfo,
  StreamChat,
  UserMessage,
} from "../src/types";
import { initComposer, type Composer, type ComposerDeps } from "../src/ui/composer/composer";
import { initTurns } from "../src/app/turns";
import { upload, user } from "./support/factories";
import { cleanupFor, idleImages, isStored, saveImage, uploadRef } from "./support/images";
import { mountPage } from "./support/page";
import { replyWith, textThenWait, waitForAbort } from "./support/streams";

const MODEL = "vision-model";
const BEACH = { name: "beach.mp4", fileKey: "k", durationSeconds: 75, width: 1, height: 1 };
const SETTINGS = {
  ...DEFAULT_SETTINGS,
  baseUrl: VENICE_BASE_URL,
  apiKey: "key",
  defaultModelId: MODEL,
};

let els: AppElements;
let state: AppState;
let store: ChatStore;

const reply = replyWith("Hello");

function makeSpies() {
  return {
    status: { show: vi.fn(), clear: vi.fn() },
    stopChecks: vi.fn(),
    conversation: {
      show: vi.fn(),
      apply: vi.fn(),
      showError: vi.fn(),
      endTurn: vi.fn(),
      reset: vi.fn(),
      setRunning: vi.fn(),
      clearErrors: vi.fn(),
    },
  };
}

const noVideo = {
  overviewRendering: () => false,
  whenOverviewReady: () => Promise.resolve(),
  view: () => ({ video: undefined, url: null }),
  pendingView: () => ({ video: undefined, url: null }),
  commit: () => Promise.resolve(),
};

function setup(
  spies = makeSpies(),
  options: {
    streamChat?: StreamChat;
    video?: ComposerDeps["video"];
    onReady?: ComposerDeps["onReady"];
    images?: ComposerDeps["images"];
  } = {},
): Composer {
  const turns = initTurns(state, {
    store,
    status: spies.status,
    conversation: spies.conversation,
    video: { renderSceneLog: vi.fn() },
    images: idleImages(),
    streamChat: options.streamChat ?? reply,
    timeline: () => undefined,
    onChatChanged: vi.fn(),
    onRunningChanged: () => composer.render(),
    onMessageSaved: vi.fn(),
  });
  const composer = initComposer(els, state, {
    store,
    status: spies.status,
    video: options.video ?? noVideo,
    turns,
    images: options.images ?? idleImages(),
    stopChecks: spies.stopChecks,
    onFiles: vi.fn(),
    onPendingChanged: vi.fn(),
    onReady: options.onReady ?? vi.fn(),
  });
  return composer;
}

function menuItem(menu: HTMLElement, value: string): HTMLElement | undefined {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
    (item) => item.dataset["value"] === value,
  );
}

function pickThoroughness(value: string): void {
  els.composer.thoroughnessButton.click();
  menuItem(els.composer.thoroughnessMenu, value)?.click();
}

function pressKey(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function pressEnter(shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey, cancelable: true });
  els.composer.messageInput.dispatchEvent(event);
  return event;
}

beforeEach(async () => {
  localStorage.clear();
  els = mountPage();
  state = createAppState(SETTINGS);
  store = createMemoryStore();
  const chat = blankChat(state.settings.defaultModelId, "chat", 1);
  await store.putChat(chat);
  replaceChat(state, chat);
  setCurrentChat(state, chat, []);
});

describe("sending", () => {
  it("sends on Enter, renames a new chat and streams the reply", async () => {
    const spies = makeSpies();
    setup(spies);
    els.composer.messageInput.value = "Who is on the beach?";
    expect(pressEnter().defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(spies.conversation.endTurn).toHaveBeenCalled());
    const messages = await store.listMessages("chat");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(spies.conversation.show).toHaveBeenCalledWith(
      expect.objectContaining({ role: "user", text: "Who is on the beach?" }),
    );
    expect(spies.conversation.apply).toHaveBeenCalledWith(
      expect.objectContaining({ type: "assistantDone" }),
    );
    expect(els.composer.messageInput.value).toBe("");
    expect((await store.getChat("chat"))?.title).toBe("Who is on the beach?");
  });

  it("does not send on Shift+Enter", async () => {
    setup();
    els.composer.messageInput.value = "line one";
    expect(pressEnter(true).defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(state.running).toBe(false);
    expect(await store.listMessages("chat")).toEqual([]);
  });

  it("marks the thoroughness on the message and keeps it after sending", async () => {
    const spies = makeSpies();
    setup(spies);
    pickThoroughness("exhaustive");
    expect(els.composer.thoroughnessLabel.textContent).toBe("Exhaustive");
    expect(els.composer.thoroughnessButton.classList.contains("is-on")).toBe(true);
    els.composer.messageInput.value = "Look closely";
    pressEnter();
    await vi.waitFor(() => expect(spies.conversation.endTurn).toHaveBeenCalled());
    const [sent] = await store.listMessages("chat");
    expect((sent as UserMessage | undefined)?.thoroughness).toBe("exhaustive");
    expect((sent as UserMessage | undefined)?.deep).toBeUndefined();
    expect(els.composer.thoroughnessLabel.textContent).toBe("Exhaustive");
    expect(els.composer.thoroughnessButton.classList.contains("is-on")).toBe(true);
  });

  it("turns Send into Stop while a turn runs and stops it and any timestamp check", async () => {
    const streamChat: StreamChat = (_settings, _request, signal) => waitForAbort(signal);
    const spies = makeSpies();
    setup(spies, { streamChat });
    const button = els.composer.sendButton;
    expect(button.textContent).toBe("Send");
    els.composer.messageInput.value = "Describe it";
    pressEnter();
    await vi.waitFor(() => expect(button.textContent).toBe("Stop"));
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Send"));
    expect(state.running).toBe(false);
    expect(spies.conversation.endTurn).toHaveBeenCalled();
    expect(spies.stopChecks).toHaveBeenCalledTimes(1);
  });
});

describe("stopping", () => {
  it("ends the turn when Stop is pressed while waiting for the overview", async () => {
    const video = {
      ...noVideo,
      overviewRendering: () => true,
      whenOverviewReady: () => new Promise<void>(() => undefined),
    };
    setup(makeSpies(), { video });
    els.composer.messageInput.value = "What happens?";
    pressEnter();
    await vi.waitFor(() => expect(els.composer.sendButton.textContent).toBe("Stop"));
    els.composer.sendButton.click();
    await vi.waitFor(() => expect(state.running).toBe(false));
    expect(els.composer.sendButton.textContent).toBe("Send");
    expect(els.composer.messageInput.value).toBe("What happens?");
    expect(await store.listMessages("chat")).toEqual([]);
  });

  it("releases the composer when the chat is switched during a turn", async () => {
    const streamChat: StreamChat = (_settings, _request, signal) => textThenWait(signal);
    const spies = makeSpies();
    const composer = setup(spies, { streamChat });
    els.composer.messageInput.value = "Go";
    pressEnter();
    await vi.waitFor(() => expect(spies.conversation.apply).toHaveBeenCalled());
    composer.stop();
    setCurrentChat(state, blankChat("m", "other", 2), []);
    composer.render();
    expect(els.composer.sendButton.textContent).toBe("Send");
    spies.conversation.apply.mockClear();
    await vi.waitFor(() => expect(isRunningIn(state, "chat")).toBe(false));
    expect(spies.conversation.apply).not.toHaveBeenCalled();
  });

  it("writes nothing more for a chat deleted while its turn runs", async () => {
    const streamChat: StreamChat = (_settings, _request, signal) => textThenWait(signal);
    const spies = makeSpies();
    const composer = setup(spies, { streamChat });
    els.composer.messageInput.value = "Go";
    pressEnter();
    await vi.waitFor(() => expect(spies.conversation.apply).toHaveBeenCalled());
    removeChat(state, "chat");
    composer.stop();
    await vi.waitFor(() => expect(state.running).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const roles = (await store.listMessages("chat")).map((message) => message.role);
    expect(roles).toEqual(["user"]);
  });
});

describe("attachments and limits", () => {
  it("pins and removes pending images", () => {
    addPending(state, "chat", { kind: "image", ref: upload("a") });
    addPending(state, "chat", { kind: "overview", refs: [upload("s1"), upload("s2")] });
    setup();
    const items = () => [...els.composer.pendingList.querySelectorAll(".pending-item")];
    expect(items().map((item) => item.querySelector(".pending-label")?.textContent)).toEqual([
      "a.png",
      "Overview: 2 sheets",
    ]);
    items()[0]?.querySelector<HTMLButtonElement>(".pin-toggle")?.click();
    expect(currentPending(state)[0]).toEqual({
      kind: "image",
      ref: { ...upload("a"), pinned: true },
    });
    expect(items()[0]?.querySelector(".pin-toggle")?.getAttribute("aria-pressed")).toBe("true");
    items()[1]?.querySelector<HTMLButtonElement>(".pending-remove")?.click();
    expect(currentPending(state)).toHaveLength(1);
    expect(items()).toHaveLength(1);
  });

  it("carries the pending video on the sent message, makes it the chat's and clears its chip", async () => {
    const video = { name: "beach.mp4", fileKey: "k", durationSeconds: 75, width: 1, height: 1 };
    setPendingVideo(state, "chat", video);
    const commit = vi.fn((chatId: string, committed: typeof video) => {
      expect(currentPending(state)).toHaveLength(1);
      expect([chatId, committed]).toEqual(["chat", video]);
      return Promise.resolve();
    });
    const spies = makeSpies();
    setup(spies, { video: { ...noVideo, commit } });
    expect(els.composer.pendingList.querySelector(".pending-label")?.textContent).toBe(
      "beach.mp4 · 1:15",
    );
    els.composer.messageInput.value = "Watch this";
    pressEnter();
    await vi.waitFor(() => expect(spies.conversation.endTurn).toHaveBeenCalled());
    const [sent] = await store.listMessages("chat");
    expect(sent).toEqual(expect.objectContaining({ role: "user", video }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(currentPending(state)).toEqual([]);
  });

  it("sends nothing and keeps the message when making the video the chat's fails", async () => {
    setPendingVideo(state, "chat", BEACH);
    const spies = makeSpies();
    const commit = () => Promise.reject(new Error("quota"));
    setup(spies, { video: { ...noVideo, commit } });
    els.composer.messageInput.value = "Watch this";
    pressEnter();
    await vi.waitFor(() => expect(spies.status.show).toHaveBeenCalledWith("quota", "error"));
    expect(await store.listMessages("chat")).toEqual([]);
    expect(els.composer.messageInput.value).toBe("Watch this");
    expect(currentPending(state)).toEqual([{ kind: "video", video: BEACH }]);
    expect(els.composer.sendButton.textContent).toBe("Send");
  });
});

describe("a message that cannot be saved", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  async function refused(spies: ReturnType<typeof makeSpies>, error: string): Promise<void> {
    await vi.waitFor(() => expect(spies.status.show).toHaveBeenLastCalledWith(error, "error"));
    await vi.waitFor(() => expect(els.composer.sendButton.textContent).toBe("Send"));
  }

  it("goes back in the composer with its attachments when its chat was deleted elsewhere", async () => {
    const ids = [await saveImage(store), await saveImage(store)];
    const [sent = "", original = ""] = ids;
    addPending(state, "chat", { kind: "image", ref: uploadRef(sent, original) });
    const draft = currentPending(state);
    const spies = makeSpies();
    const images = cleanupFor(state, store);
    const streamChat = vi.fn<StreamChat>(reply);
    setup(spies, { streamChat, images });
    await store.deleteChat("chat");
    const putMessage = store.putMessage.bind(store);
    const swept: unknown[] = [];
    store.putMessage = async (chatId, message) => {
      swept.push(currentPending(state), await images.countToDelete());
      await images.release({ refs: [uploadRef(sent, original)] });
      return putMessage(chatId, message);
    };
    els.composer.messageInput.value = "Who is on the beach?";
    pressEnter();
    await refused(spies, "This chat has been deleted.");
    expect(swept).toEqual([[], { refused: "running" }]);
    expect(els.composer.messageInput.value).toBe("Who is on the beach?");
    expect(currentPending(state)).toEqual(draft);
    expect(els.composer.pendingList.children).toHaveLength(1);
    expect(state.messages).toEqual([]);
    expect(await store.listMessages("chat")).toEqual([]);
    expect(streamChat).not.toHaveBeenCalled();
    await images.release({ refs: [uploadRef(sent, original)] });
    expect(await images.countToDelete()).toMatchObject({ counted: { images: [] } });
    expect(await Promise.all(ids.map((id) => isStored(store, id)))).toEqual([true, true]);
  });

  it("goes back before what was typed and added meanwhile, with its video and overview", async () => {
    setPendingVideo(state, "chat", BEACH);
    addPending(state, "chat", { kind: "overview", refs: [upload("sheet")] });
    const draft = currentPending(state);
    const added = { kind: "image", ref: upload("later") } as const;
    store.putMessage = () => {
      els.composer.messageInput.value = "And now";
      addPending(state, "chat", added);
      return Promise.reject(new Error("quota"));
    };
    const spies = makeSpies();
    setup(spies);
    els.composer.messageInput.value = "Watch this";
    pressEnter();
    await refused(spies, "quota");
    expect(els.composer.messageInput.value).toBe("Watch this\nAnd now");
    expect(currentPending(state)).toEqual([...draft, added]);
  });

  it("keeps a video added meanwhile in place of its own", async () => {
    const city = { ...BEACH, name: "city.mp4", fileKey: "city" };
    const image = { kind: "image", ref: upload("i") } as const;
    setPendingVideo(state, "chat", BEACH);
    addPending(state, "chat", image);
    store.putMessage = () => {
      setPendingVideo(state, "chat", city);
      return Promise.reject(new Error("quota"));
    };
    const spies = makeSpies();
    setup(spies);
    els.composer.messageInput.value = "Watch this";
    pressEnter();
    await refused(spies, "quota");
    expect(currentPending(state)).toEqual([image, { kind: "video", video: city }]);
  });

  it.each([
    ["not twice when more was typed after it", "Watch this and tell me", "Watch this and tell me"],
    [
      "when what replaced it only contains it",
      "Do not Watch this",
      "Watch this\nDo not Watch this",
    ],
    ["when it was replaced before it was cleared", "Something else", "Watch this\nSomething else"],
  ])("goes back %s", async (_when, typed, shown) => {
    setPendingVideo(state, "chat", BEACH);
    const commit = () => {
      els.composer.messageInput.value = typed;
      return Promise.resolve();
    };
    store.putMessage = () => Promise.reject(new Error("quota"));
    const spies = makeSpies();
    setup(spies, { video: { ...noVideo, commit } });
    els.composer.messageInput.value = "Watch this";
    pressEnter();
    await refused(spies, "quota");
    expect(els.composer.messageInput.value).toBe(shown);
  });

  it("is not put back when it was saved and something fails after", async () => {
    addPending(state, "chat", { kind: "image", ref: upload("i") });
    const spies = makeSpies();
    spies.conversation.show.mockImplementation(() => {
      throw new Error("no room");
    });
    setup(spies);
    els.composer.messageInput.value = "Hello";
    pressEnter();
    await refused(spies, "no room");
    expect(await store.listMessages("chat")).toMatchObject([{ text: "Hello" }]);
    expect(els.composer.messageInput.value).toBe("");
    expect(currentPending(state)).toEqual([]);
  });

  it("can be sent again once it can be saved", async () => {
    const spies = makeSpies();
    setup(spies);
    const chat = await store.getChat("chat");
    await store.deleteChat("chat");
    els.composer.messageInput.value = "Hello";
    pressEnter();
    await refused(spies, "This chat has been deleted.");
    if (chat) await store.putChat(chat);
    pressEnter();
    await vi.waitFor(async () => expect(await store.listMessages("chat")).toHaveLength(2));
    expect(els.composer.messageInput.value).toBe("");
  });

  it("leaves a message already sent as it was", async () => {
    const spies = makeSpies();
    const sent = user("u", "first");
    await store.putMessage("chat", sent);
    setCurrentChat(state, state.currentChat, [sent]);
    setup(spies);
    store.putMessage = () => Promise.reject(new Error("quota"));
    els.composer.messageInput.value = "second";
    pressEnter();
    await refused(spies, "quota");
    expect(state.messages).toEqual([sent]);
    expect(spies.conversation.show).not.toHaveBeenCalled();
  });
});

describe("stopping while the video is being saved", () => {
  function sendWithSlowCommit(streamChat: StreamChat): () => void {
    setPendingVideo(state, "chat", BEACH);
    let finish: () => void = () => undefined;
    const commit = () => new Promise<void>((resolve) => (finish = resolve));
    setup(makeSpies(), { streamChat, video: { ...noVideo, commit } });
    els.composer.messageInput.value = "Watch this";
    pressEnter();
    return () => finish();
  }

  it("still saves the message on Stop, without a reply", async () => {
    const streamChat = vi.fn<StreamChat>(reply);
    const finish = sendWithSlowCommit(streamChat);
    await vi.waitFor(() => expect(els.composer.sendButton.textContent).toBe("Stop"));
    els.composer.sendButton.click();
    finish();
    await vi.waitFor(() => expect(els.composer.sendButton.textContent).toBe("Send"));
    const messages = await store.listMessages("chat");
    expect(messages).toEqual([expect.objectContaining({ text: "Watch this", video: BEACH })]);
    expect(state.messages).toEqual(messages);
    expect(els.composer.messageInput.value).toBe("");
    expect(currentPending(state)).toEqual([]);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("still saves the message to its own chat when another chat opens", async () => {
    const streamChat = vi.fn<StreamChat>(reply);
    const finish = sendWithSlowCommit(streamChat);
    await vi.waitFor(() => expect(isRunningIn(state, "chat")).toBe(true));
    const other = blankChat(MODEL, "other", 2);
    replaceChat(state, other);
    setCurrentChat(state, other, []);
    finish();
    await vi.waitFor(() => expect(isRunningIn(state, "chat")).toBe(false));
    expect(await store.listMessages("chat")).toEqual([
      expect.objectContaining({ text: "Watch this", video: BEACH }),
    ]);
    expect(state.messages).toEqual([]);
    expect(pendingFor(state, "chat")).toEqual([]);
    expect(streamChat).not.toHaveBeenCalled();
  });
});

describe("dropped images and limits", () => {
  const scaled = new Blob(["jpeg"], { type: "image/jpeg" });
  const larger = new Blob(["jpeg-large"], { type: "image/jpeg" });

  function composerWith(
    downscale: NonNullable<ComposerDeps["downscale"]>,
    dropped: ChatStore = store,
  ): { composer: Composer; status: ReturnType<typeof makeSpies>["status"] } {
    const { status } = makeSpies();
    const composer = initComposer(els, state, {
      store: dropped,
      status,
      video: noVideo,
      turns: { run: vi.fn(), stop: vi.fn(), answerNow: vi.fn() },
      images: idleImages(),
      stopChecks: vi.fn(),
      onFiles: vi.fn(),
      onPendingChanged: vi.fn(),
      onReady: vi.fn(),
      downscale,
    });
    return { composer, status };
  }

  function firstImage(): ImageRef {
    const [attachment] = currentPending(state);
    if (attachment?.kind !== "image") throw new Error("No image chip");
    return attachment.ref;
  }

  const cat = () => [new File(["png"], "cat.png", { type: "image/png" })];

  it("stores a dropped image that fits and adds it as a chip, with no larger copy", async () => {
    const downscale = vi.fn(() => Promise.resolve({ sent: { blob: scaled, width: 2, height: 1 } }));
    const putImage = vi.spyOn(store, "putImage");
    await composerWith(downscale).composer.addImages(cat());
    expect(downscale).toHaveBeenCalledWith(expect.any(File), expect.any(Number));
    const ref = firstImage();
    expect(await store.getImage(ref.id)).toBe(scaled);
    expect(ref.source).toEqual({ kind: "upload", name: "cat.png" });
    expect(putImage).toHaveBeenCalledTimes(1);
    expect(els.composer.pendingList.querySelector(".pending-label")?.textContent).toBe("cat.png");
  });

  it("keeps a larger copy of a big image for zooming", async () => {
    const downscale = vi.fn(() =>
      Promise.resolve({
        sent: { blob: scaled, width: 2, height: 1 },
        original: { blob: larger, width: 8, height: 4 },
      }),
    );
    await composerWith(downscale).composer.addImages(cat());
    const ref = firstImage();
    expect(await store.getImage(ref.id)).toBe(scaled);
    const { source } = ref;
    if (source.kind !== "upload" || source.originalId === undefined) {
      throw new Error("No original kept");
    }
    expect(source.originalId).not.toBe(ref.id);
    expect(await store.getImage(source.originalId)).toBe(larger);
  });

  it("still attaches the image when the larger copy cannot be stored", async () => {
    const downscale = vi.fn(() =>
      Promise.resolve({
        sent: { blob: scaled, width: 2, height: 1 },
        original: { blob: larger, width: 8, height: 4 },
      }),
    );
    const failing: ChatStore = {
      ...store,
      putImage: vi
        .fn<ChatStore["putImage"]>()
        .mockResolvedValueOnce("sent-id")
        .mockRejectedValueOnce(new Error("quota")),
    };
    const { composer, status } = composerWith(downscale, failing);
    await composer.addImages(cat());
    expect(firstImage()).toEqual({
      id: "sent-id",
      source: { kind: "upload", name: "cat.png" },
      pinned: false,
    });
    expect(status.show).not.toHaveBeenCalled();
  });

  it("blocks sending when pinned images exceed the model's limit", async () => {
    state = createAppState({ ...SETTINGS, fallbackMaxImages: 1 });
    setCurrentChat(state, blankChat(state.settings.defaultModelId, "chat", 1), []);
    addPending(state, "chat", { kind: "image", ref: { ...upload("a"), pinned: true } });
    addPending(state, "chat", { kind: "image", ref: { ...upload("b"), pinned: true } });
    const spies = makeSpies();
    setup(spies);
    els.composer.messageInput.value = "Look";
    pressEnter();
    await vi.waitFor(() =>
      expect(spies.status.show).toHaveBeenCalledWith(
        expect.stringContaining("limit of 1"),
        "error",
      ),
    );
    expect(await store.listMessages("chat")).toEqual([]);
    expect(els.composer.messageInput.value).toBe("Look");
  });

  it("disables Send with a hint when the Venice key is missing", () => {
    state = createAppState({ ...SETTINGS, apiKey: "" });
    setCurrentChat(state, blankChat(state.settings.defaultModelId, "chat", 1), []);
    setup();
    expect(els.composer.sendButton.disabled).toBe(true);
    expect(els.composer.hint.hidden).toBe(false);
    expect(els.composer.hint.textContent).toContain("Settings");
  });
});

describe("the pending video", () => {
  const video = { name: "beach.mp4", fileKey: "k", durationSeconds: 75, width: 1, height: 1 };

  it("removes the pending video and its overview from the chip, leaving other items", () => {
    setPendingVideo(state, "chat", video);
    addPending(state, "chat", { kind: "overview", refs: [upload("s1")] });
    addPending(state, "chat", { kind: "image", ref: upload("a") });
    const onPendingChanged = vi.fn();
    initComposer(els, state, {
      store,
      status: makeSpies().status,
      video: noVideo,
      turns: { run: vi.fn(), stop: vi.fn(), answerNow: vi.fn() },
      images: idleImages(),
      stopChecks: vi.fn(),
      onFiles: vi.fn(),
      onPendingChanged,
      onReady: vi.fn(),
    });
    const remove = els.composer.pendingList.querySelector<HTMLButtonElement>(
      ".pending-video .pending-remove",
    );
    expect(remove?.getAttribute("aria-label")).toBe("Remove beach.mp4 · 1:15");
    remove?.click();
    expect(currentPending(state)).toEqual([{ kind: "image", ref: upload("a") }]);
    expect(onPendingChanged).toHaveBeenCalled();
    expect(els.composer.pendingList.querySelectorAll(".pending-item")).toHaveLength(1);
  });

  it("shows the pending video's own thumbnail, not the chat's earlier video", () => {
    const earlier = { ...video, name: "earlier.mp4", fileKey: "e" };
    const chat = state.currentChat;
    if (!chat) throw new Error("No chat");
    replaceChat(state, { ...chat, video: earlier });
    setPendingVideo(state, "chat", video);
    setup(makeSpies(), {
      video: {
        ...noVideo,
        view: () => ({ video: earlier, url: "blob:earlier" }),
        pendingView: () => ({ video, url: "blob:pending" }),
      },
    });
    const thumb = els.composer.pendingList.querySelector<HTMLVideoElement>(".pending-thumb");
    expect(thumb?.getAttribute("src")).toBe("blob:pending");
  });

  it("says when the overview waits for a model or was reused", () => {
    setPendingVideo(state, "chat", video);
    setOverviewStatus(state, "chat", { kind: "needsModel", fileKey: "k" });
    const composer = setup();
    const progress = () => els.composer.pendingList.querySelector(".pending-progress")?.textContent;
    expect(progress()).toBe("Choose a model to prepare the overview");
    setOverviewStatus(state, "chat", { kind: "ready", fileKey: "k", sheets: 2, reused: true });
    composer.updateProgress();
    expect(progress()).toBe("Seen before, overview reused");
  });
});

describe("the pending overview", () => {
  const video = { name: "beach.mp4", fileKey: "k", durationSeconds: 75, width: 1, height: 1 };

  function attachVideo(): void {
    const chat = state.currentChat;
    if (!chat) throw new Error("No chat");
    replaceChat(state, { ...chat, video });
    setPendingVideo(state, "chat", video);
  }

  it("explains what removing the overview means", () => {
    addPending(state, "chat", { kind: "overview", refs: [upload("s1")] });
    setup();
    expect(els.composer.pendingList.querySelector(".pending-detail")?.textContent).toContain(
      "must call look itself",
    );
  });

  it("reports the video as ready once its overview is, and drops the ready label", () => {
    attachVideo();
    setOverviewStatus(state, "chat", { kind: "rendering", fileKey: "k", done: 1, total: 2 });
    const onReady = vi.fn();
    const composer = setup(makeSpies(), { onReady });
    const progress = () => els.composer.pendingList.querySelector(".pending-progress")?.textContent;
    expect(progress()).toBe("Overview 50%");
    expect(onReady).toHaveBeenLastCalledWith(undefined);
    setOverviewStatus(state, "chat", { kind: "ready", fileKey: "k", sheets: 2 });
    composer.updateProgress();
    expect(progress()).toBe("");
    expect(onReady).toHaveBeenLastCalledWith(video);
  });
});

function withVideo(): void {
  const video = { name: "beach.mp4", fileKey: "k", durationSeconds: 75, width: 1, height: 1 };
  const chat = state.currentChat;
  if (!chat) throw new Error("No chat");
  replaceChat(state, { ...chat, video });
  setCurrentChat(state, { ...chat, video }, []);
}

describe("audio toggle", () => {
  it("is disabled with an explaining title while no video is attached", () => {
    const composer = setup();
    const toggle = els.composer.audioToggle;
    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toBe("Attach a video to let the model hear it");
    withVideo();
    composer.render();
    expect(toggle.disabled).toBe(false);
    expect(toggle.title).toContain("analysed on this computer");
  });

  it("can be turned on for a video still waiting to be sent", () => {
    const composer = setup();
    setPendingVideo(state, "chat", {
      name: "beach.mp4",
      fileKey: "k",
      durationSeconds: 75,
      width: 1,
      height: 1,
    });
    composer.render();
    expect(els.composer.audioToggle.disabled).toBe(false);
  });

  it("marks the message, stays on after sending and is remembered", async () => {
    withVideo();
    const spies = makeSpies();
    setup(spies);
    const toggle = els.composer.audioToggle;
    toggle.click();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(els.composer.thoroughnessLabel.textContent).toBe("Normal");
    els.composer.messageInput.value = "What is said at the start?";
    pressEnter();
    await vi.waitFor(() => expect(spies.conversation.endTurn).toHaveBeenCalled());
    const [sent] = await store.listMessages("chat");
    expect((sent as UserMessage | undefined)?.audio).toBe(true);
    expect((sent as UserMessage | undefined)?.thoroughness).toBeUndefined();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    els = mountPage();
    const reopened = setup();
    expect(els.composer.audioToggle.getAttribute("aria-pressed")).toBe("true");
    expect(reopened.audioWanted()).toBe(true);
    els.composer.audioToggle.click();
    expect(reopened.audioWanted()).toBe(false);
    expect(localStorage.getItem("vid2grid-chat-audio")).toBe("off");
  });

  it("is wanted as left even with no video to hear", () => {
    localStorage.setItem("vid2grid-chat-audio", "on");
    const composer = setup();
    expect(els.composer.audioToggle.disabled).toBe(true);
    expect(composer.audioWanted()).toBe(true);
  });

  it("leaves audio off a thorough reply sent without it", async () => {
    withVideo();
    const spies = makeSpies();
    setup(spies);
    pickThoroughness("thorough");
    els.composer.messageInput.value = "Look closely";
    pressEnter();
    await vi.waitFor(() => expect(spies.conversation.endTurn).toHaveBeenCalled());
    const [sent] = await store.listMessages("chat");
    expect((sent as UserMessage | undefined)?.thoroughness).toBe("thorough");
    expect((sent as UserMessage | undefined)?.audio).toBeUndefined();
  });
});

describe("audio coverage for the usage meter", () => {
  it("reports what was heard only while on, and redraws the meter when it loads", async () => {
    await store.putAudio({
      fileKey: "k",
      labels: [...state.settings.soundLabels],
      backgroundLabels: [...state.settings.backgroundSoundLabels],
      speechSpans: [{ startSeconds: 0, endSeconds: 75 }],
      soundSpans: [{ startSeconds: 0, endSeconds: 75 }],
      speech: [],
      events: [],
      updatedAt: 1,
    });
    withVideo();
    const onAudioChanged = vi.fn();
    const composer = initComposer(els, state, {
      store,
      status: makeSpies().status,
      video: noVideo,
      turns: { run: vi.fn(), stop: vi.fn(), answerNow: vi.fn() },
      images: idleImages(),
      stopChecks: vi.fn(),
      onFiles: vi.fn(),
      onPendingChanged: vi.fn(),
      onReady: vi.fn(),
      onAudioChanged,
    });
    expect(composer.audioCoverage()).toBeUndefined();
    els.composer.audioToggle.click();
    expect(onAudioChanged).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(composer.audioCoverage()).toEqual({
        text: "analysed 0:00 to 1:15 (speech and sounds)",
        canListen: true,
      }),
    );
  });
});

describe("prefill", () => {
  it("puts text before what was typed and leaves the cursor after it", () => {
    const composer = setup();
    const input = els.composer.messageInput;
    composer.prefill("Who is in this?");
    expect(input.value).toBe("Who is in this?");
    input.value = "what is she holding";
    composer.prefill("About [1:02]: ");
    expect(input.value).toBe("About [1:02]: what is she holding");
    expect(input.selectionStart).toBe("About [1:02]: ".length);
    expect(document.activeElement).toBe(input);
  });
});

function withChatSettings(settings: Partial<ChatSettings>): void {
  const chat = state.currentChat;
  if (!chat) throw new Error("No chat");
  const updated = { ...chat, settings: { ...chat.settings, ...settings } };
  replaceChat(state, updated);
  setCurrentChat(state, updated, []);
}

function reasoningModel(): ModelInfo {
  return {
    id: state.settings.defaultModelId,
    name: "Thinker",
    vision: true,
    tools: true,
    reasoning: true,
    reasoningEffortOptions: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
    maxImages: 10,
    privacy: "private",
    traits: [],
    uncensored: false,
    recommended: false,
    beta: false,
    videoInput: false,
    audioInput: false,
    e2ee: false,
  };
}

function itemNames(menu: HTMLElement): string[] {
  return [...menu.querySelectorAll(".composer-menu-name")].map((name) => name.textContent);
}

describe("thoroughness menu", () => {
  it("leaves a Normal message unmarked", async () => {
    const spies = makeSpies();
    setup(spies);
    els.composer.messageInput.value = "Quick question";
    pressEnter();
    await vi.waitFor(() => expect(spies.conversation.endTurn).toHaveBeenCalled());
    const [sent] = await store.listMessages("chat");
    expect((sent as UserMessage | undefined)?.thoroughness).toBeUndefined();
    expect((sent as UserMessage | undefined)?.reasoningEffort).toBeUndefined();
  });

  it("hints each level's looks, with Normal following the chat's max rounds", () => {
    withChatSettings({ maxRounds: 5 });
    setup();
    const hint = (value: string) =>
      menuItem(els.composer.thoroughnessMenu, value)?.querySelector(".composer-menu-hint")
        ?.textContent;
    expect(hint("normal")).toBe("Up to 5 looks");
    expect(hint("thorough")).toBe("Up to 15 looks, stops once confident");
    expect(hint("exhaustive")).toBe("Up to 30 looks, most thorough and costly");
  });

  it("opens on the checked level, moves with the arrow keys and closes on Escape", () => {
    setup();
    const { thoroughnessButton: button, thoroughnessMenu: menu } = els.composer;
    button.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(menuItem(menu, "normal"));
    pressKey(menuItem(menu, "normal") ?? menu, "ArrowDown");
    expect(document.activeElement).toBe(menuItem(menu, "thorough"));
    pressKey(menuItem(menu, "thorough") ?? menu, "End");
    expect(document.activeElement).toBe(menuItem(menu, "exhaustive"));
    const escape = pressKey(menuItem(menu, "exhaustive") ?? menu, "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });
});

describe("thoroughness saved per chat", () => {
  it("saves the level on the chat, deleting the key for Normal", async () => {
    setup();
    pickThoroughness("thorough");
    expect(state.currentChat?.settings.thoroughness).toBe("thorough");
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.thoroughness).toBe("thorough"),
    );
    pickThoroughness("normal");
    expect("thoroughness" in (state.currentChat?.settings ?? {})).toBe(false);
    await vi.waitFor(async () =>
      expect("thoroughness" in ((await store.getChat("chat"))?.settings ?? {})).toBe(false),
    );
  });

  it("shows each chat's own level and starts new chats at Normal", () => {
    const composer = setup();
    pickThoroughness("exhaustive");
    const other = blankChat(state.settings.defaultModelId, "other", 2);
    replaceChat(state, other);
    setCurrentChat(state, other, []);
    composer.render();
    expect(els.composer.thoroughnessLabel.textContent).toBe("Normal");
    const first = state.chats.find((chat) => chat.id === "chat");
    if (!first) throw new Error("No chat");
    setCurrentChat(state, first, []);
    composer.render();
    expect(els.composer.thoroughnessLabel.textContent).toBe("Exhaustive");
  });

  it("checks the picked level and closes on a press outside", () => {
    setup();
    pickThoroughness("thorough");
    const { thoroughnessButton: button, thoroughnessMenu: menu } = els.composer;
    expect(menuItem(menu, "thorough")?.getAttribute("aria-checked")).toBe("true");
    expect(menuItem(menu, "normal")?.getAttribute("aria-checked")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Thoroughness: Thorough");
    button.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.hidden).toBe(true);
  });
});

describe("reasoning picker", () => {
  it("is hidden when the chat's model has no reasoning levels", () => {
    setup();
    expect(els.composer.reasoningControl.hidden).toBe(true);
  });

  it("offers Default, naming the model's own level, then each level", () => {
    setModels(state, [reasoningModel()]);
    setup();
    expect(els.composer.reasoningControl.hidden).toBe(false);
    expect(itemNames(els.composer.reasoningMenu)).toEqual([
      "Default (medium)",
      "low",
      "medium",
      "high",
    ]);
    expect(els.composer.reasoningMenu.textContent).toContain("The model's own default");
  });

  it("checks the chat's own level and leaves Default naming the model's", () => {
    setModels(state, [reasoningModel()]);
    withChatSettings({ reasoningEffort: "high" });
    setup();
    expect(itemNames(els.composer.reasoningMenu)[0]).toBe("Default (medium)");
    expect(els.composer.reasoningLabel.textContent).toBe("Reasoning: high");
    expect(menuItem(els.composer.reasoningMenu, "high")?.getAttribute("aria-checked")).toBe("true");
  });

  it("ignores a chat level the model does not offer", () => {
    setModels(state, [reasoningModel()]);
    withChatSettings({ reasoningEffort: "max" });
    setup();
    expect(els.composer.reasoningLabel.textContent).toBe("Reasoning");
    expect(menuItem(els.composer.reasoningMenu, "")?.getAttribute("aria-checked")).toBe("true");
  });

  it("names the level a higher thoroughness picks when the chat sets none", () => {
    setModels(state, [{ ...reasoningModel(), defaultReasoningEffort: "low" }]);
    setup();
    pickThoroughness("exhaustive");
    expect(itemNames(els.composer.reasoningMenu)[0]).toBe("Default (high)");
    expect(els.composer.reasoningMenu.textContent).toContain("Set by Exhaustive");
  });
});

describe("reasoning saved per chat", () => {
  it("saves the picked level on the chat and sends it with every message", async () => {
    setModels(state, [reasoningModel()]);
    const spies = makeSpies();
    const composer = setup(spies);
    els.composer.reasoningButton.click();
    menuItem(els.composer.reasoningMenu, "high")?.click();
    expect(els.composer.reasoningLabel.textContent).toBe("Reasoning: high");
    expect(state.currentChat?.settings.reasoningEffort).toBe("high");
    await vi.waitFor(async () =>
      expect((await store.getChat("chat"))?.settings.reasoningEffort).toBe("high"),
    );
    els.composer.messageInput.value = "Think hard";
    pressEnter();
    await vi.waitFor(() => expect(spies.conversation.endTurn).toHaveBeenCalled());
    const [sent] = await store.listMessages("chat");
    expect((sent as UserMessage | undefined)?.reasoningEffort).toBe("high");
    composer.render();
    expect(els.composer.reasoningLabel.textContent).toBe("Reasoning: high");
    expect(menuItem(els.composer.reasoningMenu, "high")?.getAttribute("aria-checked")).toBe("true");
  });

  it("clears the chat's level when Default is picked, deleting the key", async () => {
    setModels(state, [reasoningModel()]);
    withChatSettings({ reasoningEffort: "high" });
    setup();
    els.composer.reasoningButton.click();
    menuItem(els.composer.reasoningMenu, "")?.click();
    expect(els.composer.reasoningLabel.textContent).toBe("Reasoning");
    expect("reasoningEffort" in (state.currentChat?.settings ?? {})).toBe(false);
    await vi.waitFor(async () =>
      expect("reasoningEffort" in ((await store.getChat("chat"))?.settings ?? {})).toBe(false),
    );
  });

  it("tells the app once a pick is saved, so the Model tab can follow", async () => {
    setModels(state, [reasoningModel()]);
    const onSettingsChanged = vi.fn();
    initComposer(els, state, {
      store,
      status: makeSpies().status,
      video: noVideo,
      turns: { run: vi.fn(), stop: vi.fn(), answerNow: vi.fn() },
      images: idleImages(),
      stopChecks: vi.fn(),
      onFiles: vi.fn(),
      onPendingChanged: vi.fn(),
      onReady: vi.fn(),
      onSettingsChanged,
    });
    els.composer.reasoningButton.click();
    menuItem(els.composer.reasoningMenu, "low")?.click();
    await vi.waitFor(() => expect(onSettingsChanged).toHaveBeenCalledTimes(1));
  });
});

describe("answer now", () => {
  function setupWithTurns(answerNow: () => void): Composer {
    return initComposer(els, state, {
      store,
      status: makeSpies().status,
      video: noVideo,
      turns: { run: vi.fn(), stop: vi.fn(), answerNow },
      images: idleImages(),
      stopChecks: vi.fn(),
      onFiles: vi.fn(),
      onPendingChanged: vi.fn(),
      onReady: vi.fn(),
    });
  }

  it("shows only while a running turn is thinking and asks the turn to answer", () => {
    const answerNow = vi.fn();
    const composer = setupWithTurns(answerNow);
    const button = els.composer.answerNowButton;
    composer.setThinking(true);
    expect(button.hidden).toBe(true);
    setRunning(state, true);
    composer.render();
    expect(button.hidden).toBe(false);
    button.click();
    expect(answerNow).toHaveBeenCalledTimes(1);
    expect(button.hidden).toBe(true);
    composer.setThinking(true);
    composer.setThinking(false);
    expect(button.hidden).toBe(true);
  });

  it("moves focus to Stop when pressed from the keyboard", () => {
    const composer = setupWithTurns(vi.fn());
    const { answerNowButton, sendButton } = els.composer;
    setRunning(state, true);
    composer.setThinking(true);
    answerNowButton.focus();
    answerNowButton.click();
    expect(document.activeElement).toBe(sendButton);
  });

  it("moves focus to the message when the turn has ended by the time it is pressed", () => {
    const composer = setupWithTurns(() => setRunning(state, false));
    const { answerNowButton, messageInput } = els.composer;
    setRunning(state, true);
    composer.setThinking(true);
    answerNowButton.focus();
    answerNowButton.click();
    expect(document.activeElement).toBe(messageInput);
  });

  it("hides when the turn ends", () => {
    const composer = setupWithTurns(vi.fn());
    setRunning(state, true);
    composer.setThinking(true);
    expect(els.composer.answerNowButton.hidden).toBe(false);
    setRunning(state, false);
    composer.render();
    expect(els.composer.answerNowButton.hidden).toBe(true);
  });
});
