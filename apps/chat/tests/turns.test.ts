import { modelVisionProfile } from "@vid2grid/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AgentLoop from "../src/chat/agentLoop";
import { DEEP_MAX_ROUNDS, DEFAULT_MAX_ROUNDS, runTurn } from "../src/chat/agentLoop";
import { blankChat } from "../src/chat/chats";
import { THOROUGH_MAX_ROUNDS } from "../src/chat/thoroughness";
import { ANSWER_NOW_NOTE } from "../src/chat/prompts";
import { createMemoryStore } from "../src/chat/store";
import { STORY_SYSTEM_PROMPT } from "../src/chat/summary";
import type { AppElements } from "../src/dom";
import { VENICE_BASE_URL } from "../src/api/venice";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  createAppState,
  isRunningIn,
  replaceChat,
  setCurrentChat,
  setLoadedVideo,
  setModels,
  setRunning,
  type AppState,
} from "../src/state";
import { errorText } from "../src/text";
import type {
  Chat,
  ChatMessage,
  ChatRequest,
  ChatStore,
  ImageRef,
  ModelInfo,
  StreamChat,
  StreamEvent,
  UserMessage,
  VideoAttachment,
  VideoAudio,
  VideoCast,
} from "../src/types";
import { initConversation, type Conversation } from "../src/ui/conversation/conversation";
import { storedPickerSettings } from "../src/ui/modelPicker/pickerModel";
import { initMessageActions } from "../src/app/messageActions";
import {
  ANSWERED_NOW_NOTES,
  initTurns,
  KEEP_GOING_TEXT,
  SUMMARIZING_STATUS,
  type Turns,
} from "../src/app/turns";
import { resolveSheetResolution } from "../src/video/resolution";
import { conversationDeps } from "./support/conversationDeps";
import { model } from "./support/factories";
import { idleImages } from "./support/images";
import { mountPage, stillToast } from "./support/page";
import { waitForAbort } from "./support/streams";

vi.mock("../src/chat/agentLoop", async (importOriginal) => {
  const actual = await importOriginal<typeof AgentLoop>();
  return { ...actual, runTurn: vi.fn(actual.runTurn) };
});

const MODEL = "vision-model";
const SETTINGS = {
  ...DEFAULT_SETTINGS,
  baseUrl: VENICE_BASE_URL,
  apiKey: "key",
  defaultModelId: MODEL,
};

let els: AppElements;
let state: AppState;
let store: ChatStore;
let conversation: Conversation;
let status: { show: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
let toast: { show: ReturnType<typeof vi.fn> };
let streamChat: ReturnType<typeof vi.fn<StreamChat>>;
let editing: Promise<void>;

const U1: UserMessage = { id: "U1", createdAt: 1, role: "user", text: "one", images: [] };
const A1: ChatMessage = {
  id: "A1",
  createdAt: 2,
  role: "assistant",
  text: "Old one",
  toolCalls: [],
};
const U2: UserMessage = { id: "U2", createdAt: 3, role: "user", text: "two", images: [] };
const A2: ChatMessage = {
  id: "A2",
  createdAt: 4,
  role: "assistant",
  text: "Old two",
  toolCalls: [],
};

async function* answer(text: string): AsyncGenerator<StreamEvent> {
  await Promise.resolve();
  yield { type: "text", delta: text };
  yield { type: "done", finishReason: "stop" };
}

async function seed(messages: ChatMessage[], chatExtra: Partial<Chat> = {}): Promise<void> {
  const chat = { ...blankChat(MODEL, "chat", 1), ...chatExtra };
  await store.putChat(chat);
  for (const message of messages) await store.putMessage("chat", message);
  replaceChat(state, chat);
  setCurrentChat(state, chat, messages);
  conversation.reset(messages);
}

function turns(): Turns {
  return initTurns(state, {
    store,
    status,
    toast,
    conversation,
    video: { renderSceneLog: vi.fn() },
    images: idleImages(),
    streamChat,
    timeline: () => undefined,
    onChatChanged: vi.fn(),
    onRunningChanged: vi.fn(),
    onMessageSaved: vi.fn(),
    newId: () => "new",
    now: () => 10,
  });
}

function stored(): Promise<string[]> {
  return store.listMessages("chat").then((messages) => messages.map((message) => message.id));
}

function lastTurnDeps() {
  const calls = vi.mocked(runTurn).mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  els = mountPage();
  state = createAppState(SETTINGS);
  store = createMemoryStore();
  status = { show: vi.fn(), clear: vi.fn() };
  toast = { show: vi.fn() };
  streamChat = vi.fn<StreamChat>(() => answer("New reply"));
  vi.mocked(runTurn).mockClear();
  conversation = initConversation(
    els,
    conversationDeps(store, {
      isRunning: () => state.running,
      models: () => state.models,
      chatModelId: () => state.currentChat?.settings.modelId,
      pickerSettings: storedPickerSettings(state, localStorage),
      onVerify: () => Promise.resolve(undefined),
      onEdit: (message, text, onUnsaved) => {
        editing = turns().edit(message, text, onUnsaved);
      },
    }),
  );
});

describe("replay", () => {
  it("removes the old reply before the new request and reruns the turn", async () => {
    streamChat.mockImplementation((_settings, _request, signal) => waitForAbort(signal));
    await seed([U1, A1, U2, A2]);
    const running = turns();
    const replaying = running.replay();
    await vi.waitFor(() => expect(streamChat).toHaveBeenCalled());
    expect(els.conversation.list.textContent).not.toContain("Old two");
    expect(els.conversation.list.textContent).toContain("Old one");
    expect(await stored()).toEqual(["U1", "A1", "U2"]);
    running.stop();
    await replaying;
  });

  it("keeps the replaced reply as a swipe alternate on the user message", async () => {
    await seed([U1, A1, U2, A2]);
    await turns().replay();
    const user = (await store.listMessages("chat")).find((message) => message.id === "U2");
    if (user?.role !== "user") throw new Error("No user message");
    expect(user.alternates).toEqual([{ messages: [A2], modelId: MODEL, createdAt: A2.createdAt }]);
    expect(user.replyIndex).toBe(1);
    expect(state.messages.find((message) => message.id === "U2")).toEqual(user);
  });

  it("keeps the thoroughness of the user message, reading an older deep dive as exhaustive", async () => {
    await seed([{ ...U1, deep: true }, A1]);
    await turns().replay();
    expect(lastTurnDeps()?.thoroughness).toBe("exhaustive");
    expect(lastTurnDeps()?.maxRounds).toBe(DEEP_MAX_ROUNDS);
    const replayed = await store.listMessages("chat");
    expect(replayed.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(replayed[1]).toEqual(expect.objectContaining({ text: "New reply" }));
  });

  it("deletes nothing when no turn has a user message", async () => {
    await seed([A1, A2]);
    await turns().replay();
    expect(streamChat).not.toHaveBeenCalled();
    expect(await stored()).toEqual(["A1", "A2"]);
  });
});

describe("editing", () => {
  it("reruns the turn after editing the last user message", async () => {
    await seed([U1, A1, U2, A2]);
    await turns().edit(U2, "two, edited");
    const messages = await store.listMessages("chat");
    expect(messages.map((message) => message.id).slice(0, 3)).toEqual(["U1", "A1", "U2"]);
    expect(messages[3]).toEqual(expect.objectContaining({ text: "New reply" }));
    expect(messages[2]).toEqual(expect.objectContaining({ text: "two, edited" }));
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the last message, which would run the turn again", "two"],
    ["an earlier message", "one"],
    ["a reply", "Old two"],
  ])("goes back in the editor when it cannot be saved: %s", async (_what, shown) => {
    await seed([U1, A1, U2, A2]);
    await store.deleteChat("chat");
    const { list } = els.conversation;
    const message = () =>
      [...list.querySelectorAll<HTMLElement>(".message")].find(
        (el) => el.querySelector(".message-text")?.textContent.trim() === shown,
      );
    const editor = () => message()?.querySelector<HTMLTextAreaElement>(".message-editor textarea");
    const save = () => message()?.querySelector<HTMLButtonElement>(".editor-save");
    message()?.querySelector<HTMLElement>(".edit-action")?.click();
    const input = editor();
    if (!input) throw new Error("No editor");
    input.value = "Typed at length";
    save()?.click();
    expect(editor()).toBeFalsy();
    const error = await editing.then(
      () => status.show.mock.calls.at(-1),
      (reason: unknown) => [errorText(reason), "error"],
    );
    expect(error).toEqual(["This chat has been deleted.", "error"]);
    expect(editor()?.value).toBe("Typed at length");
    expect(document.activeElement).toBe(editor());
    expect(save()?.disabled).toBe(false);
    expect(state.messages).toEqual([U1, A1, U2, A2]);
    expect(streamChat).not.toHaveBeenCalled();
    const chat = state.currentChat;
    if (chat) await store.putChat(chat);
    save()?.click();
    await editing;
    expect((await store.listMessages("chat")).map(({ text }) => text)).toContain("Typed at length");
    expect(editor()).toBeFalsy();
  });

  it("goes back in the editor when a reply has begun meanwhile or no chat is open", async () => {
    await seed([U1, A1]);
    const onUnsaved = vi.fn();
    setRunning(state, true);
    await turns().edit(U1, "one, edited", onUnsaved);
    expect(onUnsaved).toHaveBeenCalledTimes(1);
    setRunning(state, false);
    setCurrentChat(state, null, []);
    await turns().edit(U1, "one, edited", onUnsaved);
    expect(onUnsaved).toHaveBeenCalledTimes(2);
    expect(await store.listMessages("chat")).toEqual([U1, A1]);
  });

  it("is never handed back once it is saved", async () => {
    await seed([U1, A1]);
    const onUnsaved = vi.fn();
    store.deleteMessages = () => Promise.reject(new Error("quota"));
    await turns().edit(U1, "one, edited", onUnsaved);
    expect(status.show).toHaveBeenLastCalledWith("quota", "error");
    expect(onUnsaved).not.toHaveBeenCalled();
    expect((await store.listMessages("chat"))[0]).toMatchObject({ text: "one, edited" });
  });

  it("only updates an earlier message or a reply", async () => {
    await seed([U1, A1, U2, A2]);
    const running = turns();
    await running.edit(U1, "one, edited");
    await running.edit(A2, "Better two");
    expect(streamChat).not.toHaveBeenCalled();
    const messages = await store.listMessages("chat");
    expect(messages.map((message) => message.id)).toEqual(["U1", "A1", "U2", "A2"]);
    expect(messages[0]).toEqual(expect.objectContaining({ text: "one, edited" }));
    expect(messages[3]).toEqual(expect.objectContaining({ text: "Better two" }));
    expect(els.conversation.list.textContent).toContain("Better two");
  });
});

describe("keep going and round budgets", () => {
  it("sends a continuation that keeps the tier and reasoning effort", async () => {
    await seed([
      { ...U1, deep: true, reasoningEffort: "low" },
      { ...A1, stoppedAtRoundLimit: true },
    ]);
    await turns().keepGoing();
    const sent = (await store.listMessages("chat"))[2];
    expect(sent).toEqual(
      expect.objectContaining({
        text: KEEP_GOING_TEXT,
        continuation: true,
        thoroughness: "exhaustive",
        reasoningEffort: "low",
      }),
    );
    expect(lastTurnDeps()?.thoroughness).toBe("exhaustive");
  });

  it("gives a thorough message its own round budget", async () => {
    await seed([]);
    const message: UserMessage = { ...U1, thoroughness: "thorough" };
    await turns().run(() => Promise.resolve({ message }));
    expect(lastTurnDeps()?.thoroughness).toBe("thorough");
    expect(lastTurnDeps()?.maxRounds).toBe(THOROUGH_MAX_ROUNDS);
  });

  it("uses the chat's max rounds, or the default", async () => {
    await seed([U1], { settings: { ...blankChat("m", "x", 1).settings, maxRounds: 3 } });
    await turns().run(() => Promise.resolve({}));
    expect(lastTurnDeps()?.maxRounds).toBe(3);
    await seed([U1]);
    await turns().run(() => Promise.resolve({}));
    expect(lastTurnDeps()?.maxRounds).toBe(DEFAULT_MAX_ROUNDS);
  });

  it("notes when the model kept calling tools after its limit", async () => {
    await seed([U1]);
    vi.mocked(runTurn).mockResolvedValueOnce({ status: "done", strippedToolMarkup: true });
    await turns().run(() => Promise.resolve({}));
    expect(status.show).toHaveBeenCalledWith(
      "The model tried to keep calling tools after its limit; you can let it keep going.",
    );
  });

  it("notes when a reply answered without further thinking", async () => {
    await seed([U1]);
    vi.mocked(runTurn).mockResolvedValueOnce({ status: "done", answeredNow: "loop" });
    await turns().run(() => Promise.resolve({}));
    expect(status.show).toHaveBeenCalledWith(ANSWERED_NOW_NOTES.loop);
    expect(ANSWERED_NOW_NOTES).toEqual({
      user: "Answered without further thinking.",
      loop: "Thinking was going in circles, so it was cut short.",
    });
  });
});

describe("answer now", () => {
  it("cuts the running round short and answers, leaving no signal behind", async () => {
    await seed([U1]);
    const running = turns();
    streamChat
      .mockImplementationOnce((_api, _request, signal) => waitForAbort(signal))
      .mockImplementationOnce(() => answer("Answered."));
    const turn = running.run(() => Promise.resolve({}));
    await vi.waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1));
    running.answerNow();
    await turn;
    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(streamChat.mock.calls[1]?.[1].messages.at(-1)).toEqual({
      role: "user",
      content: ANSWER_NOW_NOTE,
    });
    expect(status.show).toHaveBeenCalledWith(ANSWERED_NOW_NOTES.user);
    const messages = await store.listMessages("chat");
    expect(messages[1]).toEqual(expect.objectContaining({ text: "Answered." }));
    running.answerNow();
    expect(streamChat).toHaveBeenCalledTimes(2);
  });
});

describe("running per chat", () => {
  it("lets another chat send while one chat's reply is still running", async () => {
    await seed([U1]);
    const running = turns();
    streamChat.mockImplementationOnce((_api, _request, signal) => waitForAbort(signal));
    const first = running.run(() => Promise.resolve({}));
    await vi.waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1));
    expect(state.running).toBe(true);
    const other = blankChat(MODEL, "other", 2);
    await store.putChat(other);
    replaceChat(state, other);
    setCurrentChat(state, other, []);
    expect(state.running).toBe(false);
    const prepare = vi.fn(() => Promise.resolve({}));
    await running.run(prepare);
    expect(prepare).toHaveBeenCalled();
    expect(isRunningIn(state, "chat")).toBe(true);
    setCurrentChat(state, state.chats.find((chat) => chat.id === "chat") ?? null, [U1]);
    running.stop();
    await first;
    expect(isRunningIn(state, "chat")).toBe(false);
  });

  it("refuses a second turn in the chat whose reply is running", async () => {
    await seed([U1]);
    const running = turns();
    streamChat.mockImplementationOnce((_api, _request, signal) => waitForAbort(signal));
    const first = running.run(() => Promise.resolve({}));
    await vi.waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1));
    const prepare = vi.fn(() => Promise.resolve({}));
    await running.run(prepare);
    expect(prepare).not.toHaveBeenCalled();
    running.stop();
    await first;
  });
});

describe("retrying", () => {
  it("leaves an error line with Retry, which reruns without deleting the message", async () => {
    await seed([U1]);
    const running = turns();
    vi.mocked(runTurn).mockResolvedValueOnce({ status: "error", error: "Network error" });
    await running.run(() => Promise.resolve({}));
    expect(els.conversation.list.querySelector(".error-line")?.textContent).toContain(
      "Network error",
    );
    await running.replay();
    expect(els.conversation.list.querySelector(".error-line")).toBeNull();
    const messages = await store.listMessages("chat");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.id).toBe("U1");
  });

  it("replays a reloaded chat whose reply was cut off during tool rounds", async () => {
    const cut: ChatMessage = {
      id: "A",
      createdAt: 2,
      role: "assistant",
      text: "",
      toolCalls: [{ id: "c1", name: "look", arguments: '{"start":0,"end":5}' }],
    };
    await seed([U1, cut]);
    expect(
      els.conversation.list.querySelector('[aria-label="Replay: get a new reply"]'),
    ).not.toBeNull();
    await turns().replay();
    const messages = await store.listMessages("chat");
    expect(messages.map((message) => message.id)).not.toContain("A");
    expect(messages[1]).toEqual(expect.objectContaining({ text: "New reply" }));
  });
});

function smallModel(): ModelInfo {
  return model(MODEL, { name: "Small", contextTokens: 400 });
}

function longHistory(turnCount: number): ChatMessage[] {
  return Array.from({ length: turnCount }, (_, turn): ChatMessage[] => [
    { id: `u${turn}`, createdAt: turn * 2, role: "user", text: "word ".repeat(80), images: [] },
    {
      id: `a${turn}`,
      createdAt: turn * 2 + 1,
      role: "assistant",
      text: "reply ".repeat(80),
      toolCalls: [],
    },
  ]).flat();
}

function isSummaryRequest(request: ChatRequest): boolean {
  return request.messages[0]?.content === STORY_SYSTEM_PROMPT;
}

describe("rolling summaries", () => {
  beforeEach(() => {
    setModels(state, [smallModel()]);
  });

  it("folds earlier messages into the story so far before a long turn", async () => {
    streamChat.mockImplementation((_settings, request) =>
      answer(isSummaryRequest(request) ? "They went to the beach." : "New reply"),
    );
    await seed(longHistory(6));
    await turns().run(() => Promise.resolve({}));
    const story = { text: "They went to the beach.", throughMessageId: "a1", updatedAt: 10 };
    expect((await store.getChat("chat"))?.storySoFar).toMatchObject(story);
    expect(state.chats[0]?.storySoFar).toMatchObject(story);
    expect(lastTurnDeps()?.chat.storySoFar).toMatchObject(story);
    expect(status.show).toHaveBeenCalledWith(SUMMARIZING_STATUS);
    expect(status.clear).toHaveBeenCalled();
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it("stops without sending another chat's messages when the chat changed meanwhile", async () => {
    const other = blankChat(MODEL, "other", 1);
    await seed(longHistory(6));
    replaceChat(state, other);
    streamChat.mockImplementation((_settings, request) => {
      setCurrentChat(state, other, [{ ...U1, text: "A private aside" }]);
      return answer(isSummaryRequest(request) ? "They went to the beach." : "New reply");
    });
    await turns().run(() => Promise.resolve({}));
    expect(runTurn).not.toHaveBeenCalled();
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect((await store.getChat("chat"))?.storySoFar?.text).toBe("They went to the beach.");
    expect((await store.getChat("other"))?.storySoFar).toBeUndefined();
    expect(status.clear).toHaveBeenCalled();
    expect(isRunningIn(state, "chat")).toBe(false);
  });

  it("stops when the chat changed while the turn was being set up", async () => {
    const other = blankChat(MODEL, "other", 1);
    await seed([{ ...U1, audio: true }], { video: VIDEO });
    const read = store.getAudio.bind(store);
    vi.spyOn(store, "getAudio").mockImplementation((key) => {
      setCurrentChat(state, other, [{ ...U1, text: "A private aside", audio: true }]);
      return read(key);
    });
    await turns().run(() => Promise.resolve({ audio: true }));
    expect(runTurn).not.toHaveBeenCalled();
    expect(await store.listMessages("other")).toEqual([]);
  });

  it("leaves a short chat alone", async () => {
    await seed([U1]);
    await turns().run(() => Promise.resolve({}));
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(status.show).not.toHaveBeenCalledWith(SUMMARIZING_STATUS);
  });

  it("reports a failed summary in the toast and still runs the turn", async () => {
    streamChat.mockImplementation((_settings, request) => {
      if (isSummaryRequest(request)) throw new Error("Summary down");
      return answer("New reply");
    });
    await seed(longHistory(6));
    await turns().run(() => Promise.resolve({}));
    expect(toast.show).toHaveBeenCalledWith("Could not summarize earlier messages: Summary down");
    expect(runTurn).toHaveBeenCalled();
    expect(lastTurnDeps()?.chat.storySoFar).toBeUndefined();
    expect((await store.listMessages("chat")).at(-1)).toEqual(
      expect.objectContaining({ text: "New reply" }),
    );
  });

  it("stops while summarizing without running the turn", async () => {
    streamChat.mockImplementation((_settings, _request, signal) => waitForAbort(signal));
    await seed(longHistory(6));
    const running = turns();
    const turn = running.run(() => Promise.resolve({}));
    await vi.waitFor(() => expect(streamChat).toHaveBeenCalled());
    running.stop();
    await turn;
    expect(runTurn).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(state.running).toBe(false);
    expect((await store.getChat("chat"))?.storySoFar).toBeUndefined();
  });
});

const VIDEO: VideoAttachment = {
  name: "beach.mp4",
  fileKey: "beach-key",
  durationSeconds: 120,
  width: 1280,
  height: 720,
};

function castOf(description: string): VideoCast {
  return {
    fileKey: VIDEO.fileKey,
    cards: [{ id: "c1", name: "Mara", description }],
    updatedAt: 1,
  };
}

describe("comparing with another model", () => {
  it("runs the turn with the other model, its resolution and its image tokens", async () => {
    const other: ModelInfo = { ...smallModel(), id: "claude-opus-4-7", contextTokens: 1_000_000 };
    setModels(state, [smallModel(), other]);
    await seed([U1, A1]);
    const current = resolveSheetResolution("auto", smallModel()).px;
    const expected = resolveSheetResolution("auto", other).px;
    expect(expected).not.toBe(current);
    vi.mocked(runTurn).mockResolvedValueOnce({ status: "done" });
    await turns().compare(other);
    const deps = lastTurnDeps();
    expect(deps?.model.id).toBe(other.id);
    expect(deps?.chat.settings.modelId).toBe(other.id);
    expect(deps?.resolution).toBe(expected);
    expect(deps?.imageTokens?.(expected)).toBe(
      modelVisionProfile(other.id).imageTokens?.(expected),
    );
  });
});

describe("the video's cast", () => {
  it("loads the cast for the chat's video and passes it to the turn", async () => {
    const cast = castOf("Tall, red coat.");
    await store.putCast(cast);
    await seed([U1], { video: VIDEO });
    await turns().run(() => Promise.resolve({}));
    expect(lastTurnDeps()?.cast).toEqual(cast);
  });

  it("counts a large cast toward the automatic summary", async () => {
    // The default prompt with a short cast is about 260 tokens; 500 puts the threshold at 300.
    setModels(state, [{ ...smallModel(), contextTokens: 500 }]);
    await store.putCast(castOf("Short."));
    await seed([U1], { video: VIDEO });
    await turns().run(() => Promise.resolve({}));
    expect(status.show).not.toHaveBeenCalledWith(SUMMARIZING_STATUS);
    await store.putCast(castOf("A long description of her. ".repeat(80)));
    await seed([U1], { video: VIDEO });
    await turns().run(() => Promise.resolve({}));
    expect(status.show).toHaveBeenCalledWith(SUMMARIZING_STATUS);
  });
});

const HEARD: VideoAudio = {
  fileKey: VIDEO.fileKey,
  labels: [...DEFAULT_SETTINGS.soundLabels],
  backgroundLabels: [...DEFAULT_SETTINGS.backgroundSoundLabels],
  speechSpans: [{ startSeconds: 0, endSeconds: 60 }],
  soundSpans: [{ startSeconds: 0, endSeconds: 60 }],
  speech: [],
  events: [],
  updatedAt: 1,
};

async function seedWithVideo(messages: ChatMessage[]): Promise<void> {
  setModels(state, [smallModel()]);
  await seed(messages, { video: VIDEO });
  setLoadedVideo(state, {
    chatId: "chat",
    file: new File(["x"], VIDEO.name),
    info: { durationSeconds: VIDEO.durationSeconds, width: VIDEO.width, height: VIDEO.height },
  });
}

function sentTools(): string[] {
  const request: ChatRequest | undefined = streamChat.mock.calls[0]?.[1];
  return (request?.tools ?? []).map((tool) => tool.function.name);
}

describe("audio", () => {
  it("lists listen and sends what has been heard when the message has audio on", async () => {
    await store.putAudio(HEARD);
    await seedWithVideo([]);
    const message: UserMessage = { ...U1, audio: true };
    await turns().run(() => Promise.resolve({ message }));
    expect(sentTools()).toEqual(["look", "frames", "note", "recall", "zoom", "listen"]);
    expect(lastTurnDeps()?.audioCoverage).toEqual({
      text: "analysed 0:00 to 1:00 (speech and sounds)",
      canListen: true,
    });
  });

  it("sends nothing about audio when it is off, even with audio heard", async () => {
    await store.putAudio(HEARD);
    await seedWithVideo([]);
    await turns().run(() => Promise.resolve({ message: U1 }));
    expect(sentTools()).toEqual(["look", "frames", "note", "recall", "zoom"]);
    expect(lastTurnDeps()?.audioCoverage).toBeUndefined();
    expect(JSON.stringify(streamChat.mock.calls[0]?.[1])).not.toContain("listen");
  });

  it("tells the model a video has no audio track, without offering listen", async () => {
    await store.putAudio({ ...HEARD, noAudio: true });
    await seedWithVideo([]);
    await turns().run(() => Promise.resolve({ message: { ...U1, audio: true } }));
    expect(sentTools()).toEqual(["look", "frames", "note", "recall", "zoom"]);
    expect(lastTurnDeps()?.audioCoverage).toEqual({
      text: "the video has no audio track",
      canListen: false,
    });
  });

  it("leaves audio out when no video is loaded to listen to", async () => {
    setModels(state, [smallModel()]);
    await seed([], { video: VIDEO });
    await turns().run(() => Promise.resolve({ message: { ...U1, audio: true } }));
    expect(lastTurnDeps()?.audioCoverage).toBeUndefined();
  });
});

describe("transcript", () => {
  const SPOKEN: VideoAudio = {
    ...HEARD,
    speech: [{ start: 12, end: 15, text: "Hello there." }],
  };
  const RECORD = { fileKey: VIDEO.fileKey, spans: HEARD.speechSpans };

  async function transcripts(): Promise<unknown[]> {
    const messages = await store.listMessages("chat");
    return messages.flatMap((message) => (message.role === "user" ? [message.transcript] : []));
  }

  function sent(call = streamChat.mock.calls.length - 1): string {
    return JSON.stringify(streamChat.mock.calls[call]?.[1].messages);
  }

  it("sends what has been heard with the message and records it there", async () => {
    await store.putAudio(SPOKEN);
    await seedWithVideo([]);
    await turns().run(() => Promise.resolve({ message: { ...U1, audio: true } }));
    expect(sent()).toContain("[0:12] Hello there.");
    expect(await transcripts()).toEqual([RECORD]);
    expect(els.conversation.list.querySelector(".transcript-tag")?.textContent).toBe(
      "Transcript to 1:00 sent",
    );
  });

  it("sends and records nothing when the toggle is off or no speech was heard", async () => {
    await store.putAudio(SPOKEN);
    await seedWithVideo([]);
    await turns().run(() => Promise.resolve({ message: U1 }));
    expect(sent()).not.toContain("Hello there.");
    await store.putAudio(HEARD);
    await seedWithVideo([]);
    await turns().run(() => Promise.resolve({ message: { ...U1, audio: true } }));
    expect(sent()).not.toContain("Transcript");
    expect(await transcripts()).toEqual([undefined]);
  });

  it("leaves a stub on the next turn and does not send it again", async () => {
    await store.putAudio(SPOKEN);
    await seedWithVideo([{ ...U1, audio: true, transcript: RECORD }, A1]);
    await turns().run(() => Promise.resolve({ message: { ...U2, audio: true } }));
    expect(sent()).toContain("Sent earlier; call listen(start, end)");
    expect(sent()).not.toContain("Hello there.");
    expect(await transcripts()).toEqual([RECORD, undefined]);
  });

  it("sends it again once much more has been heard", async () => {
    const spans = [{ startSeconds: 0, endSeconds: 120 }];
    const more = { start: 70, end: 75, text: "And a good deal more." };
    await store.putAudio({ ...SPOKEN, speechSpans: spans, speech: [...SPOKEN.speech, more] });
    await seedWithVideo([{ ...U1, audio: true, transcript: RECORD }, A1]);
    await turns().run(() => Promise.resolve({ message: { ...U2, audio: true } }));
    expect(sent()).toContain("[1:10] And a good deal more.");
    expect(await transcripts()).toEqual([RECORD, { ...RECORD, spans }]);
  });

  it("replays with what has been heard by then, and compares with what was sent", async () => {
    await seedWithVideo([{ ...U1, audio: true }, A1]);
    await store.putAudio(SPOKEN);
    await turns().compare(model("other-model"));
    expect(sent()).not.toContain("Hello there.");
    await turns().replay();
    expect(sent()).toContain("[0:12] Hello there.");
    expect(await transcripts()).toEqual([RECORD]);
  });

  it("keeps the same text through Keep going, however much more has been heard", async () => {
    const spans = [{ startSeconds: 0, endSeconds: 120 }];
    const more = { start: 70, end: 75, text: "And a good deal more." };
    await store.putAudio({ ...SPOKEN, speechSpans: spans, speech: [...SPOKEN.speech, more] });
    await seedWithVideo([
      { ...U1, audio: true, transcript: RECORD },
      { ...A1, stoppedAtRoundLimit: true },
    ]);
    await turns().keepGoing();
    expect(sent()).toContain("[0:12] Hello there.");
    expect(sent()).not.toContain("good deal more");
    expect(await transcripts()).toEqual([RECORD, undefined]);
  });

  it("does not save or show the message again when its record would not change", async () => {
    await store.putAudio(SPOKEN);
    await seedWithVideo([{ ...U1, audio: true, transcript: RECORD }, A1]);
    const put = vi.spyOn(store, "putMessage");
    const show = vi.spyOn(conversation, "show");
    await turns().replay();
    expect(sent()).toContain("[0:12] Hello there.");
    expect(put.mock.calls.filter(([, message]) => message.id === "U1")).toHaveLength(1);
    expect(show.mock.calls.filter(([message]) => message.id === "U1")).toHaveLength(0);
  });

  it.each([
    ["nothing is stored for the new video", undefined],
    ["no speech was heard in it", HEARD],
  ])("drops another video's record on replay when %s", async (_when, audio) => {
    if (audio) await store.putAudio(audio);
    const stale = { ...RECORD, fileKey: "older-key" };
    await seedWithVideo([{ ...U1, audio: true, transcript: stale }, A1]);
    await turns().replay();
    expect(await transcripts()).toEqual([undefined]);
    expect(sent()).not.toContain("Transcript");
    expect(els.conversation.list.querySelector(".transcript-tag")).toBeNull();
  });

  it("keeps its own record on replay when the stored speech is gone", async () => {
    await seedWithVideo([{ ...U1, audio: true, transcript: RECORD }, A1]);
    await turns().replay();
    expect(await transcripts()).toEqual([RECORD]);
  });

  describe.each([
    ["with tools", true],
    ["without tools", false],
  ])("for a model %s", (_kind, tools) => {
    const carrier: UserMessage = { ...U1, audio: true, transcript: RECORD };
    const question: UserMessage = { ...U2, audio: true, text: "And then?" };

    async function seedFor(messages: ChatMessage[], extra: Partial<ModelInfo> = {}) {
      await store.putAudio(SPOKEN);
      await seedWithVideo(messages);
      setModels(state, [{ ...smallModel(), contextTokens: 100_000, tools, ...extra }]);
    }

    function userTexts(): string[] {
      const messages = streamChat.mock.lastCall?.[1].messages ?? [];
      return messages.flatMap(({ role, content }) => {
        if (role !== "user" || typeof content !== "string") return [];
        return content.startsWith("Context for") ? [] : [content];
      });
    }

    function expectTurnTwo(): void {
      const [first, second] = userTexts();
      expect(first).toContain(tools ? "Sent earlier; call listen" : "[0:12] Hello there.");
      expect(second).toBe("And then?");
    }

    it("sends the stub or the full text at the same place on turn two", async () => {
      await seedFor([carrier, A1]);
      await turns().run(() => Promise.resolve({ message: question }));
      expectTurnTwo();
      expect(await transcripts()).toEqual([RECORD, undefined]);
    });

    it("sends no transcript text on a message with audio off", async () => {
      await seedFor([carrier, A1]);
      await turns().run(() => Promise.resolve({ message: { ...U2, text: "And then?" } }));
      expect(sent()).not.toContain("Hello there.");
      expect(sent()).not.toContain("listen");
    });

    it("carries it again once the message that carried it is folded away", async () => {
      const [first, ...rest] = longHistory(6);
      if (first?.role !== "user") throw new Error("Expected a user message");
      await seedFor([{ ...first, audio: true, transcript: RECORD }, ...rest], {
        contextTokens: 1600,
      });
      streamChat.mockImplementation((_settings, request) =>
        answer(isSummaryRequest(request) ? "They went to the beach." : "New reply"),
      );
      const message = { ...question, createdAt: 100 };
      await turns().run(() => Promise.resolve({ message }));
      expect(state.currentChat?.storySoFar).toMatchObject({ throughMessageId: "a2" });
      expect(userTexts().at(-1)).toMatch(/^And then\?\n\nTranscript[\s\S]*\[0:12\] Hello there\.$/);
      const records = await transcripts();
      expect(records.at(0)).toEqual(RECORD);
      expect(records.at(-1)).toEqual(RECORD);

      const next = { ...question, id: "U3", text: "Last?", createdAt: 200 };
      await turns().run(() => Promise.resolve({ message: next }));
      expect(userTexts().at(-1)).toBe("Last?");
      expect(userTexts().some((text) => text.includes("Hello there."))).toBe(!tools);
    });

    async function openBranchAt(message: ChatMessage): Promise<void> {
      const actions = initMessageActions(state, {
        store,
        status,
        toast: stillToast(els),
        conversation,
        images: idleImages(),
        streamChat,
        toolContext: () => undefined,
        onOpen: vi.fn(),
        onChatsChanged: vi.fn(),
        newId: () => "branch",
      });
      await actions.branch(message);
      const copy = state.chats.find((chat) => chat.id === "branch");
      if (!copy) throw new Error("No branch");
      const loaded = state.video;
      setCurrentChat(state, copy, await store.listMessages("branch"));
      if (loaded) setLoadedVideo(state, { ...loaded, chatId: "branch" });
    }

    it("reads the same in a branch", async () => {
      await seedFor([carrier, A1, U2, A2]);
      await openBranchAt(A1);
      await turns().run(() => Promise.resolve({ message: { ...question, id: "U3" } }));
      expectTurnTwo();
    });

    it("carries it again in a branch whose summary covers the message that carried it", async () => {
      await seedFor([carrier, A1, U2, A2]);
      const chat = state.currentChat;
      if (!chat) throw new Error("No chat");
      const storySoFar = { text: "Hello was said.", throughMessageId: A1.id, updatedAt: 1 };
      replaceChat(state, { ...chat, storySoFar });
      setCurrentChat(state, { ...chat, storySoFar }, [...state.messages]);
      await openBranchAt(A2);
      await turns().run(() =>
        Promise.resolve({ message: { ...question, id: "U3", createdAt: 9 } }),
      );
      expect(userTexts().at(-1)).toContain("[0:12] Hello there.");
    });
  });

  it("keeps the full text on turn two while the video's file is not loaded", async () => {
    await store.putAudio(SPOKEN);
    setModels(state, [{ ...smallModel(), contextTokens: 100_000 }]);
    await seed([{ ...U1, audio: true, transcript: RECORD }, A1], { video: VIDEO });
    await turns().run(() => Promise.resolve({ message: { ...U2, audio: true } }));
    expect(sent()).toContain("[0:12] Hello there.");
    expect(sent()).not.toContain("listen");
    expect(await transcripts()).toEqual([RECORD, undefined]);
  });

  it("sends stored speech while the video's file is not loaded, without listen", async () => {
    await store.putAudio(SPOKEN);
    setModels(state, [smallModel()]);
    await seed([], { video: VIDEO });
    await turns().run(() => Promise.resolve({ message: { ...U1, audio: true } }));
    expect(sent()).toContain("[0:12] Hello there.");
    expect(sent()).not.toContain("listen");
  });
});

describe("audio across replays", () => {
  it("keeps the message's audio setting on replay, edit and keep going", async () => {
    await seedWithVideo([{ ...U1, audio: true }, A1]);
    await turns().replay();
    expect(lastTurnDeps()?.audioCoverage?.text).toBe("not analysed yet");
    expect(lastTurnDeps()?.tools.map((tool) => tool.function.name)).toContain("listen");

    await seedWithVideo([{ ...U1, audio: true }, A1]);
    await turns().edit({ ...U1, audio: true }, "one, again");
    expect(lastTurnDeps()?.audioCoverage?.text).toBe("not analysed yet");

    await seedWithVideo([
      { ...U1, audio: true },
      { ...A1, stoppedAtRoundLimit: true },
    ]);
    await turns().keepGoing();
    const sent = (await store.listMessages("chat"))[2];
    expect(sent).toEqual(expect.objectContaining({ continuation: true, audio: true }));
    expect(lastTurnDeps()?.audioCoverage?.text).toBe("not analysed yet");
  });
});

describe("notes recorded mid-turn", () => {
  async function* noteCall(): AsyncGenerator<StreamEvent> {
    await Promise.resolve();
    yield {
      type: "toolCalls",
      calls: [{ id: "n1", name: "note", arguments: '{"t":75,"text":"wave hits"}' }],
    };
    yield { type: "done", finishReason: "tool_calls" };
  }

  function contextSent(call: number): string | undefined {
    const request: ChatRequest | undefined = streamChat.mock.calls[call]?.[1];
    const found = request?.messages.find(
      (m) => typeof m.content === "string" && m.content.startsWith("Context for this reply"),
    );
    return typeof found?.content === "string" ? found.content : undefined;
  }

  it("sends the same context block in the rounds after a note, and saves the note", async () => {
    streamChat.mockImplementationOnce(() => noteCall());
    await seedWithVideo([]);
    await turns().run(() => Promise.resolve({ message: U1 }));
    expect(streamChat).toHaveBeenCalledTimes(2);
    expect(contextSent(1)).toBe(contextSent(0));
    expect((await store.getChat("chat"))?.sceneLog).toEqual([
      { timeSeconds: 75, text: "wave hits" },
    ]);
  });
});

describe("the model a turn sends", () => {
  it("names the default model when the chat names none and no model list loaded", async () => {
    await seed([], { settings: { ...blankChat(MODEL, "chat", 1).settings, modelId: "" } });
    await turns().run(() => Promise.resolve({ message: U1 }));
    expect(streamChat.mock.calls[0]?.[1].model).toBe(MODEL);
  });
});

describe("tools without a loaded video", () => {
  const photo: ImageRef = {
    id: "photo",
    pinned: false,
    source: { kind: "upload", name: "beach.jpg" },
  };
  const withPhoto: UserMessage = { ...U1, images: [photo] };

  function systemSent(): string {
    const content = streamChat.mock.calls[0]?.[1].messages[0]?.content;
    return typeof content === "string" ? content : "";
  }

  beforeEach(() => setModels(state, [model(MODEL)]));

  it("offers recall and zoom when the message being sent holds an image", async () => {
    await seed([]);
    await turns().run(() => Promise.resolve({ message: withPhoto }));
    expect(sentTools()).toEqual(["recall", "zoom"]);
    expect(systemSent()).toContain("use zoom");
    expect(systemSent()).not.toContain("look, frames and note");
    expect(lastTurnDeps()?.toolsOptional).toBe(true);
  });

  it("offers them in a chat whose video is not loaded, without the video guidance", async () => {
    await seed([withPhoto, A1], { video: VIDEO });
    await turns().run(() => Promise.resolve({ message: U2 }));
    expect(sentTools()).toEqual(["recall", "zoom"]);
    expect(systemSent()).toContain("Attached video: beach.mp4");
    expect(systemSent()).not.toContain("look, frames and note");
  });

  it("offers nothing without an image or to a model that cannot see", async () => {
    await seed([], { video: VIDEO });
    await turns().run(() => Promise.resolve({ message: U1 }));
    expect(sentTools()).toEqual([]);
    expect(systemSent()).not.toContain("look, frames and note");
    expect(lastTurnDeps()?.runTool).toBeUndefined();
    streamChat.mockClear();
    setModels(state, [model(MODEL, { vision: false })]);
    await seed([]);
    await turns().run(() => Promise.resolve({ message: withPhoto }));
    expect(sentTools()).toEqual([]);
  });

  it("leaves zoom out with a loaded video and a model that cannot see", async () => {
    await seedWithVideo([]);
    setModels(state, [model(MODEL, { vision: false })]);
    await turns().run(() => Promise.resolve({ message: U1 }));
    expect(sentTools()).toEqual(["look", "frames", "note", "recall"]);
    expect(lastTurnDeps()?.toolsOptional).toBe(false);
  });

  it("lists no tools and says nothing about them to a model without tools", async () => {
    await seedWithVideo([]);
    setModels(state, [model(MODEL, { tools: false })]);
    await turns().run(() => Promise.resolve({ message: U1 }));
    expect(sentTools()).toEqual([]);
    expect(systemSent()).not.toContain("look, frames and note");
  });

  it("recalls an image sent in the chat", async () => {
    const id = await store.putImage(new Blob(["x"], { type: "image/jpeg" }));
    await seed([]);
    const message: UserMessage = { ...withPhoto, images: [{ ...photo, id }] };
    vi.mocked(runTurn).mockResolvedValueOnce({ status: "done" });
    await turns().run(() => Promise.resolve({ message }));
    const recalled = await lastTurnDeps()?.runTool?.({
      id: "c1",
      name: "recall",
      arguments: JSON.stringify({ names: ["beach.jpg"] }),
    });
    expect(recalled?.images.map((image) => image.id)).toEqual([id]);
  });

  it("refuses to zoom a recalled sheet from an earlier video", async () => {
    const sheet: ImageRef = {
      id: "s1",
      pinned: false,
      source: {
        kind: "sheet",
        call: "look(0, 10)",
        name: "grid_0001",
        startSeconds: 0,
        endSeconds: 10,
        frameCount: 4,
        resolution: 1024,
      },
    };
    const older: VideoAttachment = { ...VIDEO, name: "dunes.mp4", fileKey: "dunes-key" };
    const recall: ChatMessage = {
      id: "T2",
      createdAt: 5,
      role: "tool",
      toolCallId: "c",
      text: "",
      images: [sheet],
    };
    await seedWithVideo([
      { ...U1, video: older, images: [sheet] },
      A1,
      { ...U2, video: VIDEO },
      { ...A2, text: "", toolCalls: [{ id: "c", name: "recall", arguments: "{}" }] },
      recall,
    ]);
    vi.mocked(runTurn).mockResolvedValueOnce({ status: "done" });
    await turns().run(() => Promise.resolve({}));
    const area = { left: 100, top: 100, right: 200, bottom: 200 };
    const zoomed = await lastTurnDeps()?.runTool?.({
      id: "c2",
      name: "zoom",
      arguments: JSON.stringify({ image: "grid_0001", ...area }),
    });
    expect(zoomed?.images).toEqual([]);
    expect(zoomed?.text).toContain("shows dunes.mp4, which is not loaded");
  });
});
