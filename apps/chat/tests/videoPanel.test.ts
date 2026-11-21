import type { AudioAnalysisOptions, AudioAnalysisRequest, AudioTrack } from "@vid2grid/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyseAudio } from "../src/audio/videoAudio";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  addPending,
  blankChat,
  clearPending,
  createAppState,
  currentPending,
  pendingFor,
  pendingVideo,
  removePendingVideo,
  replaceChat,
  setCurrentChat,
  setRunning,
  updateChat,
  type AppState,
} from "../src/state";
import type { Chat, ChatStore, ImageRef, VideoAttachment } from "../src/types";
import { initVideoPanel, type VideoPanel, type VideoPanelDeps } from "../src/ui/videoPanel";
import { fileKey, type RenderedSheet } from "../src/video/render";
import type { ToolContext } from "../src/video/tools";
import { mountPage } from "./support/page";

const INFO = { durationSeconds: 60, width: 640, height: 360 };
const MODEL = "vision-model";

let els: AppElements;
let state: AppState;
let store: ChatStore;
let spies: ReturnType<typeof makeSpies>;

function attachmentFor(file: File): VideoAttachment {
  return { name: file.name, fileKey: fileKey(file), ...INFO };
}

function makeSpies() {
  return {
    status: { show: vi.fn(), clear: vi.fn() },
    onChatChanged: vi.fn(),
    onVideoChanged: vi.fn(),
    onOverview: vi.fn(),
    onOverviewProgress: vi.fn(),
    studyStatus: () => "",
    copyStatus: () => "",
    loadCopy: vi.fn((): Promise<File | undefined> => Promise.resolve(undefined)),
    onAttached: vi.fn(),
    onCommitted: vi.fn(),
    probe: vi.fn((file: File) => Promise.resolve({ attachment: attachmentFor(file), info: INFO })),
    renderOverview: vi.fn(freshOverview),
    renderSheets: vi.fn(() => Promise.resolve<RenderedSheet[]>([])),
    readFrameTimes: vi.fn<(file: File) => Promise<number[] | undefined>>(() =>
      Promise.resolve(undefined),
    ),
  };
}

// Goes through the context's renderer, as a cache miss does, so the overview counts as new.
async function freshOverview(toolCtx: ToolContext): Promise<ImageRef[]> {
  await toolCtx.render?.(toolCtx.file, toolCtx.info, {});
  return [];
}

// What the composer does on send: the video becomes the chat's, then the pending items clear.
async function send(videos: VideoPanel, chatId = "chat"): Promise<void> {
  const video = pendingVideo(pendingFor(state, chatId));
  if (!video) throw new Error("Nothing pending");
  await videos.commit(chatId, video);
  clearPending(state, chatId);
  videos.render();
}

async function attachAndSend(
  videos: VideoPanel,
  file: File,
  handle?: FileSystemFileHandle,
): Promise<void> {
  await videos.attach(file, handle);
  await send(videos);
}

async function openOther(videos: VideoPanel, id: string, modelId: string): Promise<void> {
  const other = blankChat(modelId, id, 2);
  await store.putChat(other);
  replaceChat(state, other);
  setCurrentChat(state, other, []);
  await videos.restore();
}

function panel(overrides: Partial<VideoPanelDeps> = {}): VideoPanel {
  return initVideoPanel(els, state, { store, ...spies, ...overrides });
}

function video(name: string, size = 3): File {
  return new File(["x".repeat(size)], name, { type: "video/mp4", lastModified: 5 });
}

function handleFor(file: File | Error, permission: PermissionState = "granted") {
  return {
    kind: "file",
    name: file instanceof File ? file.name : "gone.mp4",
    getFile: vi.fn(() => (file instanceof File ? Promise.resolve(file) : Promise.reject(file))),
    queryPermission: vi.fn(() => Promise.resolve(permission)),
    requestPermission: vi.fn(() => Promise.resolve(permission)),
  } as unknown as FileSystemFileHandle;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function openChatWithVideo(attachment: VideoAttachment): Promise<Chat> {
  const chat = { ...blankChat(MODEL, "chat", 1), video: attachment };
  await store.putChat(chat);
  replaceChat(state, chat);
  setCurrentChat(state, chat, []);
  return chat;
}

beforeEach(async () => {
  els = mountPage();
  state = createAppState({ ...DEFAULT_SETTINGS, apiKey: "key" });
  store = createMemoryStore();
  spies = makeSpies();
  const chat = blankChat(MODEL, "chat", 1);
  await store.putChat(chat);
  replaceChat(state, chat);
  setCurrentChat(state, chat, []);
  URL.createObjectURL = vi.fn(() => "blob:video");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.showOpenFilePicker;
});

describe("attaching", () => {
  it("holds the dropped video in the message, saving it and its handle to the chat on send", async () => {
    const probed = deferred<{ attachment: VideoAttachment; info: typeof INFO }>();
    const file = video("beach.mp4");
    const handle = handleFor(file);
    const videos = panel({ probe: () => probed.promise });
    const attaching = videos.attach(file, handle);
    await Promise.resolve();
    probed.resolve({ attachment: attachmentFor(file), info: INFO });
    await attaching;
    expect(currentPending(state)[0]).toEqual({ kind: "video", video: attachmentFor(file) });
    expect(els.video.chip.hidden).toBe(false);
    expect(els.video.chipName.textContent).toBe("beach.mp4");
    expect(state.currentChat?.video).toBeUndefined();
    expect(await store.getVideoHandle("chat")).toBeUndefined();
    await send(videos);
    expect(await store.getVideoHandle("chat")).toBe(handle);
    expect(state.currentChat?.video?.name).toBe("beach.mp4");
    expect((await store.getChat("chat"))?.video?.name).toBe("beach.mp4");
    expect(state.video?.file).toBe(file);
    expect(els.video.chipName.textContent).toBe("beach.mp4");
  });

  it("keeps no handle when the probe fails", async () => {
    const file = video("broken.mp4");
    await panel({ probe: () => Promise.reject(new Error("bad file")) }).attach(
      file,
      handleFor(file),
    );
    expect(await store.getVideoHandle("chat")).toBeUndefined();
    expect(spies.status.show).toHaveBeenLastCalledWith(
      "Could not read broken.mp4: bad file",
      "error",
    );
  });

  it("refuses to change the video while a turn is running", async () => {
    setRunning(state, true);
    await panel().attach(video("beach.mp4"));
    expect(state.currentChat?.video).toBeUndefined();
    expect(spies.status.show).toHaveBeenCalledWith(
      expect.stringContaining("Stop or wait"),
      "error",
    );
  });
});

describe("attaching over a pending video", () => {
  it("drops an overview that finishes after its video was replaced", async () => {
    const first = deferred<ImageRef[]>();
    const second = deferred<ImageRef[]>();
    const renders = [first.promise, second.promise];
    const videos = panel({
      renderOverview: async (toolCtx) => {
        const refs = renders.shift() ?? Promise.resolve([]);
        await toolCtx.render?.(toolCtx.file, toolCtx.info, {});
        return refs;
      },
    });
    await videos.attach(video("one.mp4", 1));
    await videos.attach(video("two.mp4", 2));
    expect(pendingVideo(currentPending(state))).toEqual(attachmentFor(video("two.mp4", 2)));
    expect(els.video.chipMeta.textContent).toBe("1:00 · Rendering overview");
    const sheet: ImageRef = { id: "s", pinned: false, source: { kind: "upload", name: "s" } };
    first.resolve([sheet]);
    await vi.waitFor(() => expect(videos.overviewRendering()).toBe(true));
    await Promise.resolve();
    expect(spies.onOverview).not.toHaveBeenCalled();
    second.resolve([sheet, sheet]);
    await vi.waitFor(() => expect(spies.onOverview).toHaveBeenCalledWith("chat", [sheet, sheet]));
    expect(spies.onOverview).toHaveBeenCalledTimes(1);
    expect(els.video.chipMeta.textContent).toBe("1:00");
  });
});

describe("replacing the video", () => {
  it("forgets the old handle once a picked file without one is sent in its place", async () => {
    const first = video("one.mp4", 1);
    const handle = handleFor(first);
    const videos = panel();
    await attachAndSend(videos, first, handle);
    await videos.attach(video("two.mp4", 2));
    expect(await store.getVideoHandle("chat")).toBe(handle);
    await send(videos);
    expect(await store.getVideoHandle("chat")).toBeUndefined();
    expect(state.currentChat?.video?.name).toBe("two.mp4");
  });

  it("asks nothing when a dropped video takes the place of the chat's video", async () => {
    const ask = vi.spyOn(window, "confirm");
    const videos = panel();
    await attachAndSend(videos, video("one.mp4", 1));
    await videos.attach(video("two.mp4", 2));
    expect(ask).not.toHaveBeenCalled();
    expect(els.video.chipName.textContent).toBe("two.mp4");
  });
});

describe("removing a pending video before sending", () => {
  it("leaves the chat exactly as it was: its video, file handle and scene log", async () => {
    const own = video("own.mp4", 1);
    const handle = handleFor(own);
    const videos = panel({
      onOverview: (chatId, refs) => addPending(state, chatId, { kind: "overview", refs }),
    });
    await videos.attach(own, handle);
    await vi.waitFor(() => expect(currentPending(state)).toHaveLength(2));
    await send(videos);
    const note = { timeSeconds: 3, text: "a door opens" };
    await updateChat(state, store, "chat", (chat) => ({ ...chat, sceneLog: [note] }));
    const dropped = video("dropped.mp4", 2);
    await videos.attach(dropped);
    expect(els.video.chipName.textContent).toBe("dropped.mp4");
    await vi.waitFor(() => expect(currentPending(state)).toHaveLength(2));
    expect(currentPending(state).map((attachment) => attachment.kind)).toEqual([
      "video",
      "overview",
    ]);
    removePendingVideo(state, "chat");
    videos.render();
    expect(els.video.chipName.textContent).toBe("own.mp4");
    expect(state.currentChat?.video).toEqual(attachmentFor(own));
    expect(state.currentChat?.sceneLog).toEqual([note]);
    expect(await store.getVideoHandle("chat")).toBe(handle);
    expect(state.video?.file).toBe(own);
    expect(videos.pendingView().video).toBeUndefined();
  });

  it("clears the scene log when a different video is sent", async () => {
    const videos = panel();
    await attachAndSend(videos, video("own.mp4", 1));
    const note = { timeSeconds: 3, text: "a door opens" };
    await updateChat(state, store, "chat", (chat) => ({ ...chat, sceneLog: [note] }));
    await videos.attach(video("next.mp4", 2));
    expect(state.currentChat?.sceneLog).toEqual([note]);
    await send(videos);
    expect(state.currentChat?.sceneLog).toEqual([]);
  });

  it("closes the player when it was playing the removed video", async () => {
    let next = 0;
    URL.createObjectURL = vi.fn(() => `blob:video-${++next}`);
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    const videos = panel();
    await videos.attach(video("dropped.mp4", 2));
    videos.openPlayer(1);
    expect(els.video.miniPlayer.hidden).toBe(false);
    removePendingVideo(state, "chat");
    videos.render();
    expect(els.video.miniPlayer.hidden).toBe(true);
    expect(els.video.chip.hidden).toBe(true);
    expect(revoke).toHaveBeenCalledWith("blob:video-1");
  });
});

describe("sending a pending video", () => {
  it("changes nothing when saving the sent video fails", async () => {
    const videos = panel();
    await attachAndSend(videos, video("own.mp4", 1));
    const next = video("next.mp4", 2);
    await videos.attach(next);
    vi.spyOn(store, "putChat").mockRejectedValueOnce(new Error("quota"));
    await expect(videos.commit("chat", attachmentFor(next))).rejects.toThrow("quota");
    expect(state.currentChat?.video).toEqual(attachmentFor(video("own.mp4", 1)));
    expect((await store.getChat("chat"))?.video).toEqual(attachmentFor(video("own.mp4", 1)));
    expect(pendingVideo(currentPending(state))).toEqual(attachmentFor(next));
    expect(videos.pendingView().video).toEqual(attachmentFor(next));
    expect(spies.onCommitted).toHaveBeenCalledTimes(1);
  });
});

describe("dropping the same video into a new chat", () => {
  const firstChat = [
    ["after sending it in the first chat", true],
    ["while it still waits in the first chat", false],
  ] as const;

  for (const [when, sentInFirst] of firstChat) {
    it(`shows it pending and prepares its overview ${when}`, async () => {
      const file = video("beach.mp4");
      const videos = panel();
      if (sentInFirst) await attachAndSend(videos, file);
      else await videos.attach(file);
      await openOther(videos, "new", MODEL);
      await videos.attach(file);
      expect(pendingVideo(pendingFor(state, "new"))).toEqual(attachmentFor(file));
      expect(els.video.chip.hidden).toBe(false);
      expect(els.video.chipName.textContent).toBe("beach.mp4");
      expect(spies.renderOverview).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(spies.onOverview).toHaveBeenCalledWith("new", []));
      expect(state.chats.find((chat) => chat.id === "chat")?.video).toEqual(
        sentInFirst ? attachmentFor(file) : undefined,
      );
    });
  }
});

describe("dropping the same video into a new chat, when something is in the way", () => {
  it("is not blocked by a reply still running or stopping in the other chat", async () => {
    const file = video("beach.mp4");
    const videos = panel();
    await attachAndSend(videos, file);
    setRunning(state, true);
    await openOther(videos, "new", MODEL);
    await videos.attach(file);
    expect(pendingVideo(pendingFor(state, "new"))).toEqual(attachmentFor(file));
    expect(els.video.chip.hidden).toBe(false);
    expect(spies.status.show).not.toHaveBeenCalledWith(
      expect.stringContaining("Stop or wait"),
      "error",
    );
  });

  it("says a model is needed and prepares the overview once one is chosen", async () => {
    const file = video("beach.mp4");
    const videos = panel();
    await openOther(videos, "new", "");
    await videos.attach(file);
    expect(pendingVideo(pendingFor(state, "new"))).toEqual(attachmentFor(file));
    expect(els.video.chipMeta.textContent).toBe("1:00 · Choose a model to prepare the overview");
    expect(spies.status.show).toHaveBeenCalledWith("Choose a model to prepare the overview.");
    expect(spies.renderOverview).not.toHaveBeenCalled();
    await updateChat(state, store, "new", (chat) => ({
      ...chat,
      settings: { ...chat.settings, modelId: MODEL },
    }));
    videos.render();
    expect(spies.renderOverview).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(spies.onOverview).toHaveBeenCalledWith("new", []));
  });

  it("says when the overview is reused from before, and drops the note once sent", async () => {
    const file = video("beach.mp4");
    const videos = panel({ renderOverview: () => Promise.resolve([]) });
    await openOther(videos, "new", MODEL);
    await videos.attach(file);
    await vi.waitFor(() =>
      expect(els.video.chipMeta.textContent).toBe("1:00 · Seen before, overview reused"),
    );
    await send(videos, "new");
    expect(els.video.chipMeta.textContent).toBe("1:00");
  });
});

describe("a pending video's thumbnail", () => {
  it("never hands out another chat's URL before the panel renders", async () => {
    let next = 0;
    URL.createObjectURL = vi.fn(() => `blob:video-${++next}`);
    const videos = panel();
    await videos.attach(video("one.mp4", 1));
    const first = state.currentChat;
    await openOther(videos, "new", MODEL);
    await videos.attach(video("two.mp4", 2));
    expect(videos.pendingView().url).toBe("blob:video-2");
    setCurrentChat(state, first, []);
    expect(videos.pendingView()).toEqual({ video: attachmentFor(video("one.mp4", 1)), url: null });
    videos.render();
    expect(videos.pendingView().url).toBe("blob:video-3");
  });
});

describe("a new chat", () => {
  it("shows no video, player or pending items from the chat left behind", async () => {
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    const ref: ImageRef = { id: "i", pinned: false, source: { kind: "upload", name: "i" } };
    addPending(state, "chat", { kind: "image", ref });
    videos.openPlayer(1);
    expect(els.video.miniPlayer.hidden).toBe(false);
    await openOther(videos, "new", MODEL);
    expect(els.video.chip.hidden).toBe(true);
    expect(els.video.miniPlayer.hidden).toBe(true);
    expect(currentPending(state)).toEqual([]);
    expect(videos.view()).toEqual({ video: undefined, url: null });
    expect(videos.pendingView()).toEqual({ video: undefined, url: null });
    expect(pendingFor(state, "chat").map((attachment) => attachment.kind)).toEqual([
      "video",
      "image",
    ]);
  });
});

describe("stored copies", () => {
  it("reopens from a stored copy without touching the saved handle", async () => {
    const file = video("beach.mp4");
    await openChatWithVideo(attachmentFor(file));
    const queryPermission = vi.fn(() => Promise.resolve<PermissionState>("granted"));
    await store.putVideoHandle("chat", { ...handleFor(file), queryPermission });
    await panel({ loadCopy: () => Promise.resolve(file) }).restore();
    expect(state.video?.file).toBe(file);
    expect(queryPermission).not.toHaveBeenCalled();
    expect(els.video.chipMeta.textContent).toBe("1:00");
  });

  it("falls back to the saved handle, then to Reattach", async () => {
    const file = video("beach.mp4");
    await openChatWithVideo(attachmentFor(file));
    await store.putVideoHandle("chat", handleFor(file));
    await panel().restore();
    expect(spies.loadCopy).toHaveBeenCalledWith(fileKey(file));
    expect(state.video?.file).toBe(file);
  });

  it("falls through to the saved handle when the stored copy cannot be opened", async () => {
    const file = video("beach.mp4");
    const copy = video("beach.mp4", 9);
    await openChatWithVideo(attachmentFor(file));
    await store.putVideoHandle("chat", handleFor(file));
    const probe = vi.fn((picked: File) =>
      picked === copy
        ? Promise.reject(new Error("unreadable"))
        : Promise.resolve({ attachment: attachmentFor(picked), info: INFO }),
    );
    await panel({ loadCopy: () => Promise.resolve(copy), probe }).restore();
    expect(state.video?.file).toBe(file);
  });

  it("falls through when reattaching the stored copy throws", async () => {
    const file = video("beach.mp4");
    const copy = video("beach.mp4", 9);
    await openChatWithVideo(attachmentFor(file));
    await store.putVideoHandle("chat", handleFor(file));
    vi.spyOn(store, "putChat").mockRejectedValueOnce(new Error("quota"));
    await panel({ loadCopy: () => Promise.resolve(copy) }).restore();
    expect(state.video?.file).toBe(file);
  });

  it("asks about a copy on drop and reports the sent video with the one it replaced", async () => {
    const videos = panel();
    const first = video("one.mp4", 1);
    await attachAndSend(videos, first);
    expect(spies.onCommitted).toHaveBeenLastCalledWith(first, attachmentFor(first), undefined);
    const second = video("two.mp4", 2);
    await videos.attach(second);
    expect(spies.onAttached).toHaveBeenLastCalledWith(second, attachmentFor(second));
    expect(spies.onCommitted).toHaveBeenCalledTimes(1);
    await send(videos);
    expect(spies.onCommitted).toHaveBeenLastCalledWith(
      second,
      attachmentFor(second),
      attachmentFor(first),
    );
  });
});

describe("reopening without the file", () => {
  it("keeps the Reattach chip and says the browser needs permission again", async () => {
    const file = video("beach.mp4");
    await openChatWithVideo(attachmentFor(file));
    await store.putVideoHandle("chat", handleFor(file, "prompt"));
    await panel().restore();
    expect(els.video.chipMeta.textContent).toBe("Reattach");
    expect(spies.status.show).toHaveBeenCalledWith(
      "The browser needs your permission to read beach.mp4 again. Click Reattach on the video to open it.",
    );
  });

  it("says no copy was kept when there is no saved handle either", async () => {
    await openChatWithVideo(attachmentFor(video("beach.mp4")));
    await panel().restore();
    expect(els.video.chipMeta.textContent).toBe("Reattach");
    expect(spies.status.show).toHaveBeenCalledWith(
      expect.stringContaining("This browser kept no copy of beach.mp4."),
    );
  });
});

describe("reattaching", () => {
  it("falls back to Reattach when the saved file is gone on reopen", async () => {
    const attachment = attachmentFor(video("beach.mp4"));
    await openChatWithVideo(attachment);
    const gone = new DOMException("missing", "NotFoundError");
    await store.putVideoHandle("chat", handleFor(gone));
    await expect(panel().restore()).resolves.toBeUndefined();
    expect(els.video.chipMeta.textContent).toBe("Reattach");
    expect(spies.status.show).toHaveBeenCalledWith(expect.stringContaining("moved or renamed"));
  });

  it("opens the picker when the saved handle no longer leads to the file", async () => {
    const file = video("beach.mp4");
    await openChatWithVideo(attachmentFor(file));
    await store.putVideoHandle("chat", handleFor(new DOMException("missing", "NotFoundError")));
    const picked = handleFor(file);
    window.showOpenFilePicker = vi.fn(() => Promise.resolve([picked]));
    await panel().reattach();
    expect(window.showOpenFilePicker).toHaveBeenCalled();
    expect(state.video?.file).toBe(file);
    expect(await store.getVideoHandle("chat")).toBe(picked);
    expect(els.video.chipMeta.textContent).toBe("1:00");
  });

  it("asks for another click when permission is refused or the picker needs one", async () => {
    const file = video("beach.mp4");
    await openChatWithVideo(attachmentFor(file));
    await store.putVideoHandle("chat", handleFor(file, "denied"));
    const videos = panel();
    await videos.reattach();
    expect(spies.status.show).toHaveBeenLastCalledWith(
      expect.stringContaining("Click Reattach again"),
      "error",
    );
    window.showOpenFilePicker = vi.fn(() =>
      Promise.reject(new DOMException("no gesture", "SecurityError")),
    );
    await videos.reattach();
    expect(window.showOpenFilePicker).toHaveBeenCalled();
    expect(spies.status.show).toHaveBeenLastCalledWith(
      "Click Reattach again to choose the file.",
      "error",
    );
  });
});

describe("picking a file from the Reattach input", () => {
  it("reports a file that could not be attached", async () => {
    panel({
      onAttached: () => {
        throw new Error("quota");
      },
    });
    const input = els.video.reattachInput;
    Object.defineProperty(input, "files", { value: [video("beach.mp4")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(spies.status.show).toHaveBeenCalledWith("Could not attach beach.mp4: quota", "error"),
    );
  });
});

describe("cueing the mini-player", () => {
  it("cues a moment without playing, for a player behind the lightbox", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    play.mockClear();
    videos.cue(42);
    expect(els.video.miniPlayer.hidden).toBe(false);
    expect(els.video.miniPlayerVideo.currentTime).toBe(42);
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
  });
});

describe("mini-player", () => {
  it("opens the mini-player at a timestamp and closes it", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    videos.seek(42);
    expect(els.video.miniPlayer.hidden).toBe(false);
    expect(els.video.miniPlayerVideo.getAttribute("src")).toBe("blob:video");
    expect(els.video.miniPlayerTitle.textContent).toBe("beach.mp4");
    await vi.waitFor(() => expect(play).toHaveBeenCalled());
    els.video.miniPlayerClose.click();
    expect(els.video.miniPlayer.hidden).toBe(true);
  });

  it("offers a loop around a clicked timestamp but not when the video is popped out", async () => {
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    videos.openPlayer(10);
    expect(els.video.miniPlayerLoopAround.hidden).toBe(true);
    videos.seek(42);
    expect(els.video.miniPlayerLoopAround.hidden).toBe(false);
    expect(els.video.miniPlayerLoopAround.title).toBe("Loop 0:40.0 to 0:44.0 until turned off");
    els.video.miniPlayerLoopAround.click();
    expect(els.video.miniPlayerLoopRange.textContent).toBe("0:40.0 to 0:44.0");
    els.video.miniPlayerClose.click();
    expect(els.video.miniPlayerLoopAround.hidden).toBe(true);
    expect(els.video.miniPlayerLoopRange.hidden).toBe(true);
  });

  it("asks to reattach instead of opening a player with no file", async () => {
    await openChatWithVideo(attachmentFor(video("beach.mp4")));
    panel().seek(42);
    expect(els.video.miniPlayer.hidden).toBe(true);
    expect(spies.status.show).toHaveBeenCalledWith("Reattach the video to jump to 0:42.");
  });
});

describe("frame stepping", () => {
  it("steps between the frame times read from the renderer's own file", async () => {
    spies.readFrameTimes.mockResolvedValue([0, 0.5, 0.75, 2]);
    const file = video("beach.mp4");
    const videos = panel();
    await attachAndSend(videos, file);
    await settle();
    expect(spies.readFrameTimes).toHaveBeenCalledTimes(1);
    expect(spies.readFrameTimes.mock.calls[0]?.[0]).toBe(state.video?.file);
    videos.openPlayer(0.6);
    els.video.miniPlayerStepForward.click();
    expect(els.video.miniPlayerVideo.currentTime).toBeCloseTo(1.375);
  });

  it("drops the frame times when the video changes", async () => {
    spies.readFrameTimes.mockResolvedValueOnce([0, 0.5, 0.75, 2]);
    const videos = panel();
    await videos.attach(video("one.mp4", 1));
    await videos.attach(video("two.mp4", 2));
    await settle();
    videos.openPlayer(1);
    els.video.miniPlayerStepForward.click();
    expect(els.video.miniPlayerVideo.currentTime).toBeCloseTo(31.5 / 30);
  });

  it("falls back to an estimated frame when reading frame times fails", async () => {
    spies.readFrameTimes.mockRejectedValue(new Error("demux failed"));
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    await settle();
    videos.openPlayer(1);
    els.video.miniPlayerStepForward.click();
    expect(els.video.miniPlayerVideo.currentTime).toBeCloseTo(31.5 / 30);
    expect(spies.status.show).not.toHaveBeenCalledWith(expect.stringContaining("demux"), "error");
  });
});

describe("timestamps from an earlier video", () => {
  const MISSING =
    "That moment is in one.mp4, which isn't attached now. Attach it again to jump there.";

  it("plays an earlier video loaded this session without changing the chat's video", async () => {
    let next = 0;
    URL.createObjectURL = vi.fn(() => `blob:video-${++next}`);
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    const first = video("one.mp4", 1);
    const videos = panel();
    await attachAndSend(videos, first);
    await attachAndSend(videos, video("two.mp4", 2));
    expect(els.video.miniPlayer.hidden).toBe(true);
    videos.seek(12, attachmentFor(first));
    await vi.waitFor(() => expect(els.video.miniPlayer.hidden).toBe(false));
    expect(els.video.miniPlayerTitle.textContent).toBe("one.mp4");
    expect(els.video.miniPlayerVideo.getAttribute("src")).toBe("blob:video-5");
    expect(els.video.miniPlayerVideo.currentTime).toBe(12);
    expect(state.currentChat?.video?.name).toBe("two.mp4");
    expect(spies.loadCopy).not.toHaveBeenCalled();
    videos.seek(5, state.currentChat?.video);
    expect(els.video.miniPlayerTitle.textContent).toBe("two.mp4");
    expect(els.video.miniPlayerVideo.getAttribute("src")).toBe("blob:video-4");
    expect(revoke).toHaveBeenCalledWith("blob:video-5");
  });

  it("reports the attached video's playback time only while it is the one shown", async () => {
    const first = video("one.mp4", 1);
    const videos = panel();
    await attachAndSend(videos, first);
    await attachAndSend(videos, video("two.mp4", 2));
    videos.openPlayer(9);
    expect(videos.attachedPlaybackTime()).toBe(9);
    videos.seek(12, attachmentFor(first));
    await vi.waitFor(() => expect(els.video.miniPlayerTitle.textContent).toBe("one.mp4"));
    expect(videos.attachedPlaybackTime()).toBeUndefined();
    els.video.miniPlayerClose.click();
    expect(videos.attachedPlaybackTime()).toBeDefined();
  });

  it("opens an earlier video from its stored copy", async () => {
    const first = video("one.mp4", 1);
    const videos = panel({ loadCopy: () => Promise.resolve(first) });
    await attachAndSend(videos, video("two.mp4", 2));
    videos.seek(7, attachmentFor(first));
    await vi.waitFor(() => expect(els.video.miniPlayerTitle.textContent).toBe("one.mp4"));
    expect(els.video.miniPlayer.hidden).toBe(false);
    expect(state.currentChat?.video?.name).toBe("two.mp4");
  });

  it("says the earlier video needs attaching again when no copy is kept", async () => {
    const videos = panel();
    await videos.attach(video("two.mp4", 2));
    videos.seek(7, attachmentFor(video("one.mp4", 1)));
    await vi.waitFor(() => expect(spies.status.show).toHaveBeenCalledWith(MISSING));
    expect(els.video.miniPlayer.hidden).toBe(true);
  });
});

describe("timestamps from an earlier video that cannot be opened", () => {
  it("reports an earlier video that could not be opened", async () => {
    const first = video("one.mp4", 1);
    const videos = panel({ loadCopy: () => Promise.resolve(first) });
    await attachAndSend(videos, video("two.mp4", 2));
    URL.createObjectURL = vi.fn(() => {
      throw new Error("out of memory");
    });
    videos.seek(7, attachmentFor(first));
    await vi.waitFor(() =>
      expect(spies.status.show).toHaveBeenCalledWith(
        "Could not open one.mp4: out of memory",
        "error",
      ),
    );
  });
});

describe("audio ready in advance", () => {
  function silentTrack(request: AudioAnalysisRequest): AudioTrack {
    const start = request.startSeconds ?? 0;
    return {
      speech: [],
      events: [],
      startSeconds: start,
      durationSeconds: (request.endSeconds ?? start) - start,
    };
  }

  it("analyses the whole video's audio once the overview is ready, when audio is on", async () => {
    const analyseAudio = vi.fn<AnalyseAudio>((_file, request) =>
      Promise.resolve(silentTrack(request)),
    );
    const file = video("beach.mp4");
    await panel({ audioWanted: () => true, analyseAudio }).attach(file);
    await vi.waitFor(() => expect(analyseAudio).toHaveBeenCalledTimes(1));
    const [analysed, request] = analyseAudio.mock.calls[0] ?? [];
    expect(analysed).toBe(file);
    expect(request).toMatchObject({ startSeconds: 0, endSeconds: 60 });
    await vi.waitFor(async () =>
      expect((await store.getAudio(fileKey(file)))?.speechSpans).toEqual([
        { startSeconds: 0, endSeconds: 60 },
      ]),
    );
    await vi.waitFor(() => expect(els.video.chipMeta.textContent).toBe("1:00"));
  });

  it("leaves the audio alone when the Audio toggle is off", async () => {
    const analyseAudio = vi.fn<AnalyseAudio>((_file, request) =>
      Promise.resolve(silentTrack(request)),
    );
    await panel({ audioWanted: () => false, analyseAudio }).attach(video("beach.mp4"));
    await settle();
    expect(analyseAudio).not.toHaveBeenCalled();
  });
});

describe("audio ready in advance, cancelled", () => {
  it("shows progress quietly and stops when the video changes, without failing", async () => {
    const signals: NonNullable<AudioAnalysisOptions["signal"]>[] = [];
    const analyseAudio = vi.fn<AnalyseAudio>(
      (_file, _request, _speech, options) =>
        new Promise((_resolve, reject) => {
          options.onProgress?.({ stage: "sounds", done: 1, total: 4 });
          const { signal } = options;
          if (signal) {
            signals.push(signal);
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        }),
    );
    const videos = panel({ audioWanted: () => true, analyseAudio });
    await videos.attach(video("one.mp4", 1));
    await vi.waitFor(() =>
      expect(els.video.chipMeta.textContent).toBe("1:00 · Listening for sounds… 25%"),
    );
    await videos.attach(video("two.mp4", 2));
    expect(signals[0]?.aborted).toBe(true);
    expect(pendingVideo(currentPending(state))?.name).toBe("two.mp4");
    expect(spies.status.show).not.toHaveBeenCalledWith(expect.stringContaining("aborted"), "error");
  });

  it("stops when another chat is opened", async () => {
    const signals: NonNullable<AudioAnalysisOptions["signal"]>[] = [];
    const analyseAudio = vi.fn<AnalyseAudio>(
      (_file, _request, _speech, options) =>
        new Promise((_resolve, reject) => {
          const { signal } = options;
          if (!signal) return;
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const videos = panel({ audioWanted: () => true, analyseAudio });
    await videos.attach(video("one.mp4", 1));
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const other = blankChat(MODEL, "other", 2);
    await store.putChat(other);
    replaceChat(state, other);
    setCurrentChat(state, other, []);
    await videos.restore();
    expect(signals[0]?.aborted).toBe(true);
  });
});
