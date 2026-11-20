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
  setRunning,
  upsertMessage,
  type AppState,
} from "../src/state";
import type {
  AssistantMessage,
  Chat,
  ChatMessage,
  ChatStore,
  ImageRef,
  StreamChat,
  UserMessage,
} from "../src/types";
import { initConversation } from "../src/ui/conversation";
import { initMessageActions, type MessageActions } from "../src/ui/messageActions";
import { initToast } from "../src/ui/toast";
import type * as Tools from "../src/video/tools";
import { createToolRunner, type ToolContext } from "../src/video/tools";

vi.mock("@vid2grid/browser", () => ({}));
vi.mock("../src/video/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof Tools>();
  return { ...actual, createToolRunner: vi.fn(actual.createToolRunner) };
});

let els: AppElements;
let state: AppState;
let store: ChatStore;
let chat: Chat;
let onOpen: ReturnType<typeof vi.fn>;
let onMessagesChanged: ReturnType<typeof vi.fn>;
let timers: (() => void)[];
let clipboard: { writeText: ReturnType<typeof vi.fn> };
let streamChat: StreamChat;
let toolContext: () => ToolContext | undefined;

const U1: ChatMessage = { id: "U1", createdAt: 1, role: "user", text: "one", images: [] };
const A1a: ChatMessage = {
  id: "A1a",
  createdAt: 2,
  role: "assistant",
  text: "",
  toolCalls: [{ id: "c1", name: "look", arguments: '{"start":0,"end":5}' }],
};
const T1: ChatMessage = {
  id: "T1",
  createdAt: 3,
  role: "tool",
  toolCallId: "c1",
  text: "ok",
  images: [],
};
const A1: ChatMessage = { id: "A1", createdAt: 4, role: "assistant", text: "first", toolCalls: [] };
const U2: ChatMessage = { id: "U2", createdAt: 5, role: "user", text: "two", images: [] };
const A2: ChatMessage = {
  id: "A2",
  createdAt: 6,
  role: "assistant",
  text: "second",
  toolCalls: [],
};
const U3: ChatMessage = { id: "U3", createdAt: 7, role: "user", text: "three", images: [] };
const CHAT = [U1, A1a, T1, A1, U2, A2, U3];

function replying(text: string): StreamChat {
  return async function* () {
    await Promise.resolve();
    yield { type: "text", delta: text };
    yield { type: "done", finishReason: "stop" };
  };
}

function frameTools(): ToolContext {
  return {
    file: new File(["x"], "clip.mp4"),
    info: { durationSeconds: 120, width: 640, height: 360 },
    video: { name: "clip.mp4", fileKey: "clip", durationSeconds: 120, width: 640, height: 360 },
    resolution: 1024,
    maxImages: 10,
    store,
    render: () =>
      Promise.resolve([
        { name: "frames", blob: new Blob(["jpeg"]), startSeconds: 5, endSeconds: 5, frameCount: 1 },
      ]),
  };
}

function ids(messages: readonly ChatMessage[]): string[] {
  return messages.map((message) => message.id);
}

function setup(): MessageActions {
  const conversation = initConversation(els, {
    store,
    onSeek: vi.fn(),
    onCue: vi.fn(),
    onMessageChanged: vi.fn(),
    onEdit: vi.fn(),
    onReplay: vi.fn(),
    onKeepGoing: vi.fn(),
    onBranch: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onPopOut: vi.fn(),
    onReattach: vi.fn(),
    isRunning: () => state.running,
    videoView: () => ({ video: undefined, url: null }),
    showThinking: () => false,
    onPrefill: vi.fn(),
    focusComposer: vi.fn(),
    models: () => [],
    chatModelId: () => "m",
    pickerSettings: {
      privateOnly: () => false,
      setPrivateOnly: vi.fn(),
      favourites: () => [],
      setFavourites: vi.fn(),
    },
    onSwitchReply: vi.fn(),
    onCompare: vi.fn(),
    onVerify: vi.fn(() => Promise.resolve(undefined)),
    onMessagesChanged: vi.fn(),
  });
  conversation.reset(state.messages);
  return initMessageActions(state, {
    store,
    status: { show: vi.fn(), clear: vi.fn() },
    conversation,
    toast: initToast(els, { set: (run) => timers.push(run), clear: vi.fn() }),
    streamChat: (...args) => streamChat(...args),
    toolContext: () => toolContext(),
    onOpen,
    onChatsChanged: vi.fn(),
    onMessagesChanged,
    clipboard,
    newId: () => "branch",
    now: () => 100,
  });
}

function shownAnswers(): string[] {
  return [
    ...els.conversation.list.querySelectorAll(".message.assistant:not([hidden]):not(.is-retry)"),
  ].map((el) => el.querySelector(".message-text")?.textContent ?? "");
}

beforeEach(async () => {
  document.body.innerHTML = indexHtml;
  els = queryElements();
  state = createAppState(DEFAULT_SETTINGS);
  store = createMemoryStore();
  onOpen = vi.fn();
  onMessagesChanged = vi.fn();
  timers = [];
  clipboard = { writeText: vi.fn(() => Promise.resolve()) };
  streamChat = replying("1: confirmed: the door is open");
  toolContext = () => frameTools();
  chat = { ...blankChat("m", "chat", 1), title: "Beach" };
  await store.putChat(chat);
  for (const message of CHAT) await store.putMessage("chat", message);
  replaceChat(state, chat);
  setCurrentChat(state, chat, CHAT);
});

const claimed: AssistantMessage = {
  id: "A2",
  createdAt: 6,
  role: "assistant",
  text: "At [0:05] the door is open.",
  toolCalls: [],
};

async function putClaimedReply(): Promise<void> {
  const messages = CHAT.map((message) => (message.id === "A2" ? claimed : message));
  await store.putMessage("chat", claimed);
  setCurrentChat(state, chat, messages);
}

describe("checking timestamps across chats", () => {
  beforeEach(putClaimedReply);

  it("saves nothing for a reply deleted in another chat while it was checked", async () => {
    const actions = setup();
    const checking = actions.verify(claimed, new AbortController().signal);
    const other = { ...blankChat("m", "other", 2) };
    replaceChat(state, other);
    setCurrentChat(state, other, []);
    await store.deleteMessages("chat", ["A2"]);
    expect(await checking).toBeUndefined();
    expect(ids(await store.listMessages("chat"))).not.toContain("A2");
  });
});

describe("deleting", () => {
  it.each([
    ["U2", ["U1", "A1a", "T1", "A1", "A2", "U3"]],
    ["A1", ["U1", "U2", "A2", "U3"]],
    ["U3", ["U1", "A1a", "T1", "A1", "U2", "A2"]],
  ])("deleting %s removes exactly its message or reply, and undo restores it", async (id, left) => {
    const actions = setup();
    const target = CHAT.find((message) => message.id === id);
    if (!target) throw new Error(`No message ${id}`);
    await actions.remove(target);
    expect(ids(state.messages)).toEqual(left);
    expect(ids(await store.listMessages("chat"))).toEqual(left);
    expect(els.toast.el.hidden).toBe(false);
    expect(els.toast.text.textContent).toBe("Message deleted");
    expect(onMessagesChanged).toHaveBeenCalledTimes(1);
    els.toast.action.click();
    await vi.waitFor(() => expect(ids(state.messages)).toEqual(ids(CHAT)));
    expect(ids(await store.listMessages("chat"))).toEqual(ids(CHAT));
    expect(onMessagesChanged).toHaveBeenCalledTimes(2);
    expect(els.toast.el.hidden).toBe(true);
  });

  it("keeps the previous reply visible after deleting a user message", async () => {
    const actions = setup();
    await actions.remove(U2);
    expect(shownAnswers()).toEqual(["first", "second"]);
  });

  it("hides the undo toast when its time runs out", async () => {
    const actions = setup();
    await actions.remove(U3);
    timers.forEach((run) => run());
    expect(els.toast.el.hidden).toBe(true);
  });

  it("drops a pending undo once it is invalidated", async () => {
    const actions = setup();
    await actions.remove(U3);
    actions.invalidateUndo();
    expect(els.toast.el.hidden).toBe(true);
    els.toast.action.click();
    await Promise.resolve();
    expect(ids(await store.listMessages("chat"))).not.toContain("U3");
  });

  it("restores nothing when undo is chosen after a turn started", async () => {
    const actions = setup();
    await actions.remove(U3);
    setRunning(state, true);
    els.toast.action.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ids(state.messages)).not.toContain("U3");
    expect(ids(await store.listMessages("chat"))).not.toContain("U3");
  });

  it("does nothing while a turn runs", async () => {
    const actions = setup();
    setRunning(state, true);
    await actions.remove(U2);
    await actions.branch(U2);
    expect(ids(state.messages)).toEqual(ids(CHAT));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("branching", () => {
  it("copies the chat up to a user message and opens the branch", async () => {
    const handle = { kind: "file", name: "beach.mp4" } as unknown as FileSystemFileHandle;
    await store.putVideoHandle("chat", handle);
    await setup().branch(U2);
    const branch = await store.getChat("branch");
    expect(branch?.title).toBe("Beach (branch)");
    expect(branch?.settings).toEqual(chat.settings);
    expect(ids(await store.listMessages("branch"))).toEqual(["U1", "A1a", "T1", "A1", "U2"]);
    expect(await store.getVideoHandle("branch")).toBe(handle);
    expect(state.chats[0]?.id).toBe("branch");
    expect(onOpen).toHaveBeenCalledWith("branch");
  });

  it("copies only the messages there were when branching began", async () => {
    const putChat = store.putChat.bind(store);
    store.putChat = (chat) => {
      upsertMessage(state, {
        id: "late",
        createdAt: 9,
        role: "assistant",
        text: "",
        toolCalls: [],
      });
      return putChat(chat);
    };
    await setup().branch(U3);
    expect(ids(await store.listMessages("branch"))).toEqual(ids(CHAT));
  });

  it("keeps the story so far only when the branch holds everything it summarises", async () => {
    const story = { text: "Earlier.", throughMessageId: "U2", throughCreatedAt: 5, updatedAt: 1 };
    const told = { ...chat, storySoFar: story };
    replaceChat(state, told);
    setCurrentChat(state, told, CHAT);
    await setup().branch(A2);
    expect((await store.getChat("branch"))?.storySoFar).toEqual(story);
    setCurrentChat(state, told, CHAT);
    await setup().branch(A1);
    expect((await store.getChat("branch"))?.storySoFar).toBeUndefined();
  });

  it("copies a whole reply, tool rounds included", async () => {
    await setup().branch(A1);
    expect(ids(await store.listMessages("branch"))).toEqual(["U1", "A1a", "T1", "A1"]);
  });
});

describe("copying", () => {
  it("puts the message text on the clipboard and says so", async () => {
    await setup().copy(A2);
    expect(clipboard.writeText).toHaveBeenCalledWith("second");
    expect(els.toast.text.textContent).toBe("Copied");
  });

  it("reports a clipboard that refuses", async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error("Not allowed"));
    await setup().copy(U1);
    expect(els.toast.text.textContent).toBe("Could not copy: Not allowed");
  });
});

describe("switching replies", () => {
  const older: AssistantMessage = {
    id: "A3old",
    createdAt: 3,
    role: "assistant",
    text: "older reply",
    toolCalls: [],
  };
  const newer: AssistantMessage = {
    id: "A3",
    createdAt: 8,
    role: "assistant",
    text: "newer reply",
    toolCalls: [],
  };
  const swiped: UserMessage = {
    ...U3,
    alternates: [{ messages: [older], modelId: "other", createdAt: 3 }],
    replyIndex: 1,
  };

  beforeEach(async () => {
    const messages = [...CHAT.filter((message) => message.id !== "U3"), swiped, newer];
    for (const message of messages) await store.putMessage("chat", message);
    setCurrentChat(state, chat, messages);
  });

  it("puts the chosen reply in place and keeps the shown one as a swipe", async () => {
    await setup().switchReply(swiped, 0);
    expect(ids(state.messages).slice(-2)).toEqual(["U3", "A3old"]);
    expect(ids(await store.listMessages("chat"))).not.toContain("A3");
    const user = state.messages.find((message) => message.id === "U3");
    if (user?.role !== "user") throw new Error("No user message");
    expect(user.replyIndex).toBe(0);
    expect(user.replyModelId).toBe("other");
    expect(user.alternates?.map((alternate) => alternate.messages[0]?.id)).toEqual(["A3"]);
    expect(shownAnswers().at(-1)).toBe("older reply");
  });

  it("drops a pending message-delete undo, which would restore into the old replies", async () => {
    const actions = setup();
    await actions.remove(U2);
    await actions.switchReply(swiped, 0);
    expect(els.toast.el.hidden).toBe(true);
  });

  it("does nothing while a turn runs", async () => {
    const actions = setup();
    setRunning(state, true);
    await actions.switchReply(swiped, 0);
    expect(ids(state.messages).at(-1)).toBe("A3");
  });
});

describe("checking timestamps with recall", () => {
  beforeEach(putClaimedReply);

  it("lets the check's tool runner recall the chat's images by name", async () => {
    const photo: ImageRef = {
      id: "p",
      pinned: false,
      source: { kind: "upload", name: "door.jpg" },
    };
    const withPhoto = state.messages.map((message) =>
      message.id === "U2" ? { ...message, images: [photo] } : message,
    );
    setCurrentChat(state, chat, withPhoto);
    vi.mocked(createToolRunner).mockClear();
    await setup().verify(claimed, new AbortController().signal);
    const runnerCtx = vi.mocked(createToolRunner).mock.calls[0]?.[0];
    expect(runnerCtx?.knownImages?.()).toEqual([photo]);
  });
});

describe("checking timestamps", () => {
  beforeEach(putClaimedReply);

  it("saves the verdicts on the reply", async () => {
    const updated = await setup().verify(claimed, new AbortController().signal);
    const expected = [
      {
        claim: "At [0:05] the door is open.",
        seconds: [5],
        verdict: "confirmed",
        reason: "the door is open",
      },
    ];
    expect(updated?.verification).toEqual(expected);
    expect(state.messages.find((message) => message.id === "A2")).toEqual(updated);
    const saved = (await store.listMessages("chat")).find((message) => message.id === "A2");
    expect(saved).toEqual(updated);
  });

  it("asks for the video when it is not attached", async () => {
    toolContext = () => undefined;
    expect(await setup().verify(claimed, new AbortController().signal)).toBeUndefined();
    expect(els.toast.text.textContent).toBe("Reattach the video to check the timestamps.");
  });

  it("reports a failed check in the toast", async () => {
    streamChat = () => {
      throw new Error("Network down");
    };
    expect(await setup().verify(claimed, new AbortController().signal)).toBeUndefined();
    expect(els.toast.text.textContent).toBe("Could not check the timestamps: Network down");
  });

  it("stays quiet when stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const actions = setup();
    els.toast.text.textContent = "";
    expect(await actions.verify(claimed, controller.signal)).toBeUndefined();
    expect(els.toast.text.textContent).toBe("");
  });

  it("drops verdicts for a reply edited while it was checked", async () => {
    const actions = setup();
    const checking = actions.verify(claimed, new AbortController().signal);
    upsertMessage(state, { ...claimed, text: "Edited." });
    expect(await checking).toBeUndefined();
    const saved = (await store.listMessages("chat")).find((message) => message.id === "A2");
    expect(saved).toEqual(claimed);
  });
});
