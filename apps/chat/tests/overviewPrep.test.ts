import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentPending,
  overviewFor,
  pendingFor,
  pendingVideo,
  removeChat,
  removePendingVideo,
  replaceChat,
  setRunning,
  unlistChat,
  updateChat,
} from "../src/state";
import type { ImageRef } from "../src/types";
import { upload } from "./support/factories";
import {
  attachAndSend,
  attachmentFor,
  cleanUpVideoPanel,
  deferred,
  els,
  MODEL,
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

describe("an overview that finishes after its video has gone", () => {
  async function finishAfter(gone: () => void): Promise<void> {
    const rendered = deferred<ImageRef[]>();
    const videos = panel({ renderOverview: () => rendered.promise });
    await videos.attach(video("one.mp4", 1));
    gone();
    spies.images.release.mockClear();
    rendered.resolve([{ id: "s", pinned: false, source: { kind: "upload", name: "s" } }]);
    const { fileKey } = attachmentFor(video("one.mp4", 1));
    await vi.waitFor(() => expect(spies.images.release).toHaveBeenCalledTimes(1));
    const [dropped] = spies.images.release.mock.calls[0] ?? [];
    expect(dropped).toMatchObject({ refs: [{ id: "s" }], videoKeys: [fileKey] });
    expect(spies.onOverview).not.toHaveBeenCalled();
  }

  it("lets its sheets go when the pending video was removed", () =>
    finishAfter(() => removePendingVideo(state, "chat")));

  it("lets its sheets go when the chat was deleted", () =>
    finishAfter(() => removeChat(state, "chat")));
});

describe("an overview that finishes while its chat is being deleted", () => {
  it("stays with the pending video, for when the delete fails", async () => {
    const rendered = deferred<ImageRef[]>();
    const videos = panel({ renderOverview: () => rendered.promise });
    await videos.attach(video("one.mp4", 1));
    const { currentChat } = state;
    spies.images.release.mockClear();
    unlistChat(state, "chat");
    videos.render();
    rendered.resolve([upload("s")]);
    await vi.waitFor(() => expect(spies.onOverview).toHaveBeenCalledWith("chat", [upload("s")]));
    if (currentChat) replaceChat(state, currentChat);
    expect(overviewFor(state, "chat")).toMatchObject({ kind: "ready", sheets: 1 });
    expect(spies.images.release).not.toHaveBeenCalled();
  });
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
