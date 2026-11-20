import { beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { createMemoryStore } from "../src/chat/store";
import { queryElements, type AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  blankChat,
  createAppState,
  replaceChat,
  setCurrentChat,
  type AppState,
} from "../src/state";
import type { Chat, ChatStore, SceneNote, StreamChat, VideoAttachment } from "../src/types";
import { initSceneLog, sceneLogTokens } from "../src/ui/sceneLog";
import { initToast } from "../src/ui/toast";

const VIDEO: VideoAttachment = {
  name: "beach.mp4",
  fileKey: "beach",
  durationSeconds: 120,
  width: 640,
  height: 360,
};

let els: AppElements;
let state: AppState;
let store: ChatStore;
let seek: ReturnType<typeof vi.fn>;

function stream(reply: string): StreamChat {
  return async function* () {
    await Promise.resolve();
    yield { type: "text", delta: reply };
    yield { type: "done", finishReason: "stop" };
  };
}

async function openChat(notes: SceneNote[], video: VideoAttachment | null = VIDEO, id = "chat") {
  const chat: Chat = { ...blankChat("model", id, 1), sceneLog: notes, ...(video && { video }) };
  await store.putChat(chat);
  replaceChat(state, chat);
  setCurrentChat(state, chat, []);
}

function panel(streamChat: StreamChat = stream(""), currentTime = () => 42) {
  return initSceneLog(els, state, {
    store,
    toast: initToast(els, { set: () => 0, clear: vi.fn() }),
    streamChat,
    currentTime,
    seek,
    onChanged: vi.fn(),
  });
}

function items(): HTMLLIElement[] {
  return [...els.sceneLog.list.querySelectorAll("li")];
}

function texts(): string[] {
  return items().map((item) => item.querySelector("span")?.textContent ?? "");
}

async function savedLog(): Promise<SceneNote[] | undefined> {
  return (await store.getChat("chat"))?.sceneLog;
}

beforeEach(() => {
  document.body.innerHTML = indexHtml;
  els = queryElements();
  state = createAppState(DEFAULT_SETTINGS);
  store = createMemoryStore();
  seek = vi.fn();
});

const notes = [
  { timeSeconds: 30, text: "door opens" },
  { timeSeconds: 5, text: "she enters" },
];

describe("scene log", () => {
  it("lists notes in time order with a rough token count", async () => {
    await openChat(notes);
    panel();
    expect(texts()).toEqual([" she enters", " door opens"]);
    expect(els.sceneLog.count.textContent).toBe(
      `2 notes, about ${sceneLogTokens(notes)} tokens (approximate)`,
    );
    expect(els.sceneLog.empty.hidden).toBe(true);
  });

  it("names the current video it holds notes about", async () => {
    await openChat(notes);
    panel();
    expect(els.sceneLog.title.textContent).toBe(`Scene log for ${VIDEO.name}`);
  });

  it("seeks from a note's time", async () => {
    await openChat(notes);
    panel();
    items()[0]?.querySelector<HTMLButtonElement>(".timestamp")?.click();
    expect(seek).toHaveBeenCalledWith(5);
  });

  it("deletes a note and brings it back with Undo", async () => {
    await openChat(notes);
    panel();
    items()[0]?.querySelector<HTMLButtonElement>(".note-delete")?.click();
    await vi.waitFor(() => expect(items()).toHaveLength(1));
    expect(await savedLog()).toEqual([notes[0]]);
    els.toast.action.click();
    await vi.waitFor(() => expect(texts()).toEqual([" she enters", " door opens"]));
  });

  it("edits a note's text and time inline", async () => {
    await openChat(notes);
    panel();
    items()[1]?.querySelector<HTMLButtonElement>(".note-edit")?.click();
    const time = els.sceneLog.list.querySelector<HTMLInputElement>(".note-time-input");
    const text = els.sceneLog.list.querySelector<HTMLInputElement>(".note-text-input");
    expect(time?.value).toBe("0:30");
    expect(document.activeElement).toBe(text);
    if (!time || !text) throw new Error("No editor");
    time.value = "0:02";
    text.value = "door creaks open";
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(texts()).toEqual([" door creaks open", " she enters"]));
    expect(await savedLog()).toContainEqual({ timeSeconds: 2, text: "door creaks open" });
  });
});

describe("scene log editing", () => {
  it("keeps the editor open on a time it cannot read, and Escape cancels", async () => {
    await openChat(notes);
    panel();
    items()[0]?.querySelector<HTMLButtonElement>(".note-edit")?.click();
    const time = els.sceneLog.list.querySelector<HTMLInputElement>(".note-time-input");
    if (!time) throw new Error("No editor");
    time.value = "later";
    time.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(time.getAttribute("aria-invalid")).toBe("true");
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    time.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(texts()).toEqual([" she enters", " door opens"]);
  });

  it("adds a note at the current playback time", async () => {
    await openChat([]);
    panel(stream(""), () => 75.4);
    expect(els.sceneLog.empty.hidden).toBe(false);
    els.sceneLog.addButton.click();
    const time = els.sceneLog.list.querySelector<HTMLInputElement>(".note-time-input");
    const text = els.sceneLog.list.querySelector<HTMLInputElement>(".note-text-input");
    expect(time?.value).toBe("1:15");
    if (!text) throw new Error("No editor");
    text.value = "the boat leaves";
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(async () =>
      expect(await savedLog()).toEqual([{ timeSeconds: 75, text: "the boat leaves" }]),
    );
  });

  it("drops an open editor when the chat changes instead of saving into the new chat", async () => {
    await openChat(notes);
    const log = panel();
    items()[0]?.querySelector<HTMLButtonElement>(".note-edit")?.click();
    await openChat([], VIDEO, "other");
    log.render();
    expect(els.sceneLog.list.querySelector(".note-text-input")).toBeNull();
    expect(els.sceneLog.addButton.disabled).toBe(false);
    expect((await store.getChat("other"))?.sceneLog).toEqual([]);
  });

  it("saves an edit into the chat it was started in", async () => {
    await openChat(notes);
    panel();
    items()[0]?.querySelector<HTMLButtonElement>(".note-edit")?.click();
    const text = els.sceneLog.list.querySelector<HTMLInputElement>(".note-text-input");
    if (!text) throw new Error("No editor");
    text.value = "she walks in";
    await openChat([], VIDEO, "other");
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(async () =>
      expect(await savedLog()).toContainEqual({ timeSeconds: 5, text: "she walks in" }),
    );
    expect((await store.getChat("other"))?.sceneLog).toEqual([]);
  });

  it("only adds notes when a video is attached", async () => {
    await openChat([], null);
    panel();
    expect(els.sceneLog.addButton.disabled).toBe(true);
  });
});

describe("scene log condensing", () => {
  it("previews a condensed log and saves it only when accepted", async () => {
    await openChat(notes);
    panel(stream("[0:05] She enters and the door opens"));
    els.sceneLog.condenseButton.click();
    await vi.waitFor(() => expect(els.sceneLog.preview.hidden).toBe(false));
    expect(els.sceneLog.previewList.textContent).toContain("She enters and the door opens");
    expect(await savedLog()).toHaveLength(2);
    els.sceneLog.acceptButton.click();
    await vi.waitFor(async () =>
      expect(await savedLog()).toEqual([{ timeSeconds: 5, text: "She enters and the door opens" }]),
    );
    expect(els.sceneLog.preview.hidden).toBe(true);
  });

  it("discards a condensed preview", async () => {
    await openChat(notes);
    panel(stream("[0:05] Merged"));
    els.sceneLog.condenseButton.click();
    await vi.waitFor(() => expect(els.sceneLog.preview.hidden).toBe(false));
    els.sceneLog.discardButton.click();
    expect(els.sceneLog.preview.hidden).toBe(true);
    expect(await savedLog()).toEqual(notes);
  });

  it("shows a condense status only in the chat it ran for", async () => {
    await openChat(notes);
    const failing: StreamChat = async function* () {
      await Promise.resolve();
      yield* [];
      throw new Error("Server busy");
    };
    const log = panel(failing);
    els.sceneLog.condenseButton.click();
    await vi.waitFor(() => expect(els.sceneLog.status.textContent).toBe("Server busy"));
    await openChat(notes, VIDEO, "other");
    log.render();
    expect(els.sceneLog.status.textContent).toBe("");
    await openChat(notes);
    log.render();
    expect(els.sceneLog.status.textContent).toBe("Server busy");
  });

  it("reports a failed condense in its status line", async () => {
    await openChat(notes);
    const failing: StreamChat = async function* () {
      await Promise.resolve();
      yield* [];
      throw new Error("Server busy");
    };
    panel(failing);
    els.sceneLog.condenseButton.click();
    await vi.waitFor(() => expect(els.sceneLog.status.textContent).toBe("Server busy"));
    expect(els.sceneLog.status.classList.contains("is-error")).toBe(true);
    expect(els.sceneLog.stopButton.hidden).toBe(true);
  });
});
