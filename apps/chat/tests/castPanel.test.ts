import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  createAppState,
  replaceChat,
  setCurrentChat,
  setModels,
  type AppState,
} from "../src/state";
import type {
  CastCard,
  Chat,
  ChatMessage,
  ChatRequest,
  ChatStore,
  StreamChat,
  VideoAttachment,
} from "../src/types";
import { initCastPanel, type CastPanelDeps } from "../src/ui/knowledge/castPanel";
import { model } from "./support/factories";
import { mountPage, stillToast } from "./support/page";
import { replyWith } from "./support/streams";

const VIDEO: VideoAttachment = {
  name: "beach.mp4",
  fileKey: "beach",
  durationSeconds: 120,
  width: 640,
  height: 360,
};

const MARA: CastCard = { id: "c1", name: "Mara", description: "Red coat", firstSeenSeconds: 12 };

let els: AppElements;
let state: AppState;
let store: ChatStore;
let seek: ReturnType<typeof vi.fn>;
let ids: number;

async function openChat(
  video: VideoAttachment | null = VIDEO,
  messages: ChatMessage[] = [],
  id = "chat",
) {
  const chat: Chat = { ...blankChat("model", id, 1), ...(video && { video }) };
  await store.putChat(chat);
  replaceChat(state, chat);
  setCurrentChat(state, chat, messages);
}

function panel(streamChat: StreamChat = replyWith(""), shownVideo?: CastPanelDeps["shownVideo"]) {
  return initCastPanel(els, state, {
    store,
    toast: stillToast(els),
    streamChat,
    seek,
    onChanged: vi.fn(),
    toDataUrl: () => Promise.resolve("data:image/jpeg;base64,AAAA"),
    newId: () => `new-${++ids}`,
    now: () => 9,
    ...(shownVideo && { shownVideo }),
  });
}

function names(): string[] {
  return [...els.cast.list.querySelectorAll(".cast-name")].map((el) => el.textContent ?? "");
}

async function savedCards(): Promise<CastCard[] | undefined> {
  return (await store.getCast("beach"))?.cards;
}

function editor() {
  const name = els.cast.list.querySelector<HTMLInputElement>(".cast-name-input");
  const description = els.cast.list.querySelector<HTMLTextAreaElement>(".cast-description-input");
  const time = els.cast.list.querySelector<HTMLInputElement>(".cast-time-input");
  if (!name || !description || !time) throw new Error("No editor");
  return { name, description, time };
}

function clickButton(root: ParentNode, label: string): void {
  const button = [...root.querySelectorAll("button")].find((el) => el.textContent === label);
  button?.click();
}

beforeEach(() => {
  els = mountPage();
  state = createAppState(DEFAULT_SETTINGS);
  store = createMemoryStore();
  seek = vi.fn();
  ids = 0;
});

describe("cast panel", () => {
  it("explains and disables itself while no video is attached", async () => {
    await openChat(null);
    panel();
    expect(els.cast.notice.hidden).toBe(false);
    expect(els.cast.addButton.disabled).toBe(true);
    expect(els.cast.suggestButton.disabled).toBe(true);
  });

  it("lists the stored cast for the chat's video and seeks to a first sighting", async () => {
    await store.putCast({ fileKey: "beach", cards: [MARA], updatedAt: 1 });
    await openChat();
    panel();
    await vi.waitFor(() => expect(names()).toEqual(["Mara"]));
    els.cast.list.querySelector<HTMLButtonElement>(".timestamp")?.click();
    expect(seek).toHaveBeenCalledWith(12);
  });
});

describe("an older video's people", () => {
  const PARK: VideoAttachment = { ...VIDEO, name: "park.mp4", fileKey: "park" };

  it("names the video shown", async () => {
    await openChat();
    panel();
    expect(els.cast.title.textContent).toBe("People in beach.mp4");
  });

  it("shows what was saved for it read only, and seeks that video", async () => {
    await store.putCast({ fileKey: "park", cards: [MARA], updatedAt: 1 });
    await openChat();
    panel(replyWith(""), () => ({ video: PARK, current: false }));
    await vi.waitFor(() => expect(names()).toEqual(["Mara"]));
    expect(els.cast.title.textContent).toBe("People in park.mp4");
    expect(els.cast.list.querySelector(".note-edit, .note-delete")).toBeNull();
    els.cast.list.querySelector<HTMLButtonElement>(".timestamp")?.click();
    expect(seek).toHaveBeenCalledWith(12, PARK);
    expect(els.cast.addButton.hidden).toBe(true);
    expect(els.cast.suggestButton.hidden).toBe(true);
  });

  it("says when nothing was saved for it", async () => {
    await openChat();
    panel(replyWith(""), () => ({ video: PARK, current: false }));
    await vi.waitFor(() => expect(els.cast.empty.hidden).toBe(false));
    expect(els.cast.empty.textContent).toBe("No people were saved for this video.");
  });

  it("drops a pending Undo once another video is shown", async () => {
    await store.putCast({ fileKey: "beach", cards: [MARA], updatedAt: 1 });
    await store.putCast({ fileKey: "park", cards: [], updatedAt: 1 });
    await openChat();
    let shown = { video: VIDEO, current: true };
    const cast = panel(replyWith(""), () => shown);
    await vi.waitFor(() => expect(names()).toEqual(["Mara"]));
    els.cast.list.querySelector<HTMLButtonElement>(".note-delete")?.click();
    shown = { video: PARK, current: false };
    cast.render();
    expect(els.toast.el.hidden).toBe(true);
    els.toast.action.click();
    expect(await store.getCast("park")).toEqual({ fileKey: "park", cards: [], updatedAt: 1 });
    expect((await store.getCast("beach"))?.cards).toEqual([]);
  });
});

describe("cast panel editing", () => {
  it("adds a card", async () => {
    await openChat();
    panel();
    els.cast.addButton.click();
    const { name, description, time } = editor();
    expect(document.activeElement).toBe(name);
    name.value = "Theo";
    description.value = "Tall, grey beard";
    time.value = "1:05";
    clickButton(els.cast.list, "Save");
    expect(names()).toEqual(["Theo"]);
    await vi.waitFor(async () =>
      expect(await savedCards()).toEqual([
        { id: "new-1", name: "Theo", description: "Tall, grey beard", firstSeenSeconds: 65 },
      ]),
    );
  });

  it("will not save a card without a name or with an unreadable time", async () => {
    await openChat();
    panel();
    els.cast.addButton.click();
    const { name, time } = editor();
    time.value = "later";
    clickButton(els.cast.list, "Save");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(time.getAttribute("aria-invalid")).toBe("true");
    expect(await savedCards()).toBeUndefined();
  });

  it("edits a card and clears its first-seen time", async () => {
    await store.putCast({ fileKey: "beach", cards: [MARA], updatedAt: 1 });
    await openChat();
    panel();
    await vi.waitFor(() => expect(names()).toEqual(["Mara"]));
    clickButton(els.cast.list, "Edit");
    const { name, time } = editor();
    name.value = "Mara Vance";
    time.value = "";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(async () =>
      expect(await savedCards()).toEqual([
        { id: "c1", name: "Mara Vance", description: "Red coat" },
      ]),
    );
  });

  it("removes a card and puts it back with Undo", async () => {
    await store.putCast({ fileKey: "beach", cards: [MARA], updatedAt: 1 });
    await openChat();
    panel();
    await vi.waitFor(() => expect(names()).toEqual(["Mara"]));
    els.cast.list.querySelector<HTMLButtonElement>(".note-delete")?.click();
    expect(names()).toEqual([]);
    els.toast.action.click();
    expect(names()).toEqual(["Mara"]);
    await vi.waitFor(async () => expect(await savedCards()).toEqual([MARA]));
  });
});

describe("cast panel edit keys and focus", () => {
  it("keeps the card unchanged when Enter is pressed on Cancel", async () => {
    await store.putCast({ fileKey: "beach", cards: [MARA], updatedAt: 1 });
    await openChat();
    panel();
    await vi.waitFor(() => expect(names()).toEqual(["Mara"]));
    clickButton(els.cast.list, "Edit");
    editor().name.value = "Mara Vance";
    const cancel = [...els.cast.list.querySelectorAll("button")].find(
      (el) => el.textContent === "Cancel",
    );
    cancel?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    cancel?.click();
    expect(names()).toEqual(["Mara"]);
    expect(await savedCards()).toEqual([MARA]);
  });

  it("does not save on the Enter that confirms an IME composition", async () => {
    await openChat();
    panel();
    els.cast.addButton.click();
    const { name } = editor();
    name.value = "Theo";
    name.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
    expect(els.cast.list.querySelector(".cast-name-input")).toBe(name);
    expect(await savedCards()).toBeUndefined();
  });

  it("returns focus to the Add button after Save or Cancel", async () => {
    await openChat();
    panel();
    els.cast.addButton.click();
    clickButton(els.cast.list, "Cancel");
    expect(document.activeElement).toBe(els.cast.addButton);
    els.cast.addButton.click();
    editor().name.value = "Theo";
    clickButton(els.cast.list, "Save");
    expect(document.activeElement).toBe(els.cast.addButton);
  });
});

describe("cast panel editing across chats", () => {
  it("drops an open editor when the chat switches to another video", async () => {
    await openChat();
    const cast = panel();
    els.cast.addButton.click();
    editor().name.value = "Theo";
    await openChat({ ...VIDEO, fileKey: "park" }, [], "other");
    cast.render();
    expect(els.cast.list.querySelector(".cast-name-input")).toBeNull();
    expect(els.cast.addButton.disabled).toBe(false);
    expect(await store.getCast("park")).toBeUndefined();
  });
});

describe("cast panel suggestions", () => {
  it("suggests cards from the overview sheets and keeps existing ones", async () => {
    await store.putCast({ fileKey: "beach", cards: [MARA], updatedAt: 1 });
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const imageId = await store.putImage(blob);
    const overview: ChatMessage = {
      id: "u1",
      createdAt: 1,
      role: "user",
      text: "",
      images: [
        {
          id: imageId,
          pinned: false,
          source: {
            kind: "sheet",
            call: "overview",
            name: "grid_0001",
            startSeconds: 0,
            endSeconds: 120,
            frameCount: 16,
          },
        },
      ],
    };
    await openChat(VIDEO, [overview]);
    const requests: ChatRequest[] = [];
    panel(replyWith("Mara | in red | 0:12\nTheo | grey beard | 1:00", requests));
    await vi.waitFor(() => expect(names()).toEqual(["Mara"]));
    els.cast.suggestButton.click();
    await vi.waitFor(() => expect(names()).toEqual(["Mara", "Theo"]));
    expect(els.cast.status.textContent).toBe("Added 1 person.");
    expect(JSON.stringify(requests[0]?.messages)).toContain("data:image/jpeg;base64,AAAA");
    expect((await savedCards())?.[0]).toEqual(MARA);
  });

  it("asks for an overview or notes before suggesting from nothing", async () => {
    await openChat();
    panel(replyWith("Unused | x | 0:01"));
    els.cast.suggestButton.click();
    await vi.waitFor(() => expect(els.cast.status.textContent).toContain("Wait for the overview"));
    expect(els.cast.status.classList.contains("is-error")).toBe(true);
  });
});

describe("cast panel suggestions with a looking model", () => {
  const own = "http://localhost:5001/v1";

  async function openLooking(messages: ChatMessage[]): Promise<void> {
    state = createAppState({ ...state.settings, lookingBaseUrl: own, apiKeys: { [own]: "key" } });
    const chat: Chat = {
      ...blankChat("model", "chat", 1, "eyes", own),
      video: VIDEO,
      sceneLog: [{ timeSeconds: 1, text: "Mara waves" }],
    };
    await store.putChat(chat);
    replaceChat(state, chat);
    setCurrentChat(state, chat, messages);
  }

  it("sends it the overview alone, on its own connection", async () => {
    const id = await store.putImage(new Blob(["sheet"], { type: "image/jpeg" }));
    const source = {
      ...{ kind: "sheet" as const, call: "overview", name: "grid_0001" },
      ...{ startSeconds: 0, endSeconds: 120, frameCount: 16 },
    };
    const images = [{ id, pinned: false, source }];
    await openLooking([{ id: "u1", createdAt: 1, role: "user", text: "", images }]);
    const sent: { baseUrl: string; model: string }[] = [];
    const requests: ChatRequest[] = [];
    const reply = replyWith("Mara | in red | 0:12", requests);
    panel((api, request, signal) => {
      sent.push({ baseUrl: api.baseUrl, model: request.model });
      return reply(api, request, signal);
    });
    els.cast.suggestButton.click();
    await vi.waitFor(() => expect(sent).toEqual([{ baseUrl: own, model: "eyes" }]));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(JSON.stringify(requests)).toContain("data:image/jpeg");
    expect(JSON.stringify(requests)).not.toMatch(/Scene log|Mara waves/);
  });

  it("asks for the overview, whatever notes there are", async () => {
    await openLooking([]);
    const streamChat = vi.fn<StreamChat>();
    panel(streamChat);
    els.cast.suggestButton.click();
    await vi.waitFor(() =>
      expect(els.cast.status.textContent).toBe("Wait for the overview to finish."),
    );
    expect(streamChat).not.toHaveBeenCalled();
  });
});

describe("cast panel suggestions from a long overview", () => {
  async function sheetsSent(lookingId: string): Promise<number> {
    const images = await Promise.all(
      Array.from({ length: 5 }, async (_, index) => ({
        id: await store.putImage(new Blob([String(index)], { type: "image/jpeg" })),
        pinned: false,
        source: {
          kind: "sheet" as const,
          call: "overview",
          name: `grid_${index}`,
          startSeconds: index,
          endSeconds: index + 1,
          frameCount: 4,
        },
      })),
    );
    setModels(state, [model("eyes", { maxImages: 2 })]);
    const overview: ChatMessage = { id: "u1", createdAt: 1, role: "user", text: "", images };
    const chat: Chat = { ...blankChat("model", "chat", 1, lookingId), video: VIDEO };
    await store.putChat(chat);
    replaceChat(state, chat);
    setCurrentChat(state, chat, [overview]);
    const requests: ChatRequest[] = [];
    panel(replyWith("Mara | in red | 0:12", requests));
    els.cast.suggestButton.click();
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    return JSON.stringify(requests[0]).split("data:image/jpeg").length - 1;
  }

  it("sends no more sheets than the looking model takes", async () => {
    expect(await sheetsSent("eyes")).toBe(2);
  });

  it("sends them all to a chat's own model, as it always did", async () => {
    expect(await sheetsSent("")).toBe(5);
  });
});
