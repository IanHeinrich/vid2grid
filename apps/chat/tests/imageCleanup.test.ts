import { beforeEach, describe, expect, it, vi } from "vitest";
import { initMessageActions, type MessageActions } from "../src/app/messageActions";
import { createImageCleanup } from "../src/app/imageCleanup";
import { CLEANUP_LOCK, joinTabs, type Tabs } from "../src/app/tabs";
import { initTurns, type Turns } from "../src/app/turns";
import { blankChat } from "../src/chat/chats";
import { BACKUP_FORMAT, BACKUP_VERSION, importBackup } from "../src/chat/exportChat";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  addPending,
  createAppState,
  removeChat,
  removePendingVideo,
  replaceChat,
  setCurrentChat,
  setOverviewStatus,
  setPendingVideo,
  setRunning,
  type AppState,
} from "../src/state";
import type { Chat, ChatMessage, ChatStore, ImageRef, VideoAttachment } from "../src/types";
import { initComposer } from "../src/ui/composer/composer";
import { initToast, type Toast } from "../src/ui/shared/toast";
import { initSidebar } from "../src/ui/shell/sidebar";
import { sheetCacheKey, zoomCacheKey } from "../src/video/sheetCache";
import { assistant, sheet, tool, user } from "./support/factories";
import {
  aloneTabs,
  cleanupFor,
  isStored,
  saveImage,
  stores,
  uploadRef,
  zoomRef,
} from "./support/images";
import { settled, sharedLocks } from "./support/locks";
import { mountPage } from "./support/page";
import { replyWith } from "./support/streams";

const VIDEO: VideoAttachment = {
  name: "clip.mp4",
  fileKey: "clip.mp4|1|7",
  durationSeconds: 60,
  width: 640,
  height: 360,
};
const SHEETS_KEY = sheetCacheKey(VIDEO.fileKey, { frameCount: 4 });

let els: AppElements;
let state: AppState;
let store: ChatStore;
let images: ReturnType<typeof cleanupFor>;
let toast: Toast;
let timers: (() => void)[];

const silent = { show: vi.fn(), clear: vi.fn() };

function expireToast(): void {
  timers.splice(0).forEach((run) => run());
}

async function seed(id: string, messages: ChatMessage[], extra: Partial<Chat> = {}): Promise<Chat> {
  const chat = { ...blankChat("model", id, 1), title: `Chat ${id}`, ...extra };
  await store.putChat(chat);
  for (const message of messages) await store.putMessage(id, message);
  replaceChat(state, chat);
  return chat;
}

async function openNew(messages: ChatMessage[], extra: Partial<Chat> = {}): Promise<void> {
  setCurrentChat(state, await seed("chat", messages, extra), messages);
}

function looked(...ids: string[]): ChatMessage[] {
  const refs = ids.map((id) => sheet(id, 0, 1));
  return [
    user("U", "look", { createdAt: 1 }),
    { ...assistant("A", "", { toolCalls: [{ id: "c", name: "look", arguments: "{}" }] }) },
    tool("T", "c", refs),
    assistant("B", "done", { createdAt: 3 }),
  ];
}

async function stored(...ids: string[]): Promise<boolean[]> {
  await settled();
  await settled();
  return Promise.all(ids.map((id) => isStored(store, id)));
}

// How many images the Settings sweep deleted, or why it would not.
async function sweepNow(): Promise<number | string> {
  const recount = await images.countToDelete();
  if ("refused" in recount) return recount.refused;
  const result = await images.deleteUnused(recount.counted);
  return "refused" in result ? result.refused : result.deleted.images.length;
}

async function unusedCount(): Promise<number> {
  return (await images.countUnused()).images.length;
}

function sidebar() {
  const onOpen = vi.fn();
  initSidebar(els, state, {
    store,
    status: silent,
    toast,
    images,
    onOpen,
    onDeletingCurrent: vi.fn(),
    onCurrentDeleted: vi.fn(),
    onDeleted: vi.fn(),
    onDeleteFinal: vi.fn(),
    onRenamed: vi.fn(),
    onOpenSettings: vi.fn(),
    onFocusComposer: vi.fn(),
  });
  return { onOpen };
}

async function deleteFromSidebar(id: string): Promise<void> {
  const item = els.sidebar.chatList.querySelector(`[data-chat-id="${id}"]`);
  item?.querySelector<HTMLElement>(".chat-delete")?.click();
  await vi.waitFor(() => expect(els.toast.text.textContent).toBe(`Deleted "Chat ${id}"`));
}

function actions(): MessageActions {
  return initMessageActions(state, {
    store,
    status: silent,
    toast,
    images,
    conversation: { reset: vi.fn() },
    streamChat: replyWith("ok"),
    toolContext: () => undefined,
    onOpen: vi.fn(),
    onChatsChanged: vi.fn(),
    newId: () => "branch",
  });
}

const view = () => ({
  show: vi.fn(),
  apply: vi.fn(),
  showError: vi.fn(),
  endTurn: vi.fn(),
  reset: vi.fn(),
  setRunning: vi.fn(),
  clearErrors: vi.fn(),
});

function turns(): Turns {
  return initTurns(state, {
    store,
    status: silent,
    conversation: view(),
    video: { renderSceneLog: vi.fn() },
    images,
    streamChat: replyWith("new answer"),
    timeline: () => undefined,
    onChatChanged: vi.fn(),
    onRunningChanged: vi.fn(),
    onMessageSaved: vi.fn(),
  });
}

async function openState(open: () => Promise<ChatStore>): Promise<void> {
  els = mountPage();
  state = createAppState(DEFAULT_SETTINGS);
  store = await open();
  images = cleanupFor(state, store);
  timers = [];
  toast = initToast(els, { set: (run) => timers.push(run), clear: vi.fn() });
}

describe("videos in holds", () => {
  beforeEach(() => openState(() => Promise.resolve(createMemoryStore())));

  it("says whether any hold names a video, and when one stops needing it", async () => {
    const freed = vi.fn();
    images = createImageCleanup(state, { store, tabs: aloneTabs, onVideosFreed: freed });
    const [first, second] = [
      images.hold({ videoKeys: ["v"] }),
      images.hold({ videoKeys: ["v", "w"] }),
    ];
    images.hold({ messages: [] }).letGo();
    expect(images.holdsVideo("v")).toBe(true);
    first.final();
    expect(images.holdsVideo("v")).toBe(true);
    expect(freed.mock.calls).toEqual([[["v"]]]);
    second.letGo();
    second.letGo();
    expect(images.holdsVideo("v")).toBe(false);
    expect(freed.mock.calls).toEqual([[["v"]], [["v", "w"]]]);
    await images.release({ videoKeys: ["pending"] });
    expect(freed).toHaveBeenLastCalledWith(["pending"]);
  });
});

describe.each(stores)("%s: deleting a chat", (_name, open) => {
  beforeEach(() => openState(open));

  it("deletes its images once Undo has gone, but not one another chat holds", async () => {
    const [own, shared] = [await saveImage(store), await saveImage(store)];
    await seed("a", looked(own, shared));
    await seed("b", looked(shared));
    sidebar();
    await deleteFromSidebar("a");
    expect(await stored(own, shared)).toEqual([true, true]);
    expireToast();
    expect(await stored(own, shared)).toEqual([false, true]);
  });

  it("brings its images back with Undo", async () => {
    const id = await saveImage(store);
    await seed("a", looked(id));
    sidebar();
    await deleteFromSidebar("a");
    els.toast.action.click();
    await vi.waitFor(async () => expect(await store.listMessages("a")).toHaveLength(4));
    expireToast();
    expect(await stored(id)).toEqual([true]);
    expect(await sweepNow()).toBe(0);
    expect(await stored(id)).toEqual([true]);
  });

  it("keeps an open Undo's images while another chat's deletion becomes final", async () => {
    const shared = await saveImage(store);
    await seed("a", looked(shared));
    await seed("b", looked(shared));
    sidebar();
    await deleteFromSidebar("a");
    await deleteFromSidebar("b");
    expect(await stored(shared)).toEqual([true]);
    els.toast.action.click();
    await vi.waitFor(async () => expect(await store.listMessages("b")).toHaveLength(4));
    expireToast();
    expect(await stored(shared)).toEqual([true]);
  });

  it("deletes its images when restoring it fails", async () => {
    const id = await saveImage(store);
    await seed("a", looked(id));
    sidebar();
    await deleteFromSidebar("a");
    store.putChat = () => Promise.reject(new Error("Disk full"));
    els.toast.action.click();
    await vi.waitFor(async () => expect(await stored(id)).toEqual([false]));
  });

  it("keeps the images a failed restore did put back", async () => {
    const [kept, lost] = [await saveImage(store), await saveImage(store)];
    const later = tool("T2", "c2", [sheet(lost, 0, 1)]);
    await seed("a", [...looked(kept), { ...later, createdAt: 9 }]);
    sidebar();
    await deleteFromSidebar("a");
    const putMessage = store.putMessage.bind(store);
    store.putMessage = (chatId, message) =>
      message.id === "T2" ? Promise.reject(new Error("Disk full")) : putMessage(chatId, message);
    els.toast.action.click();
    await vi.waitFor(async () => expect(await stored(lost)).toEqual([false]));
    expect(await stored(kept)).toEqual([true]);
  });

  it("keeps everything when deleting it fails", async () => {
    const id = await saveImage(store);
    await seed("a", looked(id));
    store.deleteChat = () => Promise.reject(new Error("Disk full"));
    const { onOpen } = sidebar();
    const item = els.sidebar.chatList.querySelector('[data-chat-id="a"] .chat-delete');
    if (item instanceof HTMLElement) item.click();
    await vi.waitFor(() => expect(els.toast.text.textContent).toContain("Disk full"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(await sweepNow()).toBe(0);
    expect(await stored(id)).toEqual([true]);
  });

  it("puts its unsent attachments back too when deleting it fails", async () => {
    const ids = [await saveImage(store), await saveImage(store)];
    const [unsent = "", cached = ""] = ids;
    await store.putSheets(SHEETS_KEY, [sheet(cached, 0, 1)]);
    await seed("a", []);
    setPendingVideo(state, "a", VIDEO);
    addPending(state, "a", { kind: "overview", refs: [sheet(cached, 0, 1)] });
    addPending(state, "a", { kind: "image", ref: uploadRef(unsent) });
    const ready = { kind: "ready", fileKey: VIDEO.fileKey, sheets: 1 } as const;
    setOverviewStatus(state, "a", ready);
    const draft = state.pending.get("a");
    const swept: unknown[] = [];
    const late = { kind: "image", ref: uploadRef("late") } as const;
    const listMessages = store.listMessages.bind(store);
    store.listMessages = async (chatId) => {
      swept.push(await sweepNow());
      return listMessages(chatId);
    };
    store.deleteChat = async () => {
      await images.release({ refs: [uploadRef(unsent)], videoKeys: [VIDEO.fileKey] });
      swept.push(await sweepNow());
      addPending(state, "a", late);
      throw new Error("Disk full");
    };
    sidebar();
    els.sidebar.chatList.querySelector<HTMLElement>('[data-chat-id="a"] .chat-delete')?.click();
    await vi.waitFor(() => expect(els.toast.text.textContent).toContain("Disk full"));
    expect(swept).toEqual([0, "undo"]);
    expect(state.pending.get("a")).toEqual([...(draft ?? []), late]);
    expect(state.overviews.get("a")).toEqual(ready);
    expect(await sweepNow()).toBe(0);
    expect(await stored(...ids)).toEqual([true, true]);
    expect(await store.getSheets(SHEETS_KEY)).toHaveLength(1);
  });

  it("drops what a refused save put back once Undo has gone, and deletes it", async () => {
    const [late, sheets] = [await saveImage(store), await saveImage(store)];
    await store.putSheets(SHEETS_KEY, [sheet(sheets, 0, 1)]);
    await seed("a", []);
    sidebar();
    await deleteFromSidebar("a");
    addPending(state, "a", { kind: "image", ref: uploadRef(late) });
    setPendingVideo(state, "a", VIDEO);
    setOverviewStatus(state, "a", { kind: "ready", fileKey: VIDEO.fileKey, sheets: 1 });
    expect(await stored(late, sheets)).toEqual([true, true]);
    expireToast();
    expect(state.pending.size).toBe(0);
    expect(state.overviews.size).toBe(0);
    expect(await stored(late, sheets)).toEqual([false, false]);
    expect(await store.getSheets(SHEETS_KEY)).toBeUndefined();
  });

  it.each(["Undo", "a restored backup"])(
    "keeps what is being written in it when %s has brought it back",
    async (by) => {
      const late = await saveImage(store);
      const chat = await seed("a", []);
      sidebar();
      await deleteFromSidebar("a");
      const draft = { kind: "image", ref: uploadRef(late) } as const;
      addPending(state, "a", draft);
      if (by === "Undo") {
        els.toast.action.click();
        await vi.waitFor(() => expect(state.chats).toHaveLength(1));
      } else {
        await store.putChat(chat);
        replaceChat(state, chat);
      }
      expireToast();
      expect(await stored(late)).toEqual([true]);
      expect(state.pending.get("a")).toEqual([draft]);
      expect(await sweepNow()).toBe(0);
    },
  );

  it("deletes its unsent images once it is brought back without them", async () => {
    const id = await saveImage(store);
    await seed("a", []);
    addPending(state, "a", { kind: "image", ref: uploadRef(id) });
    sidebar();
    await deleteFromSidebar("a");
    expect(await stored(id)).toEqual([true]);
    els.toast.action.click();
    await vi.waitFor(async () => expect(await stored(id)).toEqual([false]));
    expect(await sweepNow()).toBe(0);
  });

  it("deletes its unsent images and those kept for zooming too", async () => {
    const ids = [await saveImage(store), await saveImage(store), await saveImage(store)];
    const [sent = "", original = "", unsent = ""] = ids;
    await seed("a", [user("U", "hi", { images: [uploadRef(sent, original)] })]);
    addPending(state, "a", { kind: "image", ref: uploadRef(unsent) });
    sidebar();
    await deleteFromSidebar("a");
    expireToast();
    expect(await stored(...ids)).toEqual([false, false, false]);
  });

  it("drops its video's cached sheets unless another chat still uses the video", async () => {
    const id = await saveImage(store);
    await store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)]);
    await seed("a", looked(id), { video: VIDEO });
    await seed("b", [user("U", "hi", { video: VIDEO })]);
    sidebar();
    await deleteFromSidebar("a");
    expireToast();
    expect(await stored(id)).toEqual([true]);
    expect(await store.getSheets(SHEETS_KEY)).toHaveLength(1);
    await deleteFromSidebar("b");
    expireToast();
    expect(await stored(id)).toEqual([false]);
    expect(await store.getSheets(SHEETS_KEY)).toBeUndefined();
  });

  it("keeps its video's cached sheets while the video waits in an unsent message", async () => {
    const id = await saveImage(store);
    await store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)]);
    await seed("a", looked(id), { video: VIDEO });
    await seed("b", []);
    setPendingVideo(state, "b", VIDEO);
    sidebar();
    await deleteFromSidebar("a");
    expireToast();
    expect(await stored(id)).toEqual([true]);
    expect(await store.getSheets(SHEETS_KEY)).toHaveLength(1);
  });

  it("skips while a reply runs, leaving the images to the sweep", async () => {
    const id = await saveImage(store);
    await seed("a", looked(id));
    await seed("b", []);
    sidebar();
    await deleteFromSidebar("a");
    setRunning(state, true, "b");
    expireToast();
    expect(await stored(id)).toEqual([true]);
    expect(await sweepNow()).toBe("running");
    setRunning(state, false, "b");
    expect(await unusedCount()).toBe(1);
    expect(await sweepNow()).toBe(1);
    expect(await stored(id)).toEqual([false]);
  });

  it("skips while another tab is open, whose unsaved images it cannot see", async () => {
    const locks = sharedLocks();
    images = cleanupFor(state, store, await joinTabs(locks));
    const other: Tabs = await joinTabs(locks);
    expect(other.supported).toBe(true);
    const id = await saveImage(store);
    await seed("a", looked(id));
    sidebar();
    await deleteFromSidebar("a");
    expireToast();
    expect(await stored(id)).toEqual([true]);
    expect(await unusedCount()).toBe(1);
  });
});

describe.each(stores)("%s: deleting a message", (_name, open) => {
  beforeEach(() => openState(open));

  it("brings its images back with Undo", async () => {
    const id = await saveImage(store);
    await openNew(looked(id));
    const reply = state.messages.at(-1);
    if (reply) await actions().remove(reply);
    expect(await store.listMessages("chat")).toHaveLength(1);
    expect(await sweepNow()).toBe("undo");
    els.toast.action.click();
    await vi.waitFor(async () => expect(await store.listMessages("chat")).toHaveLength(4));
    expireToast();
    expect(await stored(id)).toEqual([true]);
    expect(await sweepNow()).toBe(0);
  });

  it("deletes its images once Undo has gone", async () => {
    const id = await saveImage(store);
    await openNew(looked(id));
    const reply = state.messages.at(-1);
    if (reply) await actions().remove(reply);
    expect(await stored(id)).toEqual([true]);
    expireToast();
    expect(await stored(id)).toEqual([false]);
  });

  it("deletes its images when Undo is dismissed or fails", async () => {
    const ids = [await saveImage(store), await saveImage(store)];
    const [first = "", second = ""] = ids;
    await openNew([
      user("U1", "hi", { images: [uploadRef(first)] }),
      user("U2", "hi", { images: [uploadRef(second)] }),
    ]);
    const [one, two] = state.messages;
    const deleting = actions();
    if (one) await deleting.remove(one);
    deleting.invalidateUndo();
    expect(await stored(...ids)).toEqual([false, true]);
    if (two) await deleting.remove(two);
    store.putMessage = () => Promise.reject(new Error("Disk full"));
    els.toast.action.click();
    await vi.waitFor(async () => expect(await stored(second)).toEqual([false]));
  });

  it("keeps an image a branch holds", async () => {
    const [shared, own] = [await saveImage(store), await saveImage(store)];
    await openNew([
      user("U1", "hi", { images: [uploadRef(shared)] }),
      user("U2", "hi", { images: [uploadRef(own)], createdAt: 1 }),
    ]);
    const [one, two] = state.messages;
    if (!one || !two) throw new Error("No messages");
    await actions().branch(one);
    for (const message of [one, two]) {
      await actions().remove(message);
      expireToast();
    }
    expect(await stored(shared, own)).toEqual([true, false]);
  });

  it("says so when Undo finds the chat deleted in another tab, and keeps no images for it", async () => {
    const id = await saveImage(store);
    await openNew(looked(id));
    const reply = state.messages.at(-1);
    if (reply) await actions().remove(reply);
    await store.deleteChat("chat");
    els.toast.action.click();
    await vi.waitFor(() =>
      expect(silent.show).toHaveBeenCalledWith(
        "Could not undo: This chat has been deleted.",
        "error",
      ),
    );
    expect(await store.listMessages("chat")).toEqual([]);
    expect(await stored(id)).toEqual([false]);
  });

  it("drops its video's cached sheets once Undo has gone", async () => {
    const id = await saveImage(store);
    await store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)]);
    await openNew([user("U", "hi", { video: VIDEO })]);
    const [sent] = state.messages;
    if (sent) await actions().remove(sent);
    await images.release({ videoKeys: [VIDEO.fileKey] });
    expect(await stored(id)).toEqual([true]);
    expect(await store.getSheets(SHEETS_KEY)).toHaveLength(1);
    expireToast();
    expect(await stored(id)).toEqual([false]);
    expect(await store.getSheets(SHEETS_KEY)).toBeUndefined();
  });

  it("keeps its video's cached sheets while its chat or another still uses the video", async () => {
    const id = await saveImage(store);
    await store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)]);
    await seed("b", [user("U", "hi", { video: VIDEO })]);
    await openNew([user("U1", "hi", { video: VIDEO })], { video: VIDEO });
    const [sent] = state.messages;
    if (sent) await actions().remove(sent);
    await store.deleteChat("b");
    removeChat(state, "b");
    expireToast();
    expect(await stored(id)).toEqual([true]);
    expect(await store.getSheets(SHEETS_KEY)).toHaveLength(1);
  });

  it("drops a deleted upload's cached zooms with it", async () => {
    const ids = [await saveImage(store), await saveImage(store)];
    const [upload = "", zoom = ""] = ids;
    const area = { left: 0, top: 0, right: 500, bottom: 500 };
    const key = zoomCacheKey({ kind: "image", id: upload, name: "beach.jpg" }, area, 1024);
    await store.putSheets(key, [zoomRef(zoom, upload)]);
    await openNew([user("U1", "hi", { images: [uploadRef(upload)] })]);
    const [one] = state.messages;
    if (one) await actions().remove(one);
    expireToast();
    expect(await stored(...ids)).toEqual([false, false]);
    expect(await store.getSheets(key)).toBeUndefined();
  });
});

describe.each(stores)("%s: restoring a backup without images", (_name, open) => {
  beforeEach(() => openState(open));

  function backupOf(chat: Chat, messages: unknown[]): Promise<Blob> {
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: 1,
      chats: [{ chat, messages }],
      timelines: [],
      images: [],
    };
    return new Response(JSON.stringify(backup)).blob();
  }

  async function restore(file: Blob, afterFirstMessage: () => Promise<void>): Promise<void> {
    const putMessage = store.putMessage.bind(store);
    let first = true;
    store.putMessage = async (chatId, message) => {
      await putMessage(chatId, message);
      if (first) await afterFirstMessage();
      first = false;
    };
    await importBackup(store, file, { hold: (holder) => images.hold(holder) });
  }

  it("refuses to sweep while messages are still to be written", async () => {
    const id = await saveImage(store);
    const chat = await seed("a", looked(id));
    await store.deleteChat("a");
    removeChat(state, "a");
    expect(await unusedCount()).toBe(1);
    const counted = await images.countUnused();
    const swept: unknown[] = [];
    await restore(await backupOf(chat, looked(id)), async () => {
      swept.push(await sweepNow(), await images.deleteUnused(counted));
    });
    expect(swept).toEqual(["undo", { refused: "undo" }]);
    expect(await sweepNow()).toBe(0);
    expect(await stored(id)).toEqual([true]);
  });

  it("keeps what is still to be written when an Undo expires meanwhile", async () => {
    const [shown, cached] = [await saveImage(store), await saveImage(store)];
    await store.putSheets(SHEETS_KEY, [sheet(cached, 0, 1)]);
    const messages = [...looked(shown), user("V", "more", { createdAt: 9, video: VIDEO })];
    const chat = await seed("a", messages);
    sidebar();
    await deleteFromSidebar("a");
    await restore(await backupOf(chat, messages), async () => {
      expireToast();
      expect(await stored(shown, cached)).toEqual([true, true]);
    });
    expect(await stored(shown, cached)).toEqual([true, true]);
    expect(await store.getSheets(SHEETS_KEY)).toHaveLength(1);
    expect(await sweepNow()).toBe(0);
  });

  it("lets go of a malformed backup, which fails with its own error", async () => {
    const id = await saveImage(store);
    const chat = await seed("a", looked(id));
    await store.deleteChat("a");
    removeChat(state, "a");
    const odd = [
      { ...user("odd", "hi"), video: 3, alternates: [null] },
      { ...user("odder", "hi"), video: null, images: [{ id: "x", source: { kind: "clip" } }] },
    ];
    const file = await backupOf(chat, [user("U", "hi"), ...odd]);
    const restoring = restore(file, async () => {
      expect(await sweepNow()).toBe("undo");
      await images.release({ refs: [sheet(id, 0, 1)] });
      expect(await stored(id)).toEqual([true]);
    });
    await expect(restoring).rejects.toThrow("Cannot read properties of null");
    expect(await sweepNow()).toBe(1);
    expect(await stored(id)).toEqual([false]);
  });
});

describe.each(stores)("%s: replies rewritten", (_name, open) => {
  beforeEach(async () => {
    await openState(open);
    state = createAppState({ ...DEFAULT_SETTINGS, baseUrl: "http://localhost:1/v1" });
    images = cleanupFor(state, store);
  });

  it("deletes the images of a reply that an edit replaced, after the new reply", async () => {
    const [own, swiped] = [await saveImage(store), await saveImage(store)];
    const [first, ...rest] = looked(own);
    if (first?.role !== "user") throw new Error("No user message");
    const alternates = [{ messages: [tool("T0", "c0", [sheet(swiped, 0, 1)])], createdAt: 1 }];
    await openNew([{ ...first, alternates }, ...rest]);
    const [edited] = state.messages;
    if (edited?.role === "user") await turns().edit(edited, "look again");
    expect((await store.listMessages("chat")).at(-1)).toMatchObject({ text: "new answer" });
    expect(await stored(own, swiped)).toEqual([false, true]);
  });

  it("keeps the images of a reply that a replay replaced, as a swipe away", async () => {
    const id = await saveImage(store);
    await openNew(looked(id));
    await turns().replay();
    expect((await store.listMessages("chat")).at(-1)).toMatchObject({ text: "new answer" });
    expect(await sweepNow()).toBe(0);
    expect(await stored(id)).toEqual([true]);
    const [first] = state.messages;
    if (first?.role === "user") await actions().switchReply(first, 0);
    expect((await store.listMessages("chat")).map(({ role }) => role)).toContain("tool");
    expect(await sweepNow()).toBe(0);
    expect(await stored(id)).toEqual([true]);
  });

  it("says so when the chat was deleted in another tab, and saves nothing to it", async () => {
    await openNew(looked(await saveImage(store)));
    await store.deleteChat("chat");
    const [first] = state.messages;
    if (first?.role === "user") await turns().edit(first, "look again");
    expect(silent.show).toHaveBeenCalledWith("This chat has been deleted.", "error");
    expect(await store.listMessages("chat")).toEqual([]);
    expect(state.running).toBe(false);
  });

  it("refuses to sweep between the saves of a switched reply", async () => {
    const id = await saveImage(store);
    const alternates = [{ messages: [tool("T0", "c0", [sheet(id, 0, 1)])], createdAt: 1 }];
    await openNew([user("U", "hi", { alternates, replyIndex: 1 }), assistant("A", "shown")]);
    const deleteMessages = store.deleteMessages.bind(store);
    let swept: unknown;
    store.deleteMessages = async (chatId, ids) => {
      await deleteMessages(chatId, ids);
      setCurrentChat(state, null, []);
      swept = await sweepNow();
    };
    const [first] = state.messages;
    if (first?.role === "user") await actions().switchReply(first, 0);
    expect(swept).toBe("undo");
    expect(await stored(id)).toEqual([true]);
  });
});

describe.each(stores)("%s: unsent attachments", (_name, open) => {
  beforeEach(() => openState(open));

  function composer() {
    const made = initComposer(els, state, {
      store,
      status: silent,
      video: {
        overviewRendering: () => false,
        whenOverviewReady: () => Promise.resolve(),
        view: () => ({ video: undefined, url: null }),
        pendingView: () => ({ video: undefined, url: null }),
        commit: () => Promise.resolve(),
      },
      turns: { run: vi.fn(), stop: vi.fn(), answerNow: vi.fn() },
      images,
      stopChecks: vi.fn(),
      onFiles: vi.fn(),
      onPendingChanged: vi.fn(),
      onReady: vi.fn(),
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    return made;
  }

  function removeFirst(): void {
    els.composer.pendingList.querySelector<HTMLElement>(".pending-remove")?.click();
  }

  it("deletes a removed image with its larger copy, keeping the other", async () => {
    const ids = [await saveImage(store), await saveImage(store), await saveImage(store)];
    const [sent = "", original = "", other = ""] = ids;
    await openNew([]);
    addPending(state, "chat", { kind: "image", ref: uploadRef(sent, original) });
    addPending(state, "chat", { kind: "image", ref: uploadRef(other) });
    composer();
    removeFirst();
    expect(await stored(...ids)).toEqual([false, false, true]);
    expect(await sweepNow()).toBe(0);
    expect(await stored(other)).toEqual([true]);
  });

  it("keeps a removed image that a message also holds", async () => {
    const id = await saveImage(store);
    await openNew([user("U", "hi", { images: [uploadRef(id)] })]);
    addPending(state, "chat", { kind: "image", ref: uploadRef(id) });
    composer();
    removeFirst();
    expect(await stored(id)).toEqual([true]);
  });

  it("drops a removed video's overview and cached sheets", async () => {
    const id = await saveImage(store);
    await openNew([]);
    await store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)]);
    setPendingVideo(state, "chat", VIDEO);
    addPending(state, "chat", { kind: "overview", refs: [sheet(id, 0, 1)] });
    composer();
    removeFirst();
    expect(await stored(id)).toEqual([false]);
    expect(await store.getSheets(SHEETS_KEY)).toBeUndefined();
  });

  it("keeps a removed overview that is cached for the video still attached", async () => {
    const id = await saveImage(store);
    await openNew([], { video: VIDEO });
    await store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)]);
    addPending(state, "chat", { kind: "overview", refs: [sheet(id, 0, 1)] });
    composer();
    removeFirst();
    expect(await stored(id)).toEqual([true]);
  });

  it("leaves a removed image to the sweep while a reply runs", async () => {
    const id = await saveImage(store);
    await openNew([]);
    addPending(state, "chat", { kind: "image", ref: uploadRef(id) });
    setRunning(state, true);
    composer();
    removeFirst();
    expect(await stored(id)).toEqual([true]);
    setRunning(state, false);
    expect(await sweepNow()).toBe(1);
  });
});

describe.each(stores)("%s: what only this tab holds", (_name, open) => {
  beforeEach(() => openState(open));

  async function orphan(): Promise<string> {
    const id = await saveImage(store);
    await store.putChat(blankChat("model", "gone", 1));
    await store.putMessage("gone", tool("T", "c", [sheet(id, 0, 1)]));
    await store.deleteChat("gone");
    return id;
  }

  const holders: [string, (ref: ImageRef) => void][] = [
    ["an unsent image", (ref) => addPending(state, "chat", { kind: "image", ref })],
    ["an unsent overview", (ref) => addPending(state, "chat", { kind: "overview", refs: [ref] })],
    [
      "a message on screen",
      (ref) => {
        setCurrentChat(state, state.currentChat, [tool("T", "c", [ref])]);
      },
    ],
  ];
  it.each(holders)("keeps %s", async (_holder, keep) => {
    const id = await orphan();
    await openNew([]);
    keep(sheet(id, 0, 1));
    await images.release({ refs: [sheet(id, 0, 1)] });
    expect(await unusedCount()).toBe(0);
    expect(await sweepNow()).toBe(0);
    expect(await stored(id)).toEqual([true]);
  });

  it("keeps what is held until it is let go, and deletes it once final", async () => {
    const id = await orphan();
    const [first, second] = [
      images.hold({ refs: [sheet(id, 0, 1)] }),
      images.hold({ refs: [sheet(id, 0, 1)] }),
    ];
    await images.release({ refs: [sheet(id, 0, 1)] });
    expect(await unusedCount()).toBe(0);
    expect(await sweepNow()).toBe("undo");
    first.final();
    expect(await stored(id)).toEqual([true]);
    second.letGo();
    second.final();
    expect(await stored(id)).toEqual([true]);
    expect(await sweepNow()).toBe(1);
  });

  it("keeps the cached sheets of an unsent video until it is removed", async () => {
    const id = await saveImage(store);
    await openNew([]);
    await store.putSheets(SHEETS_KEY, [sheet(id, 0, 1)]);
    setPendingVideo(state, "chat", VIDEO);
    expect(await sweepNow()).toBe(0);
    removePendingVideo(state, "chat");
    expect(await sweepNow()).toBe(1);
    expect(await store.getSheets(SHEETS_KEY)).toBeUndefined();
  });

  it("checks again inside the transaction, so a reply begun meanwhile stops the delete", async () => {
    const id = await orphan();
    await openNew([]);
    const counted = await images.countUnused();
    images = cleanupFor(state, store, {
      supported: true,
      whileAlone: async (work) => {
        setRunning(state, true);
        return { done: await work(() => true) };
      },
    });
    expect(await images.deleteUnused(counted)).toEqual({ refused: "running" });
    expect(await stored(id)).toEqual([true]);
  });

  it("is refused while another tab is open, and without locks", async () => {
    const id = await orphan();
    const locks = sharedLocks();
    images = cleanupFor(state, store, await joinTabs(locks));
    await joinTabs(locks);
    expect(images.canDelete).toBe(true);
    expect(await sweepNow()).toBe("otherTabs");
    images = cleanupFor(state, store, await joinTabs(undefined));
    expect(images.canDelete).toBe(false);
    expect(await sweepNow()).toBe("unsupported");
    await images.release({ refs: [sheet(id, 0, 1)] });
    expect(await stored(id)).toEqual([true]);
  });

  it("is refused once it has taken too long to be safe", async () => {
    const id = await orphan();
    await openNew([]);
    const counted = await images.countUnused();
    images = cleanupFor(state, store, {
      supported: true,
      whileAlone: async (work) => ({ done: await work(() => false) }),
    });
    expect(await images.deleteUnused(counted)).toEqual({ refused: "late" });
    await images.release({ refs: [sheet(id, 0, 1)] });
    expect(await stored(id)).toEqual([true]);
  });

  it("deletes what it began to in time, however long the reads then take", async () => {
    const ids = [await orphan(), await orphan()];
    const [swept = "", released = ""] = ids;
    await openNew([]);
    const inTimeOnce = () => {
      const answers = [true];
      return () => answers.shift() ?? false;
    };
    images = cleanupFor(state, store, {
      supported: true,
      whileAlone: async (work) => ({ done: await work(inTimeOnce()) }),
    });
    await images.release({ refs: [sheet(released, 0, 1)] });
    expect(await stored(...ids)).toEqual([true, false]);
    const counted = await images.countUnused();
    expect(await images.deleteUnused(counted)).toMatchObject({ deleted: { images: [swept] } });
    expect(await stored(swept)).toEqual([false]);
  });

  it("can delete once a join that took too long goes through", async () => {
    const id = await orphan();
    const locks = sharedLocks();
    let finish: () => void = () => undefined;
    void locks.request(CLEANUP_LOCK, () => new Promise<void>((resolve) => (finish = resolve)));
    images = cleanupFor(state, store, await joinTabs(locks, 5));
    expect(images.canDelete).toBe(false);
    expect(await sweepNow()).toBe("unsupported");
    await images.release({ refs: [sheet(id, 0, 1)] });
    expect(await stored(id)).toEqual([true]);
    finish();
    await settled();
    expect(images.canDelete).toBe(true);
    expect(await sweepNow()).toBe(1);
    expect(await stored(id)).toEqual([false]);
  });

  it("is refused when another tab opens after the count", async () => {
    const id = await orphan();
    const locks = sharedLocks();
    images = cleanupFor(state, store, await joinTabs(locks));
    const recount = await images.countToDelete();
    if (!("counted" in recount)) throw new Error("Not counted");
    expect(recount.counted.images).toEqual([id]);
    await joinTabs(locks);
    expect(await images.deleteUnused(recount.counted)).toEqual({ refused: "otherTabs" });
    expect(await stored(id)).toEqual([true]);
  });

  it("begins no transaction to delete while a reply runs or another tab is open", async () => {
    const id = await orphan();
    await openNew([]);
    const asked: unknown[] = [];
    const releaseImages = store.releaseImages.bind(store);
    store.releaseImages = (dropped, unsaved) => {
      asked.push(unsaved("before"));
      return releaseImages(dropped, unsaved);
    };
    setRunning(state, true);
    await images.release({ refs: [sheet(id, 0, 1)] });
    setRunning(state, false);
    const locks = sharedLocks();
    images = cleanupFor(state, store, await joinTabs(locks));
    await joinTabs(locks);
    await images.release({ refs: [sheet(id, 0, 1)] });
    expect(asked).toEqual([undefined, undefined]);
  });

  it("deletes nothing while something unsaved is of an unknown kind", async () => {
    const id = await orphan();
    await openNew([]);
    const odd = { id: "x", pinned: false, source: { kind: "clip" } } as unknown as ImageRef;
    const held = images.hold({ refs: [odd] });
    await images.release({ refs: [sheet(id, 0, 1)] });
    expect(await stored(id)).toEqual([true]);
    held.letGo();
    await images.release({ refs: [sheet(id, 0, 1)] });
    expect(await stored(id)).toEqual([false]);
  });

  it("keeps the images and an open Undo when a release fails", async () => {
    const [first, second] = [await saveImage(store), await saveImage(store)];
    await seed("a", looked(first));
    await seed("b", looked(second));
    sidebar();
    await deleteFromSidebar("a");
    const failing = vi.fn(() => Promise.reject(new Error("Disk full")));
    store.releaseImages = failing;
    await deleteFromSidebar("b");
    expect(await stored(first, second)).toEqual([true, true]);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(els.toast.text.textContent).toBe('Deleted "Chat b"');
    els.toast.action.click();
    await vi.waitFor(async () => expect(await store.listMessages("b")).toHaveLength(4));
  });
});
