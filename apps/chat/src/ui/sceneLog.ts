import { chatModelId } from "../chat/models";
import { condenseSceneLog } from "../chat/summary";
import type { AppElements } from "../dom";
import { updateChat, type AppState } from "../state";
import { errorText } from "../text";
import { formatTimestamp, parseTimestamp, timedLine } from "../time";
import type { ChatStore, SceneNote, StreamChat } from "../types";
import { iconButton, seekButton, smallButton } from "./buttons";
import { modelCallDeps } from "../app/modelCallDeps";
import { createModelTask, type ModelTask } from "./modelTask";
import type { Toast } from "./toast";

export interface SceneLogPanel {
  render(): void;
}

export interface SceneLogDeps {
  store: ChatStore;
  toast: Toast;
  streamChat: StreamChat;
  currentTime(): number | undefined;
  seek(seconds: number): void;
  onChanged(): void;
}

interface CondensePreview {
  chatId: string;
  from: readonly SceneNote[];
  notes: SceneNote[];
}

interface NoteEdit {
  chatId: string;
  // The note being edited, or "new" for one being added.
  note: SceneNote | "new";
}

interface SceneLogContext {
  els: AppElements["sceneLog"];
  state: AppState;
  deps: SceneLogDeps;
  task: ModelTask;
  editing: NoteEdit | null;
  draftTime: number;
  preview: CondensePreview | null;
}

export function sceneLogTokens(notes: readonly SceneNote[]): number {
  const characters = notes.reduce(
    (sum, note) => sum + `${timedLine(formatTimestamp(note.timeSeconds), note.text)}\n`.length,
    0,
  );
  return Math.ceil(characters / 4);
}

function byTime(notes: readonly SceneNote[]): SceneNote[] {
  return [...notes].sort((a, b) => a.timeSeconds - b.timeSeconds);
}

export function initSceneLog(
  els: Pick<AppElements, "sceneLog">,
  state: AppState,
  deps: SceneLogDeps,
): SceneLogPanel {
  const ctx: SceneLogContext = {
    els: els.sceneLog,
    state,
    deps,
    task: createModelTask(
      els.sceneLog,
      () => render(ctx),
      () => state.currentChat?.id,
    ),
    editing: null,
    draftTime: 0,
    preview: null,
  };
  listen(ctx);
  render(ctx);
  return { render: () => render(ctx) };
}

function listen(ctx: SceneLogContext): void {
  const { addButton, condenseButton, acceptButton, discardButton } = ctx.els;
  addButton.addEventListener("click", () => {
    const chat = ctx.state.currentChat;
    if (ctx.editing !== null || !chat) return;
    ctx.editing = { chatId: chat.id, note: "new" };
    ctx.draftTime = ctx.deps.currentTime() ?? 0;
    render(ctx);
    renderList(ctx);
  });
  condenseButton.addEventListener("click", () => {
    void condense(ctx);
  });
  acceptButton.addEventListener("click", () => acceptPreview(ctx));
  discardButton.addEventListener("click", () => {
    ctx.preview = null;
    render(ctx);
  });
}

function durationOf(ctx: SceneLogContext, notes: readonly SceneNote[]): number {
  const video = ctx.state.currentChat?.video;
  return video?.durationSeconds ?? Math.max(0, ...notes.map((note) => note.timeSeconds));
}

async function saveLog(
  ctx: SceneLogContext,
  chatId: string,
  change: (log: SceneNote[]) => SceneNote[],
): Promise<void> {
  const updated = await updateChat(ctx.state, ctx.deps.store, chatId, (chat) => ({
    ...chat,
    sceneLog: change(chat.sceneLog),
  }));
  if (!updated) return;
  render(ctx);
  ctx.deps.onChanged();
}

function saveQuietly(
  ctx: SceneLogContext,
  chatId: string,
  change: (log: SceneNote[]) => SceneNote[],
): void {
  saveLog(ctx, chatId, change).catch((error: unknown) => {
    ctx.task.report(`Could not save the scene log: ${errorText(error)}`, "error");
  });
}

function removeNote(ctx: SceneLogContext, note: SceneNote): void {
  const chat = ctx.state.currentChat;
  if (!chat) return;
  saveQuietly(ctx, chat.id, (log) => log.filter((entry) => entry !== note));
  ctx.deps.toast.show("Note deleted", {
    label: "Undo",
    run: () => saveQuietly(ctx, chat.id, (log) => [...log, note]),
  });
}

function finishEdit(ctx: SceneLogContext, saved: SceneNote | null): void {
  const editing = ctx.editing;
  ctx.editing = null;
  render(ctx);
  // The rebuilt list dropped the focused control; leaving focus on the body escapes the drawer.
  ctx.els.addButton.focus();
  if (!saved || editing === null) return;
  const { chatId, note } = editing;
  saveQuietly(ctx, chatId, (log) =>
    note === "new" ? [...log, saved] : log.map((entry) => (entry === note ? saved : entry)),
  );
}

async function condense(ctx: SceneLogContext): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat || chat.sceneLog.length < 2) return;
  const from = [...chat.sceneLog];
  ctx.preview = null;
  const notes = await ctx.task.run("Condensing the scene log…", (signal) =>
    condenseSceneLog(
      modelCallDeps(ctx.state, ctx.deps.streamChat, chatModelId(ctx.state, chat), signal),
      from,
      durationOf(ctx, from),
    ),
  );
  if (!notes || ctx.state.currentChat?.id !== chat.id) return;
  ctx.preview = { chatId: chat.id, from, notes };
  render(ctx);
}

// Notes the model added while the condense ran are not in the preview, so they are kept.
function acceptPreview(ctx: SceneLogContext): void {
  const preview = ctx.preview;
  if (!preview) return;
  ctx.preview = null;
  let before: SceneNote[] = [];
  saveQuietly(ctx, preview.chatId, (log) => {
    before = log;
    return [...preview.notes, ...log.filter((note) => !preview.from.includes(note))];
  });
  ctx.deps.toast.show("Scene log condensed", {
    label: "Undo",
    run: () =>
      saveQuietly(ctx, preview.chatId, (log) => [
        ...before,
        ...log.filter((note) => !preview.notes.includes(note) && !before.includes(note)),
      ]),
  });
}

function render(ctx: SceneLogContext): void {
  const { title, count, addButton, condenseButton, preview, previewList } = ctx.els;
  const chat = ctx.state.currentChat;
  ctx.task.sync();
  title.textContent = chat?.video ? `Scene log for ${chat.video.name}` : "Scene log";
  // An edit belongs to the chat it was started in, so switching chats drops it.
  if (ctx.editing && ctx.editing.chatId !== chat?.id) ctx.editing = null;
  const notes = chat?.sceneLog ?? [];
  const noun = notes.length === 1 ? "note" : "notes";
  const tokens = sceneLogTokens(notes).toLocaleString("en-US");
  count.textContent = `${notes.length} ${noun}, about ${tokens} tokens (approximate)`;
  addButton.disabled = !chat?.video || ctx.editing !== null;
  condenseButton.disabled = notes.length < 2 || ctx.task.running();
  const shown = ctx.preview?.chatId === chat?.id ? ctx.preview : null;
  preview.hidden = shown === null;
  previewList.replaceChildren(...(shown?.notes ?? []).map((note) => previewItem(note)));
  // Rebuilding the list mid-edit would throw away what is being typed.
  if (ctx.editing === null) renderList(ctx);
}

function renderList(ctx: SceneLogContext): void {
  const notes = ctx.state.currentChat?.sceneLog ?? [];
  const items = byTime(notes).map((note) =>
    ctx.editing?.note === note ? editItem(ctx, note) : noteItem(ctx, note),
  );
  if (ctx.editing?.note === "new") items.push(editItem(ctx, null));
  ctx.els.list.replaceChildren(...items);
  ctx.els.empty.hidden = notes.length > 0 || ctx.editing !== null;
  ctx.els.list.querySelector<HTMLInputElement>(".is-editing .note-text-input")?.focus();
}

function previewItem(note: SceneNote): HTMLLIElement {
  const item = document.createElement("li");
  const time = document.createElement("span");
  time.className = "note-time";
  time.textContent = `[${formatTimestamp(note.timeSeconds)}]`;
  const text = document.createElement("span");
  text.textContent = ` ${note.text}`;
  item.append(time, text);
  return item;
}

function noteItem(ctx: SceneLogContext, note: SceneNote): HTMLLIElement {
  const item = document.createElement("li");
  const seconds = note.timeSeconds;
  const time = seekButton(seconds, (at) => ctx.deps.seek(at), `[${formatTimestamp(seconds)}]`);
  const text = document.createElement("span");
  text.textContent = ` ${note.text}`;
  const edit = smallButton("note-edit", "Edit", () => {
    const chat = ctx.state.currentChat;
    if (ctx.editing !== null || !chat) return;
    ctx.editing = { chatId: chat.id, note };
    render(ctx);
    renderList(ctx);
  });
  const remove = iconButton("note-delete", "Delete this note", "×", () => removeNote(ctx, note));
  item.append(time, text, edit, remove);
  return item;
}

function textInput(className: string, value: string, label: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = className;
  input.value = value;
  input.setAttribute("aria-label", label);
  return input;
}

function editItem(ctx: SceneLogContext, note: SceneNote | null): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "is-editing";
  const seconds = note?.timeSeconds ?? ctx.draftTime;
  const time = textInput("note-time-input", formatTimestamp(seconds), "Note time");
  const text = textInput("timeline-input note-text-input", note?.text ?? "", "Note text");
  const save = () => {
    const parsed = parseTimestamp(time.value);
    const value = text.value.trim();
    time.setAttribute("aria-invalid", String(parsed === undefined));
    text.setAttribute("aria-invalid", String(value === ""));
    if (parsed === undefined || value === "") return;
    const duration = ctx.state.currentChat?.video?.durationSeconds ?? Infinity;
    finishEdit(ctx, { timeSeconds: Math.min(Math.max(0, parsed), duration), text: value });
  };
  for (const input of [time, text]) {
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") save();
      if (event.key !== "Escape") return;
      event.preventDefault();
      finishEdit(ctx, null);
    });
  }
  const buttons = [
    smallButton("note-edit", "Save", save),
    smallButton("note-edit", "Cancel", () => finishEdit(ctx, null)),
  ];
  item.append(time, text, ...buttons);
  return item;
}
