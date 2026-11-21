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
  type AppState,
} from "../src/state";
import type {
  Chat,
  ChatMessage,
  ChatRequest,
  ChatStore,
  ModelInfo,
  StreamChat,
  StreamEvent,
  UserMessage,
  VideoAttachment,
  VideoAudio,
  VideoCast,
} from "../src/types";
import { initConversation, type Conversation } from "../src/ui/conversation";
import { storedPickerSettings } from "../src/ui/pickerModel";
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
import { mountPage } from "./support/page";
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
    expect(sentTools()).toEqual(["look", "frames", "note", "recall", "listen"]);
    expect(lastTurnDeps()?.audioCoverage).toEqual({
      text: "analysed 0:00 to 1:00 (speech and sounds)",
      canListen: true,
    });
  });

  it("sends nothing about audio when it is off, even with audio heard", async () => {
    await store.putAudio(HEARD);
    await seedWithVideo([]);
    await turns().run(() => Promise.resolve({ message: U1 }));
    expect(sentTools()).toEqual(["look", "frames", "note", "recall"]);
    expect(lastTurnDeps()?.audioCoverage).toBeUndefined();
    expect(JSON.stringify(streamChat.mock.calls[0]?.[1])).not.toContain("listen");
  });

  it("tells the model a video has no audio track, without offering listen", async () => {
    await store.putAudio({ ...HEARD, noAudio: true });
    await seedWithVideo([]);
    await turns().run(() => Promise.resolve({ message: { ...U1, audio: true } }));
    expect(sentTools()).toEqual(["look", "frames", "note", "recall"]);
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
