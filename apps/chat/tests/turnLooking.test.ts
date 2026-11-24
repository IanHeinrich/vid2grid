import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/http";
import { VENICE_BASE_URL } from "../src/api/venice";
import { initTurns, type Turns } from "../src/app/turns";
import { turnLooker, turnLooking } from "../src/app/turnLooking";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import type * as Render from "../src/video/render";
import { renderSheets } from "../src/video/render";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  createAppState,
  removeChat,
  replaceChat,
  setCurrentChat,
  setLoadedVideo,
  setLookingModels,
  setModels,
  setSettings,
  upsertMessage,
  type AppState,
} from "../src/state";
import type {
  ApiSettings,
  Chat,
  ChatMessage,
  ChatRequest,
  ChatStore,
  ImageRef,
  StreamChat,
  StreamEvent,
  ToolCall,
  UserMessage,
  VideoAttachment,
} from "../src/types";
import { assistant, model, tool, user } from "./support/factories";
import { idleImages } from "./support/images";
import { described, sentImageIds, textsOf } from "./support/looking";

vi.mock("../src/video/render", async (importOriginal) => {
  const actual = await importOriginal<typeof Render>();
  return { ...actual, renderSheets: vi.fn() };
});

const LOCAL = "http://localhost:5001/v1";
const VIDEO: VideoAttachment = {
  name: "beach.mp4",
  fileKey: "beach-key",
  durationSeconds: 60,
  width: 1280,
  height: 720,
};

let state: AppState;
let store: ChatStore;
let sent: { api: ApiSettings; request: ChatRequest }[];
let scripts: Record<string, StreamEvent[][]>;
let errors: string[];
let refuseTools: boolean;
let whenAsked: (modelId: string, signal: AbortSignal) => Promise<unknown>;

const INFO = { durationSeconds: 60, width: 1280, height: 720 };
const says = (delta: string): StreamEvent[] => [{ type: "text", delta }];
const calls = (call: ToolCall): StreamEvent[] => [{ type: "toolCalls", calls: [call] }];

const streamChat: StreamChat = async function* (api, request, signal) {
  await Promise.resolve();
  sent.push({ api, request });
  await whenAsked(request.model, signal);
  if (refuseTools && request.tools) throw new ApiError(400, "tools are not supported");
  yield* scripts[request.model]?.shift() ?? says("Nothing scripted.");
};

const status = { show: vi.fn(), clear: vi.fn() };
const conversation = {
  reset: vi.fn(),
  show: vi.fn(),
  apply: vi.fn(),
  showError: (text: string) => errors.push(text),
  endTurn: vi.fn(),
  clearErrors: vi.fn(),
  setRunning: vi.fn(),
};

function turns(): Turns {
  let nextId = 0;
  return initTurns(state, {
    store,
    status,
    conversation,
    video: { renderSceneLog: vi.fn() },
    images: idleImages(),
    streamChat,
    timeline: () => undefined,
    onChatChanged: vi.fn(),
    onRunningChanged: vi.fn(),
    onMessageSaved: vi.fn(),
    newId: () => `new-${++nextId}`,
    now: () => 10,
  });
}

async function photo(name: string): Promise<ImageRef> {
  const id = await store.putImage(new Blob([name], { type: "image/jpeg" }));
  return { id, pinned: false, source: { kind: "upload", name } };
}

async function seed(messages: ChatMessage[], extra: Partial<Chat> = {}): Promise<void> {
  const chat = { ...blankChat("writer", "chat", 1, "eyes", VENICE_BASE_URL), ...extra };
  await store.putChat(chat);
  for (const message of messages) await store.putMessage("chat", message);
  replaceChat(state, chat);
  setCurrentChat(state, chat, messages);
}

function models(): string[] {
  return sent.map(({ request }) => request.model);
}

function toolNames(index: number): string[] {
  return (sent[index]?.request.tools ?? []).map((tool) => tool.function.name);
}

beforeEach(() => {
  state = createAppState({
    ...DEFAULT_SETTINGS,
    baseUrl: LOCAL,
    apiKey: "local-key",
    apiKeys: { [LOCAL]: "local-key", [VENICE_BASE_URL]: "venice-key" },
    lookingBaseUrl: VENICE_BASE_URL,
  });
  setModels(state, [model("writer", { vision: false }), model("other")]);
  setLookingModels(state, [model("eyes", { name: "Eyes", maxImages: 4 })]);
  store = createMemoryStore();
  sent = [];
  scripts = {};
  errors = [];
  refuseTools = false;
  whenAsked = () => Promise.resolve();
  conversation.apply.mockClear();
  conversation.show.mockClear();
  status.show.mockClear();
  vi.mocked(renderSheets).mockReset();
});

describe("a turn with a looking model", () => {
  it("asks each model on its own connection and saves what was seen on the message", async () => {
    scripts = { eyes: [says("A dog.")], writer: [says("It is a dog.")] };
    await seed([]);
    const image = await photo("dog.jpg");
    await turns().run(() =>
      Promise.resolve({ message: user("u", "What is it?", { images: [image] }) }),
    );
    expect(sent.map(({ api }) => api)).toEqual([
      { baseUrl: VENICE_BASE_URL, apiKey: "venice-key" },
      { baseUrl: LOCAL, apiKey: "local-key" },
    ]);
    expect(sent[0]?.request).toHaveProperty("venice_parameters");
    expect(sent[1]?.request).not.toHaveProperty("venice_parameters");
    expect(sentImageIds(sent[0]?.request)).toEqual(["dog.jpg"]);
    expect(JSON.stringify(sent[1])).not.toContain("image_url");
    const note = described([image.id], "A dog.", { question: "What is it?" });
    expect((await store.listMessages("chat"))[0]).toMatchObject({ seen: [note] });
    expect(state.messages[0]).toMatchObject({ seen: [note] });
  });

  it("offers ask in place of recall, and zoom to a writer that cannot see", async () => {
    scripts = { eyes: [says("A dog.")] };
    await seed([]);
    const image = await photo("dog.jpg");
    await turns().run(() => Promise.resolve({ message: user("u", "Hm?", { images: [image] }) }));
    expect(toolNames(1)).toEqual(["ask", "zoom"]);
    sent = [];
    await seed([], { video: VIDEO });
    const info = { durationSeconds: 60, width: 1280, height: 720 };
    setLoadedVideo(state, { chatId: "chat", file: new File([], "beach.mp4"), info });
    await turns().run(() => Promise.resolve({ message: user("v", "Hm?") }));
    expect(toolNames(0)).toEqual(["look", "frames", "note", "ask", "zoom"]);
  });

  it("answers an ask about an earlier turn's picture from the stored picture", async () => {
    const image = await photo("dog.jpg");
    const seen = [described([image.id], "A dog.")];
    const asked = { question: "Which breed?", pictures: ["dog.jpg"] };
    scripts = {
      eyes: [says("A collie.")],
      writer: [
        calls({ id: "c", name: "ask", arguments: JSON.stringify(asked) }),
        says("It is a collie."),
      ],
    };
    await seed([user("u", "Hm?", { images: [image], seen }), assistant("a", "A dog.")]);
    await turns().run(() => Promise.resolve({ message: user("v", "Breed?", { createdAt: 5 }) }));
    expect(models()).toEqual(["writer", "eyes", "writer"]);
    expect(sentImageIds(sent[1]?.request)).toEqual(["dog.jpg"]);
    expect(textsOf(sent[1]?.request)[1]).toContain("Answered: A dog.");
    expect(JSON.stringify(sent[2]?.request.messages)).toContain("A collie.");
    const reply = (await store.listMessages("chat")).find(({ role }) => role === "tool");
    expect(reply).toMatchObject({
      images: [image],
      seen: [{ kind: "answered", question: "Which breed?", text: "A collie." }],
    });
  });

  it("goes on when an ask fails", async () => {
    const image = await photo("dog.jpg");
    const asked = { question: "Which breed?", pictures: ["dog.jpg"] };
    scripts = {
      eyes: [says("")],
      writer: [calls({ id: "c", name: "ask", arguments: JSON.stringify(asked) }), says("Unsure.")],
    };
    const seen = [described([image.id], "A dog.")];
    await seed([user("u", "Hm?", { images: [image], seen })]);
    await turns().replay();
    expect(errors).toEqual([]);
    expect(JSON.stringify(sent[2]?.request.messages)).toContain("its answer was empty");
  });

  it("shows a failed look as an error, and a retry looks again", async () => {
    scripts = { eyes: [says(""), says("A dog.")], writer: [says("A dog.")] };
    await seed([]);
    const image = await photo("dog.jpg");
    const running = turns();
    await running.run(() => Promise.resolve({ message: user("u", "Hm?", { images: [image] }) }));
    expect(errors).toEqual([
      "The looking model Eyes at api.venice.ai could not look at the pictures: its answer was empty.",
    ]);
    expect(models()).toEqual(["eyes"]);
    await running.replay();
    expect(models()).toEqual(["eyes", "eyes", "writer"]);
  });

  it("pays for a picture once across replay and compare", async () => {
    scripts = { eyes: [says("A dog.")] };
    await seed([]);
    const image = await photo("dog.jpg");
    const running = turns();
    await running.run(() => Promise.resolve({ message: user("u", "Hm?", { images: [image] }) }));
    await running.replay();
    await running.compare(model("other"));
    expect(models()).toEqual(["eyes", "writer", "writer", "other"]);
    expect(JSON.stringify(sent[3])).toContain("A dog.");
    expect(JSON.stringify(sent[3])).not.toContain("image_url");
  });

  it("lets a server that refuses tools go on without them, with the video loaded too", async () => {
    await seed([], { video: VIDEO });
    const info = { durationSeconds: 60, width: 1280, height: 720 };
    setLoadedVideo(state, { chatId: "chat", file: new File([], "beach.mp4"), info });
    refuseTools = true;
    await turns().run(() => Promise.resolve({ message: user("v", "Hm?") }));
    expect(errors).toEqual([]);
    expect(sent.map((_, index) => toolNames(index).length > 0)).toEqual([true, false]);
  });
});

describe("a turn whose looking server is no longer set up", () => {
  it("sends nothing at all, and says which server it was", async () => {
    state = createAppState({ ...state.settings, lookingBaseUrl: "" });
    await seed([]);
    const image = await photo("dog.jpg");
    await turns().run(() => Promise.resolve({ message: user("u", "Hm?", { images: [image] }) }));
    expect(sent).toEqual([]);
    expect(errors).toEqual([expect.stringContaining("picked on api.venice.ai") as string]);
  });

  it("leaves the reply and the message as they are on replay, compare and edit", async () => {
    const before = [user("u", "Hm?"), assistant("a", "A dog.")];
    await seed(before);
    const { settings } = state;
    setSettings(state, { ...settings, lookingBaseUrl: "" });
    const running = turns();
    const onUnsaved = vi.fn();
    await running.replay();
    await running.compare(model("other"));
    await running.edit(user("u", "Hm?"), "Well?", onUnsaved);
    expect(onUnsaved).toHaveBeenCalledTimes(1);
    await running.keepGoing();
    expect(await store.listMessages("chat")).toEqual(before);
    expect(state.messages).toEqual(before);
    expect(sent).toEqual([]);
    expect(errors).toHaveLength(4);
  });

  it("takes and saves nothing of a new message", async () => {
    await seed([]);
    setSettings(state, { ...state.settings, lookingBaseUrl: "" });
    const prepare = vi.fn(() => Promise.resolve({ message: user("u", "Hm?") }));
    await turns().run(prepare);
    expect(prepare).not.toHaveBeenCalled();
    expect(await store.listMessages("chat")).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});

describe("a message that could not be saved or looked at", () => {
  async function sending(onUnsaved: () => void): Promise<void> {
    const message = user("u", "Hm?", { images: [await photo("dog.jpg")] });
    await turns().run(() => Promise.resolve({ message, onUnsaved }));
  }

  it("is handed back before any look when it could not be saved", async () => {
    await seed([]);
    await store.deleteChat("chat");
    const onUnsaved = vi.fn();
    await sending(onUnsaved);
    expect(onUnsaved).toHaveBeenCalledTimes(1);
    expect(status.show).toHaveBeenCalledWith("This chat has been deleted.", "error");
    expect(sent).toEqual([]);
    expect(state.messages).toEqual([]);
  });

  it("is not handed back when it was saved and looking failed", async () => {
    scripts = { eyes: [says("")] };
    await seed([]);
    const onUnsaved = vi.fn();
    await sending(onUnsaved);
    expect(errors).toHaveLength(1);
    expect(onUnsaved).not.toHaveBeenCalled();
    expect(await store.listMessages("chat")).toMatchObject([{ text: "Hm?" }]);
  });

  it("says only that its chat was deleted elsewhere during a look, and brings nothing back", async () => {
    scripts = { eyes: [says("A dog.")] };
    await seed([]);
    whenAsked = () => store.deleteChat("chat");
    const onUnsaved = vi.fn();
    await sending(onUnsaved);
    expect(errors).toEqual(["This chat has been deleted."]);
    expect(models()).toEqual(["eyes"]);
    expect(onUnsaved).not.toHaveBeenCalled();
    expect(await store.getChat("chat")).toBeUndefined();
    expect(await store.listMessages("chat")).toEqual([]);
    expect(state.running).toBe(false);
  });

  it("says nothing when its chat is deleted here during a look", async () => {
    scripts = { eyes: [says("A dog.")] };
    await seed([]);
    const message = user("u", "Hm?", { images: [await photo("dog.jpg")] });
    const running = turns();
    whenAsked = async () => {
      running.stop();
      removeChat(state, "chat");
      await store.deleteChat("chat");
    };
    await running.run(() => Promise.resolve({ message }));
    expect([errors, status.show.mock.calls]).toEqual([[], []]);
    expect(await store.listMessages("chat")).toEqual([]);
  });
});

describe("a look cut short", () => {
  const asked = { question: "Which?", pictures: ["dog.jpg"] };
  const looked = { start: 0, end: 10, frames: 4, perSheet: 4 };
  let signals: AbortSignal[];

  function hang(signal: AbortSignal | undefined): Promise<never> {
    if (!signal) throw new Error("No signal");
    signals.push(signal);
    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason as Error));
    });
  }

  const hangingEyes = (modelId: string, signal: AbortSignal) =>
    modelId === "eyes" ? hang(signal) : Promise.resolve();

  async function describing(): Promise<UserMessage> {
    whenAsked = hangingEyes;
    await seed([]);
    return user("u", "Hm?", { images: [await photo("dog.jpg")] });
  }

  async function asking(): Promise<UserMessage> {
    whenAsked = hangingEyes;
    const call = { id: "c", name: "ask", arguments: JSON.stringify(asked) };
    scripts = { writer: [calls(call)] };
    const image = await photo("dog.jpg");
    const seen = [described([image.id], "A dog.")];
    await seed([user("u0", "Hm?", { images: [image], seen }), assistant("a0", "A dog.")]);
    return user("u", "Which?", { createdAt: 5 });
  }

  async function rendering(): Promise<UserMessage> {
    vi.mocked(renderSheets).mockImplementation((...args) => hang(args[4]));
    const call = { id: "c", name: "look", arguments: JSON.stringify(looked) };
    scripts = { writer: [calls(call)] };
    await seed([], { video: VIDEO });
    setLoadedVideo(state, { chatId: "chat", file: new File([], "beach.mp4"), info: INFO });
    return user("u", "Hm?");
  }

  beforeEach(() => {
    signals = [];
  });

  const kinds: [string, () => Promise<UserMessage>][] = [
    ["before a round", describing],
    ["by ask", asking],
    ["by a render", rendering],
  ];

  it.each(kinds)("ends %s with Stop", async (_what, begin) => {
    const message = await begin();
    const running = turns();
    const run = running.run(() => Promise.resolve({ message }));
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const before = sent.length;
    running.stop();
    await run;
    expect(signals[0]?.aborted).toBe(true);
    expect(sent).toHaveLength(before);
    expect(errors).toEqual([]);
  });

  it.each(kinds)("ends %s with Answer now, which still answers", async (_what, begin) => {
    const message = await begin();
    const running = turns();
    const run = running.run(() => Promise.resolve({ message }));
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    running.answerNow();
    await run;
    expect(signals[0]?.aborted).toBe(true);
    expect(models().at(-1)).toBe("writer");
    expect((await store.listMessages("chat")).at(-1)).toMatchObject({ role: "assistant" });
    expect(errors).toEqual([]);
  });

  it("ends when another chat opens, leaving that one as it is", async () => {
    const message = await describing();
    const running = turns();
    const run = running.run(() => Promise.resolve({ message }));
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const other = { ...blankChat("writer", "other", 2), title: "Other" };
    conversation.apply.mockClear();
    running.stop();
    setCurrentChat(state, other, []);
    await run;
    expect(models()).toEqual(["eyes"]);
    expect([errors, status.show.mock.calls]).toEqual([[], []]);
    expect(conversation.apply).not.toHaveBeenCalled();
    expect(state.messages).toEqual([]);
    expect(await store.listMessages("chat")).toEqual([message]);
  });

  it("does not begin once another chat is open", async () => {
    const message = await describing();
    const getCast = store.getCast.bind(store);
    store.getCast = (key) => {
      setCurrentChat(state, blankChat("writer", "other", 2), []);
      return getCast(key);
    };
    await seed([], { video: VIDEO });
    await turns().run(() => Promise.resolve({ message }));
    expect(sent).toEqual([]);
    expect([errors, status.show.mock.calls]).toEqual([[], []]);
  });
});

describe("a turn with audio on", () => {
  const speech = [{ start: 12, end: 15, text: "Hello there." }];
  const spans = [{ startSeconds: 0, endSeconds: 60 }];
  const HEARD = { labels: [], backgroundLabels: [], soundSpans: [], events: [], updatedAt: 1 };

  async function hear(fileKey: string): Promise<VideoAttachment> {
    await store.putAudio({ ...HEARD, fileKey, speechSpans: spans, speech });
    return { ...VIDEO, fileKey };
  }

  const eyesRequests = () => JSON.stringify(sent.filter(({ request }) => request.model === "eyes"));

  it("gives the transcript to the writer alone, the same on every round", async () => {
    const note = { id: "c", name: "note", arguments: JSON.stringify({ t: 1, text: "Hm." }) };
    scripts = { eyes: [says("A dog.")], writer: [calls(note), says("A dog says hello.")] };
    await seed([], { video: await hear("heard-loaded") });
    setLoadedVideo(state, { chatId: "chat", file: new File([], "beach.mp4"), info: INFO });
    const message = user("u", "Who?", { images: [await photo("dog.jpg")], audio: true });
    await turns().run(() => Promise.resolve({ message }));
    expect(models()).toEqual(["eyes", "writer", "writer"]);
    expect(textsOf(sent[0]?.request).at(-1)).toBe(
      "Describe this picture. Pay attention to what this asks: Who?",
    );
    expect(eyesRequests()).not.toMatch(/Transcript|Hello there/);
    const [first, second] = [sent[1]?.request.messages ?? [], sent[2]?.request.messages ?? []];
    expect(second.slice(0, first.length)).toEqual(first);
    expect(first.at(-1)?.content).toMatch(
      /^Who\?\n\n\[Note[^]*A dog\.\n\[End[^]*\]\n\nTranscript of[^]*Hello there\.$/,
    );
    expect((await store.listMessages("chat"))[0]).toMatchObject({
      seen: [{ text: "A dog." }],
      transcript: { spans },
    });
  });

  it("keeps the transcript for a writer without tools, whose question it answers too", async () => {
    setModels(state, [model("writer", { vision: false, tools: false })]);
    const video = await hear("heard-toolless");
    const image = await photo("dog.jpg");
    const seen = [described([image.id], "A dog.")];
    const transcript = { fileKey: video.fileKey, spans };
    const first = user("u", "Who?", { images: [image], audio: true, seen, transcript });
    scripts = { eyes: [says("Brown.")], writer: [says("It is brown.")] };
    await seed([first, assistant("a", "A dog.")], { video });
    const message = user("v", "What colour?", { createdAt: 5, audio: true });
    await turns().run(() => Promise.resolve({ message }));
    expect(models()).toEqual(["eyes", "writer"]);
    expect(textsOf(sent[0]?.request).at(-1)).toBe("Answer this from the pictures: What colour?");
    expect(eyesRequests()).not.toMatch(/Transcript|Hello there/);
    const wire = sent[1]?.request.messages ?? [];
    expect(wire.find(({ role }) => role === "user")?.content).toMatch(
      /^Who\?[^]*A dog\.\n\[End[^]*\]\n\nTranscript of[^]*Hello there\.$/,
    );
    expect(wire.at(-1)?.content).toMatch(/^What colour\?\n\n\[Note[^]*\nBrown\.\n\[End/);
  });

  it("adds a transcript on replay to a message already described, and looks at nothing", async () => {
    const video = await hear("heard-replay");
    const image = await photo("dog.jpg");
    const seen = [described([image.id], "A dog.", { question: "Who?" })];
    await seed([user("u", "Who?", { images: [image], audio: true, seen })], { video });
    await turns().replay();
    expect(models()).toEqual(["writer"]);
    expect((await store.listMessages("chat"))[0]).toMatchObject({ seen, transcript: { spans } });
  });
});

describe("a video removed from the chat", () => {
  const removedVideos = [{ video: VIDEO, throughCreatedAt: 1 }];
  const call = (name: string, args: unknown) => ({
    ...{ id: name, name },
    arguments: JSON.stringify(args),
  });

  async function askAndZoom(
    first: Partial<UserMessage>,
    sentSince?: VideoAttachment,
  ): Promise<string[]> {
    const { id } = await photo("sheet");
    const source = {
      ...{ kind: "sheet" as const, call: "overview", name: "grid_0001", frameCount: 4 },
      ...{ startSeconds: 0, endSeconds: 60 },
    };
    const image: ImageRef = { id, pinned: false, source };
    const seen = [described([id], "Waves.")];
    const name = "grid_0001 from overview";
    const area = { left: 0, top: 0, right: 400, bottom: 400 };
    const asked = call("ask", { question: "How many?", pictures: [name] });
    const zoomed = call("zoom", { image: name, ...area });
    scripts = {
      eyes: [says("Three waves.")],
      writer: [[{ type: "toolCalls", calls: [asked, zoomed] }], says("Three.")],
    };
    await seed([user("u", "Hm?", { images: [image], seen, ...first }), assistant("a", "Waves.")], {
      ...(sentSince ? { video: sentSince } : {}),
      removedVideos,
    });
    const file = new File([], "video.mp4");
    if (sentSince) setLoadedVideo(state, { chatId: "chat", file, info: INFO });
    await turns().run(() => Promise.resolve({ message: user("v", "How many?", { createdAt: 5 }) }));
    expect(models()).toEqual(["writer", "eyes", "writer"]);
    expect(sentImageIds(sent[1]?.request)).toEqual(["sheet"]);
    expect((await store.listMessages("chat"))[0]).toMatchObject({ images: [image], seen });
    const replies = (await store.listMessages("chat")).filter(({ role }) => role === "tool");
    return replies.map(({ text }) => text);
  }

  const named: [string, Partial<UserMessage>][] = [
    ["a message names", { removedVideo: VIDEO }],
    ["no message names", {}],
  ];

  it.each(named)("that %s still has its sheets asked about, and not zoomed", async (_is, first) => {
    const [asked, zoomed] = await askAndZoom(first);
    expect(asked).toContain("Three waves.");
    expect(zoomed).toContain("shows beach.mp4, which is not loaded");
    expect(zoomed).toContain("The user can load it again.");
  });

  it.each(named)("that %s is not taken for the one sent since", async (_is, first) => {
    const dunes = { ...VIDEO, name: "dunes.mp4", fileKey: "dunes-key" };
    const [asked, zoomed] = await askAndZoom(first, dunes);
    expect(asked).toContain("Three waves.");
    expect(zoomed).toContain("shows beach.mp4, which is not loaded");
    expect(zoomed).toContain("The loaded video is dunes.mp4.");
  });
});

describe("looking again at a swiped reply's picture", () => {
  it("clears the mark once the picture is described in another reply", async () => {
    const image = await photo("dog.jpg");
    const marked = { ...tool("t", "c0", [image]), seen: [], lookAgain: true as const };
    const alternates = [{ messages: [assistant("x", ""), marked], createdAt: 1 }];
    scripts = { eyes: [says("A fox.")] };
    await seed([user("u", "Hm?", { images: [image], alternates })]);
    await turns().run(() => Promise.resolve({}));
    const [saved] = await store.listMessages("chat");
    if (saved?.role !== "user") throw new Error("No user message");
    expect(saved.seen).toMatchObject([{ text: "A fox." }]);
    expect(saved.alternates?.[0]?.messages[1]).not.toHaveProperty("lookAgain");
    expect(state.messages[0]).toEqual(saved);
  });
});

describe("editing a message whose pictures were described meanwhile", () => {
  it("keeps what was seen, though the page's copy is older", async () => {
    scripts = { eyes: [says("A dog.")] };
    await seed([]);
    const image = await photo("dog.jpg");
    const message = user("u", "Hm?", { images: [image] });
    const running = turns();
    await running.run(() => Promise.resolve({ message }));
    await running.edit(message, "Well?");
    const [saved] = await store.listMessages("chat");
    expect(saved).toMatchObject({ text: "Well?", seen: [{ text: "A dog." }] });
    expect(models().filter((id) => id === "eyes")).toHaveLength(1);
  });
});

describe("turnLooking", () => {
  const note = described(["i"], "A dog.");
  const NONE: ReadonlySet<string> = new Set();

  function saver(known: ChatMessage[]) {
    const deps = { store, streamChat, onMessageSaved: vi.fn() };
    const chat = state.chats[0];
    const looker = chat && turnLooker({ state, deps }, chat, 1024);
    return turnLooking({ state, deps }, "chat", looker, known).looking;
  }

  it("is nothing without a looking model", async () => {
    await seed([], blankChat("writer", "chat", 1));
    expect(saver([])).toBeUndefined();
  });

  it("adds to the message as it is now, keeping a pin changed meanwhile", async () => {
    const image = await photo("dog.jpg");
    const message: UserMessage = user("u", "Hm?", { images: [image] });
    await seed([message]);
    const known: ChatMessage[] = [message];
    const pinned = { ...message, images: [{ ...image, pinned: true }] };
    upsertMessage(state, pinned);
    await saver(known)?.save("u", [note], NONE);
    expect(await store.listMessages("chat")).toEqual([{ ...pinned, seen: [note] }]);
    expect(state.messages).toEqual([{ ...pinned, seen: [note] }]);
    expect(known).toEqual([{ ...message, seen: [note] }]);
  });

  it("saves into a chat the user has left, and not into one that is gone", async () => {
    const message = user("u", "Hm?");
    await seed([message]);
    const looking = saver([message]);
    setCurrentChat(state, null, []);
    await looking?.save("u", [note], NONE);
    expect(await store.listMessages("chat")).toEqual([{ ...message, seen: [note] }]);
    removeChat(state, "chat");
    await looking?.save("u", [], NONE);
    expect(await store.listMessages("chat")).toEqual([{ ...message, seen: [note] }]);
  });
});
