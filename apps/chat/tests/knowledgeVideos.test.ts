import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankChat } from "../src/chat/chats";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setCurrentChat, type AppState } from "../src/state";
import type { ChatMessage, VideoAttachment } from "../src/types";
import { chatVideos, initVideoPicker } from "../src/ui/knowledgeVideos";
import { mountPage } from "./support/page";

function video(name: string): VideoAttachment {
  return { name, fileKey: `${name}-key`, durationSeconds: 60, width: 640, height: 360 };
}

const BEACH = video("beach.mp4");
const PARK = video("park.mp4");
const DOCK = video("dock.mp4");

function sent(id: string, attached?: VideoAttachment): ChatMessage {
  return {
    id,
    createdAt: 1,
    role: "user",
    text: "",
    images: [],
    ...(attached && { video: attached }),
  };
}

const MESSAGES = [sent("u1", BEACH), sent("u2"), sent("u3", PARK), sent("u4", BEACH)];
const WITH_DOCK = [...MESSAGES, sent("u5", DOCK)];

let els: AppElements;
let state: AppState;

function openChat(id: string, current: VideoAttachment | undefined, messages: ChatMessage[]) {
  setCurrentChat(state, { ...blankChat("m", id, 1), ...(current && { video: current }) }, messages);
}

function optionTexts(): string[] {
  return [...els.knowledge.videoSelect.options].map((option) => option.text);
}

function pick(fileKey: string): void {
  els.knowledge.videoSelect.value = fileKey;
  els.knowledge.videoSelect.dispatchEvent(new Event("change"));
}

beforeEach(() => {
  els = mountPage();
  state = createAppState(DEFAULT_SETTINGS);
});

describe("chatVideos", () => {
  it("lists the attached video first, then older ones newest first, each once", () => {
    const videos = chatVideos(BEACH, [...MESSAGES, sent("u5", DOCK), sent("u6", BEACH)]);
    expect(videos.map((entry) => [entry.video.name, entry.current])).toEqual([
      ["beach.mp4", true],
      ["dock.mp4", false],
      ["park.mp4", false],
    ]);
  });

  it("counts the latest snapshot as the attached video after a changed file is reattached", () => {
    const reattached = { ...BEACH, fileKey: "beach-changed-key" };
    expect(chatVideos(reattached, MESSAGES).map((entry) => entry.video.name)).toEqual([
      "beach.mp4",
      "park.mp4",
    ]);
  });

  it("lists every snapshot as older while no video is attached", () => {
    expect(chatVideos(undefined, MESSAGES).map((entry) => entry.video.name)).toEqual([
      "beach.mp4",
      "park.mp4",
    ]);
  });
});

describe("video picker", () => {
  it("defaults to the attached video and marks it current", () => {
    openChat("chat", DOCK, WITH_DOCK);
    const picker = initVideoPicker(els, state, { onPick: vi.fn() });
    expect(optionTexts()).toEqual(["dock.mp4 (current)", "beach.mp4", "park.mp4"]);
    expect(picker.shown()?.video).toBe(DOCK);
    expect(els.knowledge.videoNote.hidden).toBe(true);
  });

  it("shows an older video on request, with a note that it is not attached", () => {
    openChat("chat", DOCK, WITH_DOCK);
    const onPick = vi.fn();
    const picker = initVideoPicker(els, state, { onPick });
    pick(PARK.fileKey);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(picker.shown()).toEqual({ video: PARK, current: false });
    expect(els.knowledge.videoNote.hidden).toBe(false);
    picker.showCurrent();
    expect(picker.shown()?.video).toBe(DOCK);
    expect(els.knowledge.videoSelect.value).toBe(DOCK.fileKey);
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  it("goes back to the attached video when the chat or its video changes", () => {
    openChat("chat", DOCK, WITH_DOCK);
    const picker = initVideoPicker(els, state, { onPick: vi.fn() });
    pick(PARK.fileKey);
    openChat("chat", BEACH, MESSAGES);
    picker.render();
    expect(picker.shown()?.video).toBe(BEACH);
    pick(PARK.fileKey);
    openChat("other", BEACH, MESSAGES);
    expect(picker.shown()?.video).toBe(BEACH);
  });

  it("hides itself while the chat has no video", () => {
    openChat("chat", undefined, []);
    const picker = initVideoPicker(els, state, { onPick: vi.fn() });
    expect(picker.shown()).toBeUndefined();
    expect(els.knowledge.videoField.hidden).toBe(true);
  });
});
