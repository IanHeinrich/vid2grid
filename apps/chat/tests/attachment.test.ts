import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPending,
  currentPending,
  pendingFor,
  pendingVideo,
  removePendingVideo,
  replaceChat,
  setCurrentChat,
  setRunning,
  unlistChat,
  updateChat,
} from "../src/state";
import type { VideoAttachment } from "../src/types";
import { fileKey } from "../src/video/render";
import { upload } from "./support/factories";
import {
  attachAndSend,
  attachmentFor,
  cleanUpVideoPanel,
  deferred,
  els,
  INFO,
  MODEL,
  openChatWithVideo,
  openOther,
  panel,
  resetVideoPanel,
  send,
  spies,
  state,
  store,
  video,
} from "./support/videoPanel";

beforeEach(resetVideoPanel);

afterEach(cleanUpVideoPanel);

function handleFor(file: File | Error, permission: PermissionState = "granted") {
  return {
    kind: "file",
    name: file instanceof File ? file.name : "gone.mp4",
    getFile: vi.fn(() => (file instanceof File ? Promise.resolve(file) : Promise.reject(file))),
    queryPermission: vi.fn(() => Promise.resolve(permission)),
    requestPermission: vi.fn(() => Promise.resolve(permission)),
  } as unknown as FileSystemFileHandle;
}

describe("attaching", () => {
  it("lets go of the video and overview that another dropped video replaces", async () => {
    const videos = panel();
    await videos.attach(video("beach.mp4"));
    const { fileKey: replaced } = attachmentFor(video("beach.mp4"));
    addPending(state, "chat", { kind: "overview", refs: [upload("sheet")] });
    spies.images.release.mockClear();
    await videos.attach(video("city.mp4"));
    expect(spies.images.release).toHaveBeenCalledTimes(1);
    expect(spies.images.release).toHaveBeenCalledWith({
      refs: [upload("sheet")],
      videoKeys: [replaced],
    });
  });

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
    expect(els.miniPlayer.el.hidden).toBe(false);
    removePendingVideo(state, "chat");
    videos.render();
    expect(els.miniPlayer.el.hidden).toBe(true);
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

describe("a chat whose delete fails", () => {
  it("keeps its pending video's file, so sending it still makes it the chat's", async () => {
    const chat = await openChatWithVideo(attachmentFor(video("old.mp4")));
    const videos = panel();
    await videos.attach(video("new.mp4"));
    const pending = pendingFor(state, "chat");
    unlistChat(state, "chat");
    videos.render();
    replaceChat(state, chat);
    setCurrentChat(state, chat, []);
    videos.render();
    expect(pendingFor(state, "chat")).toEqual(pending);
    expect(videos.pendingView().video?.name).toBe("new.mp4");
    await send(videos);
    expect((await store.getChat("chat"))?.video?.name).toBe("new.mp4");
    expect(state.video?.file.name).toBe("new.mp4");
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
