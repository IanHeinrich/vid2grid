import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyseAudio } from "../src/audio/videoAudio";
import { createImageCleanup, type ImageCleanup } from "../src/app/imageCleanup";
import { toolContext } from "../src/app/toolContext";
import { initVideoRemoval, type VideoRemoval } from "../src/app/videoRemoval";
import { blankChat } from "../src/chat/chats";
import { videoForMessage } from "../src/chat/messageVideo";
import { buildSystemPrompt } from "../src/chat/prompts";
import {
  addPending,
  currentPending,
  pendingVideo,
  replaceChat,
  setCurrentChat,
  setModels,
  setRunning,
  updateChat,
  upsertMessage,
} from "../src/state";
import type { Chat, ChatMessage, ImageRef, UserMessage, VideoAttachment } from "../src/types";
import { initSidebar } from "../src/ui/shell/sidebar";
import { initToast, type Toast } from "../src/ui/shared/toast";
import { initVideoCopies, type VideoCopies, type VideoStorage } from "../src/ui/video/videoCopies";
import type { VideoPanel, VideoPanelDeps } from "../src/ui/video/videoPanel";
import { fileKey } from "../src/video/render";
import { sheetCacheKey } from "../src/video/sheetCache";
import { assistant, model, sheet, user } from "./support/factories";
import { aloneTabs, isStored, saveImage } from "./support/images";
import { described } from "./support/looking";
import {
  attachmentFor,
  cleanUpVideoPanel,
  deferred,
  els,
  MODEL,
  openOther,
  panel,
  resetVideoPanel,
  send,
  settle,
  spies,
  state,
  store,
  video,
} from "./support/videoPanel";

const BEACH = video("beach.mp4", 3);
const DUNES = video("dunes.mp4", 4);
const beach = attachmentFor(BEACH);
const dunes = attachmentFor(DUNES);
const handle = { kind: "file", name: "beach.mp4" } as unknown as FileSystemFileHandle;

let videos: VideoPanel;
let removal: VideoRemoval;
let timers: (() => void)[];
let images: ImageCleanup;
let storage: ReturnType<typeof makeStorage>;
let studying: string | undefined;
let toast: Toast;
let copies: VideoCopies;
const show = vi.fn<(message: ChatMessage) => void>();
const showAll = (messages: readonly ChatMessage[]): void =>
  messages.forEach((shown) => show(shown));
const stopChecks = vi.fn();

function makeStorage() {
  return {
    supported: () => true,
    save: vi.fn(() => Promise.resolve()),
    load: vi.fn((): Promise<File | undefined> => Promise.resolve(undefined)),
    remove: vi.fn<VideoStorage["remove"]>(() => Promise.resolve()),
    list: () => Promise.resolve([]),
    estimate: () => Promise.resolve({}),
    persist: () => Promise.resolve(true),
  } satisfies VideoStorage;
}

function setup(overrides: Partial<VideoPanelDeps> = {}): void {
  images = createImageCleanup(state, {
    store,
    tabs: aloneTabs,
    onVideosFreed: (keys) => void copies.releaseWaiting(keys),
  });
  videos = panel({ images, ...overrides });
  const { status } = spies;
  copies = initVideoCopies(els, state, {
    store,
    status,
    confirm: () => true,
    isHeld: (key) => images.holdsVideo(key),
    onProgress: vi.fn(),
    storage,
  });
  removal = initVideoRemoval(state, {
    store,
    status,
    toast,
    images,
    conversation: { showAll, stopChecks },
    video: videos,
    isStudying: (chatId) => studying === chatId,
    onFinal: releaseCopies,
    onChanged: vi.fn(),
  });
}

function releaseCopies(keys: readonly string[]): void {
  for (const key of keys) void copies.release(key);
}

async function sent(
  file: File,
  id: string,
  extra: Partial<UserMessage> = {},
  fileHandle?: FileSystemFileHandle,
): Promise<void> {
  await videos.attach(file, fileHandle);
  await send(videos);
  const createdAt = state.messages.length + 1;
  const message = user(id, `about ${file.name}`, {
    createdAt,
    video: attachmentFor(file),
    ...extra,
  });
  await store.putMessage("chat", message);
  upsertMessage(state, message);
}

async function expireUndo(): Promise<void> {
  timers.splice(0).forEach((run) => run());
  await settle();
}

async function undo(): Promise<void> {
  els.toast.action.click();
  await settle();
}

function message(id: string): UserMessage | undefined {
  const found = state.messages.find((entry) => entry.id === id);
  return found?.role === "user" ? found : undefined;
}

async function storedMessage(id: string): Promise<unknown> {
  return (await store.listMessages("chat")).find((entry) => entry.id === id);
}

beforeEach(async () => {
  await resetVideoPanel();
  timers = [];
  toast = initToast(els, { set: (run) => timers.push(run), clear: vi.fn() });
  storage = makeStorage();
  studying = undefined;
  show.mockClear();
  stopChecks.mockClear();
  setModels(state, [model(MODEL)]);
  setup();
});

afterEach(cleanUpVideoPanel);

describe("removing the chat's video", () => {
  it("takes the player, the tools, the facts and the handle from the chat", async () => {
    await sent(BEACH, "u1", {}, handle);
    await updateChat(state, store, "chat", (chat) => ({
      ...chat,
      sceneLog: [{ timeSeconds: 1, text: "Waves" }],
    }));
    videos.openPlayer(1);
    expect(toolContext(state, store)).toBeDefined();
    await removal.remove(beach.fileKey);
    const chat = state.currentChat;
    if (!chat) throw new Error("No chat");
    expect(chat.video).toBeUndefined();
    expect(await store.getChat("chat")).toEqual(chat);
    expect(state.video).toBeNull();
    expect(toolContext(state, store)).toBeUndefined();
    expect(buildSystemPrompt(chat, "")).not.toContain("beach.mp4");
    expect(chat.sceneLog).toEqual([]);
    expect(els.miniPlayer.el.hidden).toBe(true);
    expect(els.video.chip.hidden).toBe(true);
    expect(videos.view()).toEqual({ video: undefined, url: null });
    expect(await store.getVideoHandle("chat")).toBeUndefined();
    expect(stopChecks).toHaveBeenCalled();
  });

  it("keeps the messages with their text and sheets, naming the video as removed", async () => {
    const refs: ImageRef[] = [sheet("s1", 0, 1)];
    await sent(BEACH, "u1", { images: refs });
    await removal.remove(beach.fileKey);
    expect(message("u1")).toEqual(
      user("u1", "about beach.mp4", { createdAt: 1, images: refs, removedVideo: beach }),
    );
    expect(await storedMessage("u1")).toEqual(message("u1"));
    expect(show).toHaveBeenCalledWith(message("u1"));
  });

  it("keeps what was seen of its sheets with them, and through Undo", async () => {
    const images: ImageRef[] = [sheet("s1", 0, 1)];
    const seen = [described(["s1"], "Waves.")];
    await sent(BEACH, "u1", { images, seen });
    await removal.remove(beach.fileKey);
    expect(await storedMessage("u1")).toMatchObject({ images, seen, removedVideo: beach });
    await undo();
    expect(await storedMessage("u1")).toMatchObject({ images, seen, video: beach });
    expect(message("u1")).toEqual(await storedMessage("u1"));
  });

  it("keeps what is seen of its sheets after it was removed, through Undo", async () => {
    const images: ImageRef[] = [sheet("s1", 0, 1)];
    const seen = [described(["s1"], "Waves.")];
    await sent(BEACH, "u1", { images });
    await removal.remove(beach.fileKey);
    const removed = message("u1");
    if (!removed) throw new Error("No message");
    const looked = { ...removed, seen };
    upsertMessage(state, looked);
    await store.putMessage("chat", looked);
    await undo();
    expect(await storedMessage("u1")).toMatchObject({ images, seen, video: beach });
  });

  it("says a moment in it is gone, until the same video is attached again", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    videos.seek(5, beach);
    expect(spies.status.show).toHaveBeenLastCalledWith(
      "That moment is in beach.mp4, which was removed from this chat. Attach it again to jump there.",
    );
    expect(els.miniPlayer.el.hidden).toBe(true);
    await sent(BEACH, "u2");
    videos.seek(5, beach);
    expect(els.miniPlayer.el.hidden).toBe(false);
  });

  it("keeps a video waiting in the message box", async () => {
    await sent(BEACH, "u1");
    await videos.attach(DUNES);
    await removal.remove(beach.fileKey);
    expect(pendingVideo(currentPending(state))).toEqual(dunes);
    expect(els.video.chipName.textContent).toBe("dunes.mp4");
  });

  it("does nothing for a video the chat does not have", async () => {
    await sent(BEACH, "u1");
    await removal.remove(dunes.fileKey);
    expect(state.currentChat?.video).toEqual(beach);
    expect(els.toast.el.hidden).toBe(true);
  });
});

describe("work on the removed video", () => {
  it("stops its background audio", async () => {
    const signals: AbortSignal[] = [];
    const analyseAudio = vi.fn<AnalyseAudio>((_file, _request, _speech, { signal }) => {
      if (signal) signals.push(signal as AbortSignal);
      return new Promise(() => undefined);
    });
    setup({ audioWanted: () => true, analyseAudio });
    await sent(BEACH, "u1");
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]?.aborted).toBe(false);
    await removal.remove(beach.fileKey);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("drops an overview still being prepared", async () => {
    const rendered = deferred<ImageRef[]>();
    setup({ renderOverview: () => rendered.promise });
    await sent(BEACH, "u1");
    expect(videos.overviewRendering()).toBe(true);
    await removal.remove(beach.fileKey);
    expect(videos.overviewRendering()).toBe(false);
    rendered.resolve([sheet("s1", 0, 1)]);
    await settle();
    expect(spies.onOverview).not.toHaveBeenCalled();
    expect(state.overviews.get("chat")).toBeUndefined();
  });
});

describe("a chat that has had several videos", () => {
  beforeEach(async () => {
    await sent(BEACH, "u1");
    await sent(DUNES, "u2");
  });

  it("removes an earlier one and leaves the current one loaded", async () => {
    await removal.remove(beach.fileKey);
    expect(message("u1")?.removedVideo).toEqual(beach);
    expect(message("u2")?.video).toEqual(dunes);
    expect(state.currentChat?.video).toEqual(dunes);
    expect(state.video?.file).toBe(DUNES);
    expect(stopChecks).not.toHaveBeenCalled();
    await expireUndo();
    expect(storage.remove.mock.calls).toEqual([[beach.fileKey]]);
  });

  it("removes the current one and leaves the earlier one playable, but not current", async () => {
    await removal.remove(dunes.fileKey);
    expect(message("u1")?.video).toEqual(beach);
    expect(message("u2")?.removedVideo).toEqual(dunes);
    expect(state.currentChat?.video).toBeUndefined();
    await expireUndo();
    expect(storage.remove.mock.calls).toEqual([[dunes.fileKey]]);
    videos.seek(3, beach);
    await settle();
    expect(els.miniPlayer.el.hidden).toBe(false);
    expect(els.miniPlayer.title.textContent).toBe("beach.mp4");
  });

  it("closes a player showing the earlier one", async () => {
    videos.seek(3, beach);
    await settle();
    expect(els.miniPlayer.el.hidden).toBe(false);
    await removal.remove(beach.fileKey);
    expect(els.miniPlayer.el.hidden).toBe(true);
  });

  it("brings back only the earlier one with Undo", async () => {
    await removal.remove(beach.fileKey);
    await undo();
    expect(message("u1")?.video).toEqual(beach);
    expect(await storedMessage("u1")).toEqual(message("u1"));
    expect(state.currentChat?.video).toEqual(dunes);
  });
});

describe("the stored copy", () => {
  it("is deleted only once Undo has gone", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    await settle();
    expect(els.toast.text.textContent).toBe("Removed beach.mp4 from this chat");
    expect(storage.remove).not.toHaveBeenCalled();
    await expireUndo();
    expect(storage.remove.mock.calls).toEqual([[beach.fileKey]]);
  });

  it("is kept after Undo", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    await undo();
    await expireUndo();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("is kept while another chat or one of its messages has the video", async () => {
    await sent(BEACH, "u1");
    await store.putChat(blankChat(MODEL, "other", 1));
    await store.putMessage("other", user("o1", "hi", { video: beach }));
    await removal.remove(beach.fileKey);
    await expireUndo();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("is kept when the same video waits to be sent again", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    await videos.attach(BEACH);
    await expireUndo();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("goes once the same video, left waiting to be sent, is taken out too", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    await videos.attach(BEACH);
    await expireUndo();
    await videos.attach(DUNES);
    await settle();
    expect(storage.remove.mock.calls).toEqual([[beach.fileKey]]);
  });

  it("goes when a new turn ends the Undo", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    removal.invalidateUndo();
    await settle();
    expect(els.toast.el.hidden).toBe(true);
    expect(storage.remove.mock.calls).toEqual([[beach.fileKey]]);
  });
});

describe("the stored copy while several Undos need it", () => {
  async function seedChat(id: string, video: VideoAttachment): Promise<Chat> {
    const chat = { ...blankChat(MODEL, id, 1), title: id, video };
    await store.putChat(chat);
    replaceChat(state, chat);
    return chat;
  }

  async function open(id: string): Promise<void> {
    const chat = state.chats.find((entry) => entry.id === id) ?? null;
    setCurrentChat(state, chat, await store.listMessages(id));
    await videos.restore();
  }

  function sidebar(): void {
    initSidebar(els, state, {
      store,
      status: spies.status,
      toast,
      images,
      onOpen: vi.fn(),
      onDeletingCurrent: vi.fn(),
      onCurrentDeleted: vi.fn(),
      onDeleted: vi.fn(),
      onDeleteFinal: releaseCopies,
      onRenamed: vi.fn(),
      onOpenSettings: vi.fn(),
      onFocusComposer: vi.fn(),
    });
  }

  async function deleteChat(id: string): Promise<void> {
    const item = els.sidebar.chatList.querySelector(`[data-chat-id="${id}"]`);
    item?.querySelector<HTMLElement>(".chat-delete")?.click();
    await vi.waitFor(() => expect(els.toast.text.textContent).toBe(`Deleted "${id}"`));
    await settle();
  }

  const first: Record<string, () => Promise<void>> = {
    "a removal": async () => {
      await open("a");
      await removal.remove(beach.fileKey);
      await settle();
    },
    "a chat's deletion": () => deleteChat("a"),
  };
  const second: Record<string, () => Promise<void>> = {
    "a removal": async () => {
      await open("b");
      await removal.remove(beach.fileKey);
      await settle();
    },
    "a chat's deletion": () => deleteChat("b"),
  };
  const pairs = Object.keys(first).flatMap((one) => Object.keys(second).map((two) => [one, two]));

  beforeEach(async () => {
    await seedChat("a", beach);
    await seedChat("b", beach);
    sidebar();
  });

  it.each(pairs)("outlasts %s, then goes with %s", async (one = "", two = "") => {
    await first[one]?.();
    await second[two]?.();
    expect(storage.remove).not.toHaveBeenCalled();
    await expireUndo();
    expect(storage.remove).toHaveBeenCalledWith(beach.fileKey);
  });

  it.each(pairs)("outlasts %s and stays for the Undo of %s", async (one = "", two = "") => {
    await first[one]?.();
    await second[two]?.();
    await undo();
    await expireUndo();
    expect(storage.remove).not.toHaveBeenCalled();
    expect((await store.getChat("b"))?.video).toEqual(beach);
  });

  it("goes when the last to need it is neither, whichever way that ends", async () => {
    for (const end of ["letGo", "final"] as const) {
      storage.remove.mockClear();
      const other = images.hold({ videoKeys: [beach.fileKey] });
      await store.deleteChat("b");
      await first["a removal"]?.();
      await expireUndo();
      expect(storage.remove).not.toHaveBeenCalled();
      other[end]();
      await settle();
      expect(storage.remove.mock.calls).toEqual([[beach.fileKey]]);
      await seedChat("a", beach);
    }
  });
});

describe("a removed video no message names", () => {
  beforeEach(async () => {
    await sent(BEACH, "u1");
    const reply = { ...assistant("a1", "She waves at [0:05]"), createdAt: 2 };
    await store.deleteMessages("chat", ["u1"]);
    await store.putMessage("chat", reply);
    const chat = state.currentChat;
    if (chat) setCurrentChat(state, chat, [reply]);
    await videos.restore();
    await removal.remove(beach.fileKey);
  });

  function seekFromReply(): void {
    const { currentChat: chat, messages } = state;
    videos.seek(5, videoForMessage(messages, "a1", chat?.video, chat?.removedVideos));
  }

  const refused =
    "That moment is in beach.mp4, which was removed from this chat. Attach it again to jump there.";

  it("is not played in place of one waiting to be sent, or one sent later", async () => {
    seekFromReply();
    expect(spies.status.show).toHaveBeenLastCalledWith(refused);
    await videos.attach(DUNES);
    spies.status.show.mockClear();
    seekFromReply();
    expect(spies.status.show).toHaveBeenLastCalledWith(refused);
    await sent(DUNES, "u2", { createdAt: 3 });
    spies.status.show.mockClear();
    seekFromReply();
    expect(spies.status.show).toHaveBeenLastCalledWith(refused);
    expect(els.miniPlayer.el.hidden).toBe(true);
  });

  it("plays again once attached again", async () => {
    await sent(BEACH, "u2", { createdAt: 3 });
    seekFromReply();
    expect(els.miniPlayer.el.hidden).toBe(false);
    expect(els.miniPlayer.title.textContent).toBe("beach.mp4");
  });

  it("leaves nothing behind after Undo", async () => {
    expect(state.currentChat?.removedVideos).toHaveLength(1);
    await undo();
    expect(state.currentChat).not.toHaveProperty("removedVideos");
    expect(await store.getChat("chat")).not.toHaveProperty("removedVideos");
    expect(state.messages).toHaveLength(1);
    seekFromReply();
    expect(els.miniPlayer.el.hidden).toBe(false);
  });

  it("keeps the record of an earlier removal when a later one is undone", async () => {
    await expireUndo();
    await sent(DUNES, "u2", { createdAt: 3 });
    await removal.remove(dunes.fileKey);
    expect(state.currentChat?.removedVideos?.map(({ video }) => video)).toEqual([beach, dunes]);
    await undo();
    expect(state.currentChat?.removedVideos?.map(({ video }) => video)).toEqual([beach]);
  });
});

describe("cached sheets and knowledge", () => {
  it("keeps the sheets messages show and drops the cached rest once Undo has gone", async () => {
    const [shown, cached] = [await saveImage(store), await saveImage(store)];
    await sent(BEACH, "u1", { images: [sheet(shown, 0, 1)] });
    const key = sheetCacheKey(beach.fileKey, { frameCount: 4 });
    await store.putSheets(key, [sheet(shown, 0, 1), sheet(cached, 1, 2)]);
    await removal.remove(beach.fileKey);
    await images.release({ videoKeys: [beach.fileKey] });
    expect(await store.getSheets(key)).toHaveLength(2);
    await expireUndo();
    expect(await store.getSheets(key)).toBeUndefined();
    expect(await isStored(store, shown)).toBe(true);
    expect(await isStored(store, cached)).toBe(false);
    expect(await images.countToDelete()).toMatchObject({ counted: { images: [] } });
  });

  it("keeps the timeline, people and audio saved for the video", async () => {
    const { fileKey: key } = beach;
    const timeline = { modelId: "m", entries: [], nextWindow: 1, windowCount: 1, updatedAt: 1 };
    await store.putTimeline({ fileKey: key, ...timeline });
    await store.putCast({ fileKey: key, cards: [], updatedAt: 1 });
    await sent(BEACH, "u1");
    await removal.remove(key);
    await expireUndo();
    expect(await store.getTimeline(key)).toBeDefined();
    expect(await store.getCast(key)).toBeDefined();
  });
});

describe("Undo", () => {
  it("brings back the video, its file, its handle and the scene log", async () => {
    await sent(BEACH, "u1", {}, handle);
    const note = { timeSeconds: 1, text: "Waves" };
    await updateChat(state, store, "chat", (chat) => ({ ...chat, sceneLog: [note] }));
    const before = state.currentChat;
    await removal.remove(beach.fileKey);
    await undo();
    expect(state.currentChat).toEqual(before);
    expect(await store.getChat("chat")).toEqual(before);
    expect(message("u1")).toEqual(user("u1", "about beach.mp4", { createdAt: 1, video: beach }));
    expect(await storedMessage("u1")).toEqual(message("u1"));
    expect(state.video?.file).toBe(BEACH);
    expect(videos.view()).toEqual({ video: beach, url: "blob:video" });
    expect(await store.getVideoHandle("chat")).toBe(handle);
    expect(show).toHaveBeenLastCalledWith(message("u1"));
    expect(await images.countToDelete()).toHaveProperty("counted");
  });

  it("keeps what was changed in the meantime", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    const edited = { ...user("u1", "edited", { createdAt: 1 }), removedVideo: beach };
    await store.putMessage("chat", edited);
    upsertMessage(state, edited);
    await updateChat(state, store, "chat", (chat) => ({ ...chat, title: "Renamed" }));
    await undo();
    expect(message("u1")?.text).toBe("edited");
    expect(message("u1")?.video).toEqual(beach);
    expect(state.currentChat?.title).toBe("Renamed");
  });

  it("works from another chat, and the file is there on returning", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    await openOther(videos, "new", MODEL);
    await undo();
    expect(state.currentChat?.id).toBe("new");
    expect(state.video).toBeNull();
    const chat = await store.getChat("chat");
    expect(chat?.video).toEqual(beach);
    if (chat) setCurrentChat(state, chat, await store.listMessages("chat"));
    await videos.restore();
    expect(message("u1")?.video).toEqual(beach);
    expect(state.video?.file).toBe(BEACH);
  });

  it("takes the place of the same video dropped again but not sent", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    await videos.attach(BEACH);
    addPending(state, "chat", { kind: "overview", refs: [sheet("s1", 0, 1)] });
    await undo();
    expect(currentPending(state)).toEqual([]);
    expect(state.currentChat?.video).toEqual(beach);
  });

  it("never replaces a video sent since", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    await sent(DUNES, "u2");
    await undo();
    expect(state.currentChat?.video).toEqual(dunes);
    expect(message("u1")?.removedVideo).toEqual(beach);
    expect(storage.remove.mock.calls).toEqual([[beach.fileKey]]);
  });

  it("holds off the deletion of unused images while it is open", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    expect(await images.countToDelete()).toEqual({ refused: "undo" });
  });
});

describe("when a video cannot be removed", () => {
  it("says to wait while a reply runs in the chat", async () => {
    await sent(BEACH, "u1");
    setRunning(state, true);
    expect(removal.blocker()).toBe("Stop or wait for the reply before removing the video.");
    await removal.remove(beach.fileKey);
    expect(state.currentChat?.video).toEqual(beach);
    expect(spies.status.show).toHaveBeenLastCalledWith(removal.blocker(), "error");
  });

  it("says to wait while a study runs for the chat, but not for another", async () => {
    await sent(BEACH, "u1");
    studying = "other";
    expect(removal.blocker()).toBeUndefined();
    studying = "chat";
    expect(removal.blocker()).toBe("Stop or wait for the study before removing the video.");
    await removal.remove(beach.fileKey);
    expect(state.currentChat?.video).toEqual(beach);
  });

  it("waits for the handle's deletion before it puts one back", async () => {
    await sent(BEACH, "u1", {}, handle);
    const reading = deferred<void>();
    const read = store.getVideoHandle.bind(store);
    vi.spyOn(store, "getVideoHandle").mockImplementationOnce(async (id) => {
      await reading.promise;
      return read(id);
    });
    vi.spyOn(store, "putMessage").mockRejectedValueOnce(new Error("disk full"));
    const removing = removal.remove(beach.fileKey);
    await settle();
    reading.resolve();
    await expect(removing).rejects.toThrow("disk full");
    await settle();
    expect(await store.getVideoHandle("chat")).toBe(handle);
    expect(state.currentChat?.video).toEqual(beach);
  });

  it("puts everything back when saving fails", async () => {
    await sent(BEACH, "u1", {}, handle);
    vi.spyOn(store, "putMessage").mockRejectedValueOnce(new Error("disk full"));
    await expect(removal.remove(beach.fileKey)).rejects.toThrow("disk full");
    expect(state.currentChat?.video).toEqual(beach);
    expect(message("u1")?.video).toEqual(beach);
    expect(await store.getVideoHandle("chat")).toBe(handle);
    expect(state.video?.file).toBe(BEACH);
    expect(els.toast.el.hidden).toBe(true);
    expect(await images.countToDelete()).toHaveProperty("counted");
  });
});

describe("attaching the same video again", () => {
  it("adds a new slot beside the removed line, and loads the file", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    await expireUndo();
    await sent(BEACH, "u2");
    expect(message("u1")?.removedVideo).toEqual(beach);
    expect(message("u2")?.video).toEqual(beach);
    expect(state.currentChat?.video).toEqual(beach);
    expect(toolContext(state, store)?.file).toBe(BEACH);
  });

  it("can be removed again, leaving the other line as it is", async () => {
    await sent(BEACH, "u1");
    await removal.remove(beach.fileKey);
    await sent(BEACH, "u2");
    await removal.remove(beach.fileKey);
    await undo();
    expect(message("u1")?.video).toBeUndefined();
    expect(message("u2")?.video).toEqual(beach);
  });

  it("is not reopened as the chat's own by a reattach that was still reading the file", async () => {
    await sent(BEACH, "u1");
    const changed = video("beach.mp4", 9);
    const probed = deferred<void>();
    const probe: VideoPanelDeps["probe"] = async (file) => {
      await probed.promise;
      return { attachment: attachmentFor(file), info: { ...attachmentFor(file) } };
    };
    setup({ probe, loadCopy: () => Promise.resolve(changed) });
    const restoring = videos.restore();
    await settle();
    await removal.remove(beach.fileKey);
    probed.resolve();
    await restoring;
    expect(fileKey(changed)).not.toBe(beach.fileKey);
    expect(state.currentChat?.video).toBeUndefined();
  });
});

describe("a restore still under way when the video is removed", () => {
  const granted = (file: File) => ({
    ...handle,
    queryPermission: () => Promise.resolve("granted" as const),
    getFile: vi.fn(() => Promise.resolve(file)),
  });

  async function openWithHandle(saved: FileSystemFileHandle): Promise<void> {
    const chat = { ...blankChat(MODEL, "chat", 1), video: beach };
    await store.putChat(chat);
    await store.putVideoHandle("chat", saved);
    replaceChat(state, chat);
    setCurrentChat(state, chat, []);
  }

  it("does not take a reattach for the video sent in its place", async () => {
    await sent(BEACH, "u1");
    const changed = video("beach.mp4", 9);
    const probed = deferred<void>();
    const probe = vi.fn(async (file: File) => {
      if (file === changed) await probed.promise;
      return { attachment: attachmentFor(file), info: { ...attachmentFor(file) } };
    });
    setup({ probe, loadCopy: () => Promise.resolve(changed) });
    const restoring = videos.restore();
    await settle();
    await removal.remove(beach.fileKey);
    await sent(DUNES, "u2");
    probed.resolve();
    await restoring;
    expect(state.currentChat?.video).toEqual(dunes);
    expect(state.video?.file).toBe(DUNES);
  });

  it("loads nothing once a changed file's reattach is saved", async () => {
    const changed = video("beach.mp4", 9);
    await sent(BEACH, "u1");
    setup({ loadCopy: () => Promise.resolve(changed) });
    const saving = deferred<void>();
    const put = store.putChat.bind(store);
    vi.spyOn(store, "putChat").mockImplementationOnce(async (chat) => {
      await saving.promise;
      await put(chat);
    });
    const restoring = videos.restore();
    await settle();
    expect(state.currentChat?.video).toEqual(attachmentFor(changed));
    const removing = removal.remove(attachmentFor(changed).fileKey);
    saving.resolve();
    await Promise.all([restoring, removing]);
    expect(state.currentChat?.video).toBeUndefined();
    expect(state.video).toBeNull();
    expect(videos.view().url).toBeNull();
  });

  it("loads nothing once the handle of the same file dropped again is saved", async () => {
    await sent(BEACH, "u1");
    const saving = deferred<void>();
    vi.spyOn(store, "putVideoHandle").mockImplementationOnce(() => saving.promise);
    const attaching = videos.attach(BEACH, handle);
    await removal.remove(beach.fileKey);
    saving.resolve();
    await attaching;
    expect(state.video).toBeNull();
  });

  it("leaves the saved handle usable after Undo, and says nothing", async () => {
    const asked = deferred<void>();
    const saved = granted(BEACH);
    saved.getFile.mockImplementationOnce(async () => {
      await asked.promise;
      throw new DOMException("moved", "NotFoundError");
    });
    await openWithHandle(saved);
    const restoring = videos.restore();
    await settle();
    await removal.remove(beach.fileKey);
    spies.status.show.mockClear();
    asked.resolve();
    await restoring;
    expect(spies.status.show).not.toHaveBeenCalled();
    await undo();
    await settle();
    expect(state.video?.file).toBe(BEACH);
  });

  it("forgets with Undo that the handle was passed over", async () => {
    const saved = granted(video("renamed.mp4"));
    await openWithHandle(saved);
    await videos.restore();
    expect(state.video).toBeNull();
    saved.getFile.mockResolvedValue(BEACH);
    await removal.remove(beach.fileKey);
    await undo();
    await settle();
    expect(state.video?.file).toBe(BEACH);
  });

  it("drops a refused reattach begun from the chip", async () => {
    const asked = deferred<PermissionState>();
    const saved = { ...granted(BEACH), requestPermission: () => asked.promise };
    await openWithHandle(saved);
    const reattaching = videos.reattach();
    await settle();
    await removal.remove(beach.fileKey);
    spies.status.show.mockClear();
    asked.resolve("denied");
    await reattaching;
    expect(spies.status.show).not.toHaveBeenCalled();
  });
});
