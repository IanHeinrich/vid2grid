import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  createAppState,
  replaceChat,
  setChats,
  setCurrentChat,
  setSettings,
  type AppState,
} from "../src/state";
import type { Chat, ChatMessage, ChatStore, Folder, VideoAttachment } from "../src/types";
import { initSidebar, type SidebarDeps } from "../src/ui/shell/sidebar";
import { initToast } from "../src/ui/shared/toast";
import { initVideoCopies, type VideoStorage } from "../src/ui/video/videoCopies";
import { idleImages } from "./support/images";
import { mountPage } from "./support/page";

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  baseUrl: "http://localhost:1234/v1",
  defaultModelId: "qwen3-6-27b",
};

let els: AppElements;
let state: AppState;
let store: ChatStore;
let deps: SidebarDeps;
let spies: ReturnType<typeof makeSpies>;
let timers: (() => void)[];

function makeSpies() {
  return {
    onOpen: vi.fn(),
    onDeletingCurrent: vi.fn(),
    onCurrentDeleted: vi.fn(),
    onDeleted: vi.fn(),
    onDeleteFinal: vi.fn<(videoKeys: string[]) => void>(),
    onRenamed: vi.fn(),
    onOpenSettings: vi.fn(),
    onFocusComposer: vi.fn(),
  };
}

function titles(): string[] {
  return [...els.sidebar.chatList.querySelectorAll(".chat-open")].map((el) => el.textContent ?? "");
}

function itemFor(chatId: string): HTMLElement {
  const item = els.sidebar.chatList.querySelector<HTMLElement>(`[data-chat-id="${chatId}"]`);
  if (!item) throw new Error(`No list item for ${chatId}`);
  return item;
}

function click(root: HTMLElement, selector: string): void {
  root.querySelector<HTMLElement>(selector)?.click();
}

const NOW = new Date(2026, 10, 19, 15, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const BEACH: VideoAttachment = {
  name: "beach-trip.mp4",
  fileKey: "beach",
  durationSeconds: 60,
  width: 640,
  height: 360,
};

function groupTitles(): string[] {
  return [...els.sidebar.chatList.querySelectorAll(".chat-group-title")].map(
    (el) => el.textContent ?? "",
  );
}

// jsdom's Blob has no text().
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(blob);
  });
}

function userMessage(
  id: string,
  createdAt: number,
  video: VideoAttachment | undefined,
): ChatMessage {
  return {
    id,
    createdAt,
    role: "user",
    text: id,
    images: [],
    ...(video ? { video } : {}),
  };
}

async function seed(
  id: string,
  updatedAt: number,
  title: string,
  extra: Partial<Chat> = {},
): Promise<void> {
  const chat = { ...blankChat(SETTINGS.defaultModelId, id, updatedAt), title, ...extra };
  await store.putChat(chat);
  setChats(state, await store.listChats());
}

beforeEach(() => {
  els = mountPage();
  state = createAppState(SETTINGS);
  store = createMemoryStore();
  let next = 0;
  spies = makeSpies();
  timers = [];
  deps = {
    store,
    status: { show: vi.fn(), clear: vi.fn() },
    images: idleImages(),
    toast: initToast(els, { set: (run) => timers.push(run), clear: vi.fn() }),
    ...spies,
    newId: () => `chat-${++next}`,
    now: () => 100 + next,
  };
});

describe("initSidebar", () => {
  it("creates a new chat at the top of the list and opens it", async () => {
    await seed("old", 1, "Old chat");
    await store.putMessage("old", { id: "m", createdAt: 1, role: "user", text: "hi", images: [] });
    initSidebar(els, state, deps);
    els.sidebar.newChatButton.click();
    await vi.waitFor(() => expect(spies.onOpen).toHaveBeenCalledWith("chat-1"));
    expect(titles()).toEqual(["New chat", "Old chat"]);
    expect((await store.getChat("chat-1"))?.settings.modelId).toBe("qwen3-6-27b");
  });

  it("gives a new chat the default looking model", async () => {
    setSettings(state, { ...state.settings, defaultLookingModelId: "eyes" });
    initSidebar(els, state, deps);
    els.sidebar.newChatButton.click();
    await vi.waitFor(() => expect(spies.onOpen).toHaveBeenCalledWith("chat-1"));
    expect((await store.getChat("chat-1"))?.settings.lookingModelId).toBe("eyes");
  });

  it("gives a reused empty chat the default looking model of now", async () => {
    const onChatChanged = vi.fn();
    deps.onChatChanged = onChatChanged;
    await seed("old", 1, "Old chat");
    setSettings(state, {
      ...state.settings,
      defaultLookingModelId: "eyes",
      defaultLookingBaseUrl: "http://localhost:5001/v1",
    });
    initSidebar(els, state, deps);
    els.sidebar.newChatButton.click();
    await vi.waitFor(() => expect(spies.onOpen).toHaveBeenCalledWith("old"));
    expect((await store.getChat("old"))?.settings).toMatchObject({
      lookingModelId: "eyes",
      lookingBaseUrl: "http://localhost:5001/v1",
    });
    expect(onChatChanged).toHaveBeenCalled();
  });

  it("renames a chat inline and saves the new title", async () => {
    await seed("a", 1, "Chat A");
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-rename");
    const input = itemFor("a").querySelector<HTMLInputElement>(".chat-rename-input");
    if (!input) throw new Error("No rename input");
    input.value = "Beach day";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(titles()).toEqual(["Beach day"]));
    expect((await store.getChat("a"))?.title).toBe("Beach day");
    expect(spies.onRenamed).toHaveBeenCalled();
  });

  it("keeps the title when renaming is cancelled", async () => {
    await seed("a", 1, "Chat A");
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-rename");
    const input = itemFor("a").querySelector<HTMLInputElement>(".chat-rename-input");
    if (!input) throw new Error("No rename input");
    input.value = "Other";
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    input.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(titles()).toEqual(["Chat A"]);
  });
});

describe("deleting from the sidebar", () => {
  it("deletes a chat at once and reports deleting the open one", async () => {
    await seed("a", 2, "Chat A");
    await seed("b", 1, "Chat B");
    const current = state.chats.find((chat) => chat.id === "a") ?? null;
    setCurrentChat(state, current, []);
    initSidebar(els, state, deps);
    let chatWhenStopped: unknown = null;
    spies.onDeletingCurrent.mockImplementation(() => {
      chatWhenStopped = state.chats.find((chat) => chat.id === "a");
    });
    click(itemFor("a"), ".chat-delete");
    await vi.waitFor(() => expect(spies.onCurrentDeleted).toHaveBeenCalled());
    expect(titles()).toEqual(["Chat B"]);
    expect(chatWhenStopped).toBeDefined();
    expect(await store.getChat("a")).toBeUndefined();
  });

  it("keeps a background re-render from wiping a rename in progress", async () => {
    await seed("a", 1, "Chat A");
    const sidebar = initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-rename");
    const input = itemFor("a").querySelector<HTMLInputElement>(".chat-rename-input");
    if (!input) throw new Error("No rename input");
    input.value = "Half typed";
    sidebar.render();
    expect(itemFor("a").querySelector(".chat-rename-input")).toBe(input);
  });
});

describe("undoing a deleted chat", () => {
  it("restores a deleted chat with its messages and video handle from the undo toast", async () => {
    await seed("a", 2, "Chat A");
    await seed("b", 1, "Chat B");
    const hello = { id: "m", createdAt: 1, role: "user" as const, text: "hi", images: [] };
    await store.putMessage("a", hello);
    const handle = { kind: "file", name: "beach.mp4" } as unknown as FileSystemFileHandle;
    await store.putVideoHandle("a", handle);
    setCurrentChat(state, state.chats.find((chat) => chat.id === "a") ?? null, [hello]);
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-delete");
    await vi.waitFor(() => expect(els.toast.text.textContent).toBe('Deleted "Chat A"'));
    expect(spies.onDeleted).toHaveBeenCalled();
    els.toast.action.click();
    await vi.waitFor(() => expect(spies.onOpen).toHaveBeenCalledWith("a"));
    expect(titles()).toEqual(["Chat A", "Chat B"]);
    expect(await store.listMessages("a")).toEqual([hello]);
    expect(await store.getVideoHandle("a")).toBe(handle);
    expect(spies.onDeleteFinal).not.toHaveBeenCalled();
  });

  it("restores the chat as it was when deleted, not as the list last drew it", async () => {
    await seed("a", 1, "Chat A");
    initSidebar(els, state, deps);
    const chat = state.chats.find((entry) => entry.id === "a");
    if (!chat) throw new Error("No chat");
    replaceChat(state, { ...chat, sceneLog: [{ timeSeconds: 3, text: "added later" }] });
    click(itemFor("a"), ".chat-delete");
    await vi.waitFor(() => expect(els.toast.el.hidden).toBe(false));
    els.toast.action.click();
    await vi.waitFor(async () =>
      expect((await store.getChat("a"))?.sceneLog).toEqual([
        { timeSeconds: 3, text: "added later" },
      ]),
    );
  });

  it("lets go of the chat once the undo toast expires", async () => {
    await seed("a", 1, "Chat A");
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-delete");
    await vi.waitFor(() => expect(els.toast.el.hidden).toBe(false));
    timers.forEach((run) => run());
    expect(spies.onDeleteFinal).toHaveBeenCalledWith([]);
  });

  it("hands over every video the chat used, once each, when the undo toast expires", async () => {
    const city = { ...BEACH, name: "city.mp4", fileKey: "city" };
    await seed("a", 1, "Chat A", { video: city });
    await store.putMessage("a", userMessage("u1", 1, BEACH));
    await store.putMessage("a", userMessage("u2", 2, city));
    await store.putMessage("a", userMessage("u3", 3, undefined));
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-delete");
    await vi.waitFor(() => expect(els.toast.el.hidden).toBe(false));
    timers.forEach((run) => run());
    expect(spies.onDeleteFinal).toHaveBeenCalledTimes(1);
    expect(spies.onDeleteFinal.mock.calls[0]?.[0]?.sort()).toEqual(["beach", "city"]);
  });

  it("hands over the videos too when restoring the chat fails", async () => {
    await seed("a", 1, "Chat A", { video: BEACH });
    await store.putMessage("a", userMessage("u1", 1, BEACH));
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-delete");
    await vi.waitFor(() => expect(els.toast.el.hidden).toBe(false));
    store.putChat = () => Promise.reject(new Error("Disk full"));
    els.toast.action.click();
    await vi.waitFor(() => expect(spies.onDeleteFinal).toHaveBeenCalledWith(["beach"]));
  });

  it("releases nothing while the undo window is open or after an undo", async () => {
    await seed("a", 1, "Chat A", { video: BEACH });
    await store.putMessage("a", userMessage("u1", 1, BEACH));
    setCurrentChat(state, state.chats[0] ?? null, []);
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-delete");
    await vi.waitFor(() => expect(els.toast.el.hidden).toBe(false));
    expect(spies.onDeleteFinal).not.toHaveBeenCalled();
    els.toast.action.click();
    await vi.waitFor(() => expect(spies.onOpen).toHaveBeenCalledWith("a"));
    timers.forEach((run) => run());
    expect(spies.onDeleteFinal).not.toHaveBeenCalled();
  });

  it("removes the copies of a deleted chat's videos, but not one another chat still uses", async () => {
    const city = { ...BEACH, name: "city.mp4", fileKey: "city" };
    const remove = vi.fn(() => Promise.resolve());
    const storage = {
      supported: () => true,
      remove,
    } as unknown as VideoStorage;
    const copies = initVideoCopies(els, state, {
      store,
      status: { show: vi.fn(), clear: vi.fn() },
      confirm: vi.fn(() => true),
      isHeld: () => false,
      onProgress: vi.fn(),
      storage,
    });
    deps.onDeleteFinal = (videoKeys) => {
      for (const fileKey of videoKeys) void copies.release(fileKey);
    };
    await seed("a", 2, "Chat A", { video: city });
    await seed("b", 1, "Chat B", { video: city });
    await store.putMessage("a", userMessage("u1", 1, BEACH));
    await store.putMessage("a", userMessage("u2", 2, city));
    await store.putMessage("b", userMessage("u3", 1, city));
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-delete");
    await vi.waitFor(() => expect(els.toast.el.hidden).toBe(false));
    timers.forEach((run) => run());
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith("beach"));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("puts the chat back and says so when deleting fails", async () => {
    await seed("a", 1, "Chat A");
    setCurrentChat(state, state.chats[0] ?? null, []);
    store.deleteChat = () => Promise.reject(new Error("Disk full"));
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-delete");
    await vi.waitFor(() =>
      expect(els.toast.text.textContent).toBe("Could not delete the chat: Disk full"),
    );
    expect(titles()).toEqual(["Chat A"]);
    expect(spies.onOpen).toHaveBeenCalledWith("a");
    expect(spies.onDeleted).not.toHaveBeenCalled();
  });
});

describe("new chat reuse", () => {
  it("focuses the message box instead of creating a chat when the open one is empty", async () => {
    await seed("a", 1, "New chat");
    setCurrentChat(state, state.chats[0] ?? null, []);
    initSidebar(els, state, deps);
    els.sidebar.newChatButton.click();
    await vi.waitFor(() => expect(spies.onFocusComposer).toHaveBeenCalled());
    expect(state.chats).toHaveLength(1);
    expect(spies.onOpen).not.toHaveBeenCalled();
  });

  it("switches to another empty chat instead of creating a duplicate", async () => {
    await seed("empty", 1, "New chat");
    await seed("busy", 2, "Busy");
    const hello = { id: "m", createdAt: 1, role: "user" as const, text: "hi", images: [] };
    await store.putMessage("busy", hello);
    const busy = state.chats.find((chat) => chat.id === "busy") ?? null;
    setCurrentChat(state, busy, [hello]);
    initSidebar(els, state, deps);
    els.sidebar.newChatButton.click();
    await vi.waitFor(() => expect(spies.onOpen).toHaveBeenCalledWith("empty"));
    expect(state.chats).toHaveLength(2);
  });

  it("opens settings from the sidebar", () => {
    initSidebar(els, state, deps);
    els.sidebar.openSettingsButton.click();
    expect(spies.onOpenSettings).toHaveBeenCalled();
  });
});

describe("grouping chats by date", () => {
  it("shows a heading for each group that has chats, in the injected clock's terms", async () => {
    deps.now = () => NOW;
    await seed("a", NOW - 10 * DAY, "Old trip");
    await seed("b", NOW - 1000, "Fresh");
    initSidebar(els, state, deps);
    expect(groupTitles()).toEqual(["Today", "Previous 30 days"]);
    expect(titles()).toEqual(["Fresh", "Old trip"]);
  });
});

describe("searching chats", () => {
  it("filters the list as you type and says when nothing matches", async () => {
    await seed("a", 2, "Holiday", { video: BEACH });
    await seed("b", 1, "Cooking");
    initSidebar(els, state, deps);
    const search = els.sidebar.searchInput;
    search.value = "beach";
    search.dispatchEvent(new Event("input"));
    expect(titles()).toEqual(["Holiday"]);
    search.value = "nothing like this";
    search.dispatchEvent(new Event("input"));
    expect(titles()).toEqual([]);
    expect(els.sidebar.chatList.textContent).toContain("No chats match.");
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    search.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(search.value).toBe("");
    expect(titles()).toEqual(["Holiday", "Cooking"]);
  });

  it("marks chats that have a video attached", async () => {
    await seed("a", 2, "Holiday", { video: BEACH });
    await seed("b", 1, "Cooking");
    initSidebar(els, state, deps);
    expect(itemFor("a").querySelector(".chat-video-icon")).not.toBeNull();
    expect(itemFor("b").querySelector(".chat-video-icon")).toBeNull();
    expect(itemFor("a").querySelector(".chat-open")?.getAttribute("title")).toContain(
      "beach-trip.mp4",
    );
  });
});

describe("exporting a chat as Markdown", () => {
  it("downloads the chat as a .md file named after its title", async () => {
    await seed("a", 1, "Beach: day 1?");
    await store.putMessage("a", { id: "m", createdAt: 1, role: "user", text: "hi", images: [] });
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:chat");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-export");
    await vi.waitFor(() => expect(anchorClick).toHaveBeenCalled());
    const anchor = anchorClick.mock.contexts[0];
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error("No link was clicked");
    expect(anchor.download).toBe("Beach day 1.md");
    expect(anchor.href).toBe("blob:chat");
    const blob = createObjectURL.mock.calls[0]?.[0];
    if (!blob) throw new Error("No blob was downloaded");
    const markdown = await readText(blob);
    expect(markdown).toContain("# Beach: day 1?");
    expect(markdown).toContain("hi");
    anchorClick.mockRestore();
  });

  it("says so in the toast when the export fails", async () => {
    await seed("a", 1, "Chat A");
    store.listMessages = () => Promise.reject(new Error("Disk gone"));
    initSidebar(els, state, deps);
    click(itemFor("a"), ".chat-export");
    await vi.waitFor(() =>
      expect(els.toast.text.textContent).toBe("Could not export the chat: Disk gone"),
    );
  });
});

const TRIPS: Folder = { id: "trips", name: "Trips", createdAt: 1 };
const COOKING: Folder = { id: "cooking", name: "Cooking", createdAt: 2 };

function folderFor(folderId: string): HTMLElement {
  const item = els.sidebar.chatList.querySelector<HTMLElement>(`[data-folder-id="${folderId}"]`);
  if (!item) throw new Error(`No folder for ${folderId}`);
  return item;
}

function folderNames(): string[] {
  return [...els.sidebar.chatList.querySelectorAll(".chat-folder-name")].map(
    (el) => el.textContent ?? "",
  );
}

function titlesIn(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".chat-open")].map((el) => el.textContent ?? "");
}

function renameInput(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(".chat-rename-input");
  if (!input) throw new Error("No rename input");
  return input;
}

function moveOption(chatId: string, label: string): HTMLButtonElement {
  click(itemFor(chatId), ".chat-move-button");
  const option = [...itemFor(chatId).querySelectorAll<HTMLButtonElement>(".chat-move-option")].find(
    (el) => el.textContent === label,
  );
  if (!option) throw new Error(`No move option ${label}`);
  return option;
}

function drag(chatId: string, onto: HTMLElement): void {
  itemFor(chatId).dispatchEvent(new Event("dragstart", { bubbles: true }));
  onto.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
  onto.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
}

async function withFolders(...folders: Folder[]): Promise<void> {
  for (const folder of folders) await store.putFolder(folder);
  initSidebar(els, state, deps);
  await vi.waitFor(() => expect(folderNames()).toHaveLength(folders.length));
}

describe("folders in the sidebar", () => {
  it("creates a folder and names it inline", async () => {
    initSidebar(els, state, deps);
    els.sidebar.newFolderButton.click();
    await vi.waitFor(() => expect(folderNames()).toEqual([]));
    const input = renameInput(folderFor("chat-1"));
    expect(input.value).toBe("New folder");
    input.value = "Trips";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(folderNames()).toEqual(["Trips"]));
    expect(await store.listFolders()).toEqual([{ id: "chat-1", name: "Trips", createdAt: 101 }]);
  });

  it("shows folders above the date groups with their chats newest first", async () => {
    await seed("old", 1, "Old beach", { folderId: TRIPS.id });
    await seed("new", 3, "New beach", { folderId: TRIPS.id });
    await seed("loose", 2, "Loose");
    await withFolders(TRIPS);
    expect(titlesIn(folderFor("trips"))).toEqual(["New beach", "Old beach"]);
    expect(titles()).toEqual(["New beach", "Old beach", "Loose"]);
    expect(groupTitles()).toEqual(["Today"]);
  });

  it("collapses a folder and remembers it", async () => {
    await seed("a", 1, "Beach", { folderId: TRIPS.id });
    await withFolders(TRIPS);
    click(folderFor("trips"), ".chat-folder-toggle");
    await vi.waitFor(() =>
      expect(folderFor("trips").querySelector(".chat-folder-list")?.hasAttribute("hidden")).toBe(
        true,
      ),
    );
    const toggle = folderFor("trips").querySelector(".chat-folder-toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect((await store.listFolders())[0]?.collapsed).toBe(true);
  });
});

describe("moving chats between folders", () => {
  it("moves a chat into a folder and out again from its Move to menu", async () => {
    await seed("a", 1, "Beach");
    await withFolders(TRIPS, COOKING);
    const option = moveOption("a", "Trips");
    expect(option.getAttribute("role")).toBe("menuitemradio");
    option.click();
    await vi.waitFor(() => expect(titlesIn(folderFor("trips"))).toEqual(["Beach"]));
    expect((await store.getChat("a"))?.folderId).toBe("trips");
    expect(moveOption("a", "Trips").getAttribute("aria-checked")).toBe("true");
    const noFolder = [
      ...itemFor("a").querySelectorAll<HTMLButtonElement>(".chat-move-option"),
    ].find((el) => el.textContent === "No folder");
    noFolder?.click();
    await vi.waitFor(() => expect(titlesIn(folderFor("trips"))).toEqual([]));
    expect((await store.getChat("a"))?.folderId).toBeUndefined();
  });
});

describe("closing the Move to menu", () => {
  it("moves the chat even when removing the focused menu fires focusout", async () => {
    await seed("a", 1, "Beach");
    await withFolders(TRIPS);
    let dispatching = false;
    // A browser fires focusout while removing the focused menu, then fails on a node already gone.
    const remove = vi.spyOn(Element.prototype, "remove").mockImplementation(function (
      this: Element,
    ) {
      if (!this.classList.contains("chat-move-menu")) {
        this.parentNode?.removeChild(this);
        return;
      }
      if (!dispatching) {
        dispatching = true;
        this.parentElement?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        dispatching = false;
      }
      if (!this.parentNode) throw new DOMException("The node to be removed is no longer a child");
      this.parentNode.removeChild(this);
    });
    moveOption("a", "Trips").click();
    await vi.waitFor(() => expect(titlesIn(folderFor("trips"))).toEqual(["Beach"]));
    expect((await store.getChat("a"))?.folderId).toBe("trips");
    remove.mockRestore();
  });

  it("closes the Move to menu on Escape", async () => {
    await seed("a", 1, "Beach");
    await withFolders(TRIPS);
    const option = moveOption("a", "Trips");
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(itemFor("a").querySelector(".chat-move-menu")).toBeNull();
  });

  it("offers no Move to action while there are no folders", async () => {
    await seed("a", 1, "Beach");
    initSidebar(els, state, deps);
    expect(itemFor("a").querySelector(".chat-move-button")).toBeNull();
  });

  it("moves a dragged chat into a folder and back out onto the list", async () => {
    await seed("a", 1, "Beach");
    await withFolders(TRIPS);
    drag("a", folderFor("trips"));
    await vi.waitFor(() => expect(titlesIn(folderFor("trips"))).toEqual(["Beach"]));
    drag("a", els.sidebar.chatList);
    await vi.waitFor(() => expect(titlesIn(folderFor("trips"))).toEqual([]));
    expect((await store.getChat("a"))?.folderId).toBeUndefined();
  });
});

describe("closing the Move to menu on a press or focus elsewhere", () => {
  it("moves the chat when a click blurs the option to nothing first, as Safari does", async () => {
    await seed("a", 1, "Beach");
    await withFolders(TRIPS);
    const option = moveOption("a", "Trips");
    option.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    // A browser drops the click on an option removed between mousedown and mouseup.
    expect(option.isConnected).toBe(true);
    option.click();
    await vi.waitFor(() => expect(titlesIn(folderFor("trips"))).toEqual(["Beach"]));
  });

  it("closes the Move to menu on a press outside it or focus moving out", async () => {
    await seed("a", 1, "Beach");
    await seed("b", 2, "Park");
    await withFolders(TRIPS);
    moveOption("a", "Trips");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(itemFor("a").querySelector(".chat-move-menu")).toBeNull();
    const option = moveOption("a", "Trips");
    const elsewhere = itemFor("b").querySelector(".chat-open");
    option.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: elsewhere }));
    expect(itemFor("a").querySelector(".chat-move-menu")).toBeNull();
  });
});

describe("closing the Move to menu on a re-render", () => {
  it("stops listening for outside presses once the list is redrawn", async () => {
    await seed("a", 1, "Beach");
    await withFolders(TRIPS);
    const added = vi.spyOn(document, "addEventListener");
    moveOption("a", "Trips");
    const options = added.mock.calls.find(([type]) => type === "pointerdown")?.[2];
    added.mockRestore();
    const signal = typeof options === "object" ? options.signal : undefined;
    expect(signal?.aborted).toBe(false);
    els.sidebar.searchInput.dispatchEvent(new Event("input"));
    expect(signal?.aborted).toBe(true);
  });
});

describe("folder actions", () => {
  it("renames a folder inline", async () => {
    await withFolders(TRIPS);
    click(folderFor("trips"), ".folder-rename");
    const input = renameInput(folderFor("trips"));
    input.value = "Holidays";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(folderNames()).toEqual(["Holidays"]));
    expect((await store.listFolders())[0]?.name).toBe("Holidays");
  });

  it("deletes a folder, keeping its chats, and puts it back on Undo", async () => {
    await seed("a", 1, "Beach", { folderId: TRIPS.id });
    await withFolders(TRIPS);
    click(folderFor("trips"), ".folder-delete");
    await vi.waitFor(() => expect(els.toast.text.textContent).toBe('Deleted folder "Trips"'));
    expect(folderNames()).toEqual([]);
    expect(titles()).toEqual(["Beach"]);
    expect(await store.listFolders()).toEqual([]);
    expect((await store.getChat("a"))?.folderId).toBeUndefined();
    els.toast.action.click();
    await vi.waitFor(() => expect(titlesIn(folderFor("trips"))).toEqual(["Beach"]));
    expect(await store.listFolders()).toEqual([TRIPS]);
    expect((await store.getChat("a"))?.folderId).toBe("trips");
  });
});

describe("deleting a folder that fails part way", () => {
  it("puts every chat back in the folder and keeps it when a move fails", async () => {
    await seed("a", 2, "Beach", { folderId: TRIPS.id });
    await seed("b", 1, "Dunes", { folderId: TRIPS.id });
    await withFolders(TRIPS);
    const putChat = store.putChat.bind(store);
    let calls = 0;
    store.putChat = (chat) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error("Disk full")) : putChat(chat);
    };
    click(folderFor("trips"), ".folder-delete");
    await vi.waitFor(() =>
      expect(els.toast.text.textContent).toBe("Could not delete the folder: Disk full"),
    );
    expect(await store.listFolders()).toEqual([TRIPS]);
    expect((await store.getChat("a"))?.folderId).toBe("trips");
    expect((await store.getChat("b"))?.folderId).toBe("trips");
    expect(titlesIn(folderFor("trips"))).toEqual(["Beach", "Dunes"]);
  });

  it("puts the chats back when the folder itself cannot be deleted", async () => {
    await seed("a", 1, "Beach", { folderId: TRIPS.id });
    await withFolders(TRIPS);
    store.deleteFolder = () => Promise.reject(new Error("Disk full"));
    click(folderFor("trips"), ".folder-delete");
    await vi.waitFor(() =>
      expect(els.toast.text.textContent).toBe("Could not delete the folder: Disk full"),
    );
    expect(folderNames()).toEqual(["Trips"]);
    expect((await store.getChat("a"))?.folderId).toBe("trips");
  });
});

describe("folders with search, new chats and restores", () => {
  it("searches inside folders, showing matches under their folder and hiding empty ones", async () => {
    await seed("a", 2, "Beach", { folderId: TRIPS.id });
    await seed("b", 1, "Pasta", { folderId: COOKING.id });
    await withFolders({ ...TRIPS, collapsed: true }, COOKING);
    const search = els.sidebar.searchInput;
    search.value = "beach";
    search.dispatchEvent(new Event("input"));
    expect(folderNames()).toEqual(["Trips"]);
    expect(titlesIn(folderFor("trips"))).toEqual(["Beach"]);
    expect(folderFor("trips").querySelector(".chat-folder-list")?.hasAttribute("hidden")).toBe(
      false,
    );
  });

  it("puts a new chat in no folder even when a filed chat is open", async () => {
    await seed("a", 1, "Beach", { folderId: TRIPS.id });
    const hello = { id: "m", createdAt: 1, role: "user" as const, text: "hi", images: [] };
    await store.putMessage("a", hello);
    setCurrentChat(state, state.chats[0] ?? null, [hello]);
    await withFolders(TRIPS);
    els.sidebar.newChatButton.click();
    await vi.waitFor(() => expect(spies.onOpen).toHaveBeenCalledWith("chat-1"));
    expect((await store.getChat("chat-1"))?.folderId).toBeUndefined();
    expect(titlesIn(folderFor("trips"))).toEqual(["Beach"]);
  });

  it("picks up folders added to the store, as a restore does, on the next render", async () => {
    const sidebar = initSidebar(els, state, deps);
    await store.putFolder(TRIPS);
    sidebar.render();
    await vi.waitFor(() => expect(folderNames()).toEqual(["Trips"]));
  });
});
