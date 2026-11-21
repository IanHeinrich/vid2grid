import { mergeCast, suggestCast } from "../chat/cast";
import { blobToDataUrl } from "../chat/dataUrl";
import { latestOverview } from "../chat/history";
import type { AppElements } from "../dom";
import { chatModelId, currentPending, type AppState } from "../state";
import { errorText } from "../text";
import { formatTimestamp, parseTimestamp } from "../time";
import type {
  CastCard,
  ChatStore,
  ImageRef,
  StreamChat,
  VideoAttachment,
  VideoCast,
} from "../types";
import { iconButton, seekButton, smallButton } from "./buttons";
import type { ChatVideo } from "./knowledgeVideos";
import { createModelTask, modelCallDeps, type ModelTask } from "./modelTask";
import type { Toast, ToastHandle } from "./toast";

export interface CastPanel {
  render(): void;
}

export interface CastPanelDeps {
  store: ChatStore;
  toast: Toast;
  streamChat: StreamChat;
  // Given a video, plays that one rather than the attached video.
  seek(seconds: number, video?: VideoAttachment): void;
  onChanged(): void;
  shownVideo?: () => ChatVideo | undefined;
  toDataUrl?: (blob: Blob) => Promise<string>;
  newId?: () => string;
  now?: () => number;
}

interface CastContext {
  els: AppElements["cast"];
  state: AppState;
  deps: CastPanelDeps;
  task: ModelTask;
  casts: Map<string, VideoCast>;
  loaded: Set<string>;
  editing: CardEdit | null;
  pendingUndo: PendingUndo | null;
}

interface PendingUndo {
  fileKey: string;
  toast: ToastHandle;
}

interface CardEdit {
  fileKey: string;
  // The id of the card being edited, or "new" for one being added.
  id: string;
}

const NEW_CARD = "new";

// Before the first message is sent the overview is still a pending attachment.
export function overviewRefs(state: AppState): ImageRef[] {
  const sent = latestOverview(state.messages);
  if (sent.length > 0) return sent;
  const pending = currentPending(state).find((attachment) => attachment.kind === "overview");
  return pending?.kind === "overview" ? pending.refs : [];
}

export function initCastPanel(
  els: Pick<AppElements, "cast">,
  state: AppState,
  deps: CastPanelDeps,
): CastPanel {
  const ctx: CastContext = {
    els: els.cast,
    state,
    deps,
    task: createModelTask(
      els.cast,
      () => render(ctx),
      () => state.currentChat?.id,
    ),
    casts: new Map(),
    loaded: new Set(),
    editing: null,
    pendingUndo: null,
  };
  listen(ctx);
  render(ctx);
  return { render: () => render(ctx) };
}

function listen(ctx: CastContext): void {
  ctx.els.addButton.addEventListener("click", () => startEdit(ctx, NEW_CARD));
  ctx.els.suggestButton.addEventListener("click", () => {
    void suggest(ctx);
  });
}

function now(ctx: CastContext): number {
  return (ctx.deps.now ?? Date.now)();
}

function seekShown(ctx: CastContext, seconds: number): void {
  const shown = shownVideo(ctx);
  if (!shown || shown.current) ctx.deps.seek(seconds);
  else ctx.deps.seek(seconds, shown.video);
}

function shownVideo(ctx: CastContext): ChatVideo | undefined {
  if (ctx.deps.shownVideo) return ctx.deps.shownVideo();
  const video = ctx.state.currentChat?.video;
  return video && { video, current: true };
}

// Only the attached video's people can be changed; an older video's are shown as saved.
function editableKey(ctx: CastContext): string | undefined {
  const shown = shownVideo(ctx);
  return shown?.current === true ? shown.video.fileKey : undefined;
}

function cardsFor(ctx: CastContext, key: string): CastCard[] {
  return ctx.casts.get(key)?.cards ?? [];
}

function ensureLoaded(ctx: CastContext, key: string): void {
  if (ctx.loaded.has(key)) return;
  ctx.loaded.add(key);
  ctx.deps.store
    .getCast(key)
    .then((cast) => {
      if (cast && !ctx.casts.has(key)) ctx.casts.set(key, cast);
      render(ctx);
    })
    .catch((error: unknown) => {
      ctx.task.report(`Could not load the people: ${errorText(error)}`, "error");
    });
}

function saveCast(ctx: CastContext, key: string, change: (cards: CastCard[]) => CastCard[]): void {
  const cast: VideoCast = { fileKey: key, cards: change(cardsFor(ctx, key)), updatedAt: now(ctx) };
  ctx.casts.set(key, cast);
  render(ctx);
  ctx.deps.onChanged();
  ctx.deps.store.putCast(cast).catch((error: unknown) => {
    ctx.task.report(`Could not save the people: ${errorText(error)}`, "error");
  });
}

function removeCard(ctx: CastContext, card: CastCard): void {
  const key = editableKey(ctx);
  if (key === undefined) return;
  const index = cardsFor(ctx, key).indexOf(card);
  saveCast(ctx, key, (cards) => cards.filter((entry) => entry.id !== card.id));
  const toast = ctx.deps.toast.show(`Removed ${card.name}`, {
    label: "Undo",
    run: () => {
      ctx.pendingUndo = null;
      if (editableKey(ctx) !== key) return;
      saveCast(ctx, key, (cards) =>
        cards.some((entry) => entry.id === card.id)
          ? cards
          : [...cards.slice(0, index), card, ...cards.slice(index)],
      );
    },
  });
  ctx.pendingUndo = { fileKey: key, toast };
}

// An Undo may only restore into the video it came from, while that video is still shown.
function dropStaleUndo(ctx: CastContext, key: string | undefined): void {
  if (ctx.pendingUndo === null || ctx.pendingUndo.fileKey === key) return;
  ctx.pendingUndo.toast.dismiss();
  ctx.pendingUndo = null;
}

function startEdit(ctx: CastContext, id: string): void {
  const fileKey = editableKey(ctx);
  if (ctx.editing !== null || fileKey === undefined) return;
  ctx.editing = { fileKey, id };
  render(ctx);
  renderList(ctx);
}

function finishEdit(ctx: CastContext, saved: CastCard | null): void {
  const editing = ctx.editing;
  ctx.editing = null;
  render(ctx);
  // The rebuilt list dropped the focused control; leaving focus on the body escapes the drawer.
  ctx.els.addButton.focus();
  if (!saved || editing === null) return;
  saveCast(ctx, editing.fileKey, (cards) =>
    cards.some((card) => card.id === saved.id)
      ? cards.map((card) => (card.id === saved.id ? saved : card))
      : [...cards, saved],
  );
}

async function overviewUrls(ctx: CastContext): Promise<string[]> {
  const blobs = await Promise.all(
    overviewRefs(ctx.state).map((ref) => ctx.deps.store.getImage(ref.id)),
  );
  const toDataUrl = ctx.deps.toDataUrl ?? blobToDataUrl;
  return Promise.all(blobs.flatMap((blob) => (blob ? [toDataUrl(blob)] : [])));
}

async function suggest(ctx: CastContext): Promise<void> {
  const chat = ctx.state.currentChat;
  const video = chat?.video;
  if (!chat || !video) return;
  const suggested = await ctx.task.run("Looking for the people in the video…", async (signal) => {
    const overview = await overviewUrls(ctx);
    if (overview.length === 0 && chat.sceneLog.length === 0) {
      throw new Error("Wait for the overview to finish, or add some scene notes first.");
    }
    return suggestCast(
      {
        ...modelCallDeps(ctx.state, ctx.deps.streamChat, chatModelId(ctx.state, chat), signal),
        ...(ctx.deps.newId ? { newId: ctx.deps.newId } : {}),
      },
      { overview, sceneLog: chat.sceneLog, durationSeconds: video.durationSeconds },
    );
  });
  if (!suggested) return;
  const before = cardsFor(ctx, video.fileKey).length;
  saveCast(ctx, video.fileKey, (cards) => mergeCast(cards, suggested));
  const added = cardsFor(ctx, video.fileKey).length - before;
  ctx.task.report(
    added === 0 ? "No new names found." : `Added ${added} ${added === 1 ? "person" : "people"}.`,
  );
}

const EMPTY_CURRENT = "No one yet. Add someone or suggest from the video.";
const EMPTY_SAVED = "No people were saved for this video.";

function render(ctx: CastContext): void {
  const { title, notice, empty, list, addButton, suggestButton } = ctx.els;
  const shown = shownVideo(ctx);
  const key = shown?.video.fileKey;
  const editable = editableKey(ctx) !== undefined;
  ctx.task.sync();
  // An edit belongs to the video it was started on, so switching chats or videos drops it.
  if (ctx.editing && (ctx.editing.fileKey !== key || !editable)) ctx.editing = null;
  dropStaleUndo(ctx, editableKey(ctx));
  if (key !== undefined) ensureLoaded(ctx, key);
  const cards = key === undefined ? [] : cardsFor(ctx, key);
  title.textContent = shown ? `People in ${shown.video.name}` : "People";
  notice.hidden = key !== undefined;
  list.hidden = key === undefined;
  empty.textContent = editable ? EMPTY_CURRENT : EMPTY_SAVED;
  empty.hidden = key === undefined || cards.length > 0 || ctx.editing !== null;
  addButton.hidden = key !== undefined && !editable;
  suggestButton.hidden = addButton.hidden;
  addButton.disabled = !editable || ctx.editing !== null;
  suggestButton.disabled = !editable || ctx.task.running();
  suggestButton.title = key === undefined ? "Attach a video first" : "";
  // Rebuilding the list mid-edit would throw away what is being typed.
  if (ctx.editing === null) renderList(ctx);
}

function renderList(ctx: CastContext): void {
  const key = shownVideo(ctx)?.video.fileKey;
  const editable = editableKey(ctx) !== undefined;
  const cards = key === undefined ? [] : cardsFor(ctx, key);
  const items = cards.map((card) =>
    ctx.editing?.id === card.id ? editItem(ctx, card) : cardItem(ctx, card, editable),
  );
  if (ctx.editing?.id === NEW_CARD) items.push(editItem(ctx, null));
  ctx.els.list.replaceChildren(...items);
  ctx.els.list.querySelector<HTMLInputElement>(".cast-name-input")?.focus();
}

function cardItem(ctx: CastContext, card: CastCard, editable: boolean): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "cast-card";
  const head = document.createElement("div");
  head.className = "cast-card-head";
  const name = document.createElement("strong");
  name.className = "cast-name";
  name.textContent = card.name;
  head.append(name);
  const seen = card.firstSeenSeconds;
  if (seen !== undefined) {
    const time = seekButton(seen, (at) => seekShown(ctx, at), `[${formatTimestamp(seen)}]`);
    time.title = "First seen";
    head.append(time);
  }
  if (editable) {
    const remove = iconButton("note-delete", `Remove ${card.name}`, "×", () =>
      removeCard(ctx, card),
    );
    const edit = smallButton("note-edit", "Edit", () => startEdit(ctx, card.id));
    head.append(edit, remove);
  }
  const description = document.createElement("p");
  description.className = "cast-description";
  description.textContent = card.description;
  item.append(head, description);
  return item;
}

function labelled<T extends HTMLElement>(label: string, control: T): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const caption = document.createElement("span");
  caption.textContent = label;
  wrap.append(caption, control);
  return wrap;
}

function editItem(ctx: CastContext, card: CastCard | null): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "cast-card is-editing";
  const name = Object.assign(document.createElement("input"), {
    type: "text",
    className: "cast-name-input",
    value: card?.name ?? "",
  });
  const description = Object.assign(document.createElement("textarea"), {
    rows: 2,
    className: "cast-description-input",
    value: card?.description ?? "",
  });
  const seen = card?.firstSeenSeconds;
  const time = Object.assign(document.createElement("input"), {
    type: "text",
    className: "cast-time-input",
    value: seen === undefined ? "" : formatTimestamp(seen),
    placeholder: "m:ss",
  });
  const save = () => {
    const saved = readCard(ctx, card, name, description, time);
    if (saved) finishEdit(ctx, saved);
  };
  for (const input of [name, time]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) save();
    });
  }
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    finishEdit(ctx, null);
  });
  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  actions.append(
    smallButton("button primary", "Save", save),
    smallButton("button ghost", "Cancel", () => finishEdit(ctx, null)),
  );
  item.append(
    labelled("Name", name),
    labelled("Description", description),
    labelled("First seen", time),
    actions,
  );
  return item;
}

function readCard(
  ctx: CastContext,
  card: CastCard | null,
  name: HTMLInputElement,
  description: HTMLTextAreaElement,
  time: HTMLInputElement,
): CastCard | undefined {
  const named = name.value.trim();
  const rawTime = time.value.trim();
  const seconds = rawTime === "" ? undefined : parseTimestamp(rawTime);
  const badTime = rawTime !== "" && seconds === undefined;
  name.setAttribute("aria-invalid", String(named === ""));
  time.setAttribute("aria-invalid", String(badTime));
  if (named === "" || badTime) return undefined;
  const saved: CastCard = {
    ...(card ?? { id: (ctx.deps.newId ?? (() => crypto.randomUUID()))() }),
    name: named,
    description: description.value.trim(),
  };
  delete saved.firstSeenSeconds;
  return seconds === undefined ? saved : { ...saved, firstSeenSeconds: seconds };
}
