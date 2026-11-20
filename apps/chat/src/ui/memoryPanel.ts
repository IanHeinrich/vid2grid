import { summarizeStory } from "../chat/summary";
import type { AppElements } from "../dom";
import { updateChat, type AppState } from "../state";
import { errorText } from "../text";
import type { Chat, ChatStore, StorySoFar, StreamChat } from "../types";
import { createModelTask, modelCallDeps, type ModelTask } from "./modelTask";
import type { Toast } from "./toast";

export interface MemoryPanel {
  render(): void;
}

export interface MemoryDeps {
  store: ChatStore;
  toast: Toast;
  streamChat: StreamChat;
  onChanged(): void;
  now?: () => number;
}

interface MemoryContext {
  els: AppElements["memory"];
  state: AppState;
  deps: MemoryDeps;
  task: ModelTask;
}

export function initMemoryPanel(
  els: Pick<AppElements, "memory">,
  state: AppState,
  deps: MemoryDeps,
): MemoryPanel {
  const ctx: MemoryContext = {
    els: els.memory,
    state,
    deps,
    task: createModelTask(
      els.memory,
      () => render(ctx),
      () => state.currentChat?.id,
    ),
  };
  listen(ctx);
  render(ctx);
  return { render: () => render(ctx) };
}

function listen(ctx: MemoryContext): void {
  const { storyInput, summarizeButton, clearButton } = ctx.els;
  storyInput.addEventListener("change", () => {
    const text = storyInput.value.trim();
    if (text === "") {
      clearStory(ctx);
      return;
    }
    edit(ctx, (story) => ({ ...story, text, updatedAt: now(ctx) }));
  });
  summarizeButton.addEventListener("click", () => {
    void summarize(ctx);
  });
  clearButton.addEventListener("click", () => clearStory(ctx));
}

function now(ctx: MemoryContext): number {
  return (ctx.deps.now ?? Date.now)();
}

async function saveStory(
  ctx: MemoryContext,
  chatId: string,
  story: StorySoFar | undefined,
): Promise<void> {
  const updated = await updateChat(ctx.state, ctx.deps.store, chatId, (chat) => {
    const next: Chat = { ...chat };
    if (story) next.storySoFar = story;
    else delete next.storySoFar;
    return next;
  });
  if (!updated) return;
  render(ctx);
  ctx.deps.onChanged();
}

function saveQuietly(ctx: MemoryContext, chatId: string, story: StorySoFar | undefined): void {
  saveStory(ctx, chatId, story).catch((error: unknown) => {
    ctx.task.report(`Could not save the chat summary: ${errorText(error)}`, "error");
  });
}

function edit(ctx: MemoryContext, change: (story: StorySoFar) => StorySoFar): void {
  const chat = ctx.state.currentChat;
  if (!chat?.storySoFar) return;
  saveQuietly(ctx, chat.id, change(chat.storySoFar));
}

function clearStory(ctx: MemoryContext): void {
  const chat = ctx.state.currentChat;
  const before = chat?.storySoFar;
  if (!chat || !before) return;
  saveQuietly(ctx, chat.id, undefined);
  ctx.deps.toast.show("Chat summary cleared", {
    label: "Undo",
    run: () => saveQuietly(ctx, chat.id, before),
  });
}

async function summarize(ctx: MemoryContext): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat || ctx.task.running()) return;
  const messages = [...ctx.state.messages];
  const story = await ctx.task.run("Summarizing the older messages…", (signal) =>
    summarizeStory(
      {
        ...modelCallDeps(ctx.state, ctx.deps.streamChat, chat.settings.modelId, signal),
        ...(ctx.deps.now ? { now: ctx.deps.now } : {}),
      },
      { chat: ctx.state.chats.find((entry) => entry.id === chat.id) ?? chat, messages },
    ).then((result) => result ?? null),
  );
  if (story === null) {
    ctx.task.report("Nothing to fold in yet: the latest turns are always kept as they are.");
  } else if (story) {
    await saveStory(ctx, chat.id, story).catch((error: unknown) => {
      ctx.task.report(`Could not save the chat summary: ${errorText(error)}`, "error");
    });
  }
}

function render(ctx: MemoryContext): void {
  const { storyInput, storyMeta, summarizeButton, clearButton } = ctx.els;
  const chat = ctx.state.currentChat;
  const story = chat?.storySoFar;
  ctx.task.sync();
  if (document.activeElement !== storyInput) storyInput.value = story?.text ?? "";
  storyInput.readOnly = story === undefined;
  storyInput.placeholder = story
    ? ""
    : "No summary yet. Summarize now folds the older messages into one, and you can edit it after.";
  storyMeta.textContent = story ? metaText(ctx, story) : "";
  summarizeButton.disabled = !chat || ctx.task.running();
  clearButton.disabled = story === undefined;
}

function metaText(ctx: MemoryContext, story: StorySoFar): string {
  const through = ctx.state.messages.findIndex((message) => message.id === story.throughMessageId);
  const covers = through === -1 ? "" : `Covers the first ${through + 1} messages. `;
  return `${covers}Updated ${new Date(story.updatedAt).toLocaleString()}.`;
}
