import { imageLabel, imagesOf, recallName } from "../imageRefs";
import { plural } from "../text";
import type { Chat, ChatMessage, ImageRef, SeenNote, ToolMessage, UserMessage } from "../types";

export type PictureMessage = UserMessage | ToolMessage;

export function lookingModelId(chat: Pick<Chat, "settings"> | null): string | undefined {
  return chat?.settings.lookingModelId || undefined;
}

export function seenNotes(message: ChatMessage): readonly SeenNote[] {
  return message.role === "assistant" ? [] : (message.seen ?? []);
}

// Replies kept as swipes are read too, so writing one again can reuse what was seen for it.
export function everyNote(messages: readonly ChatMessage[]): SeenNote[] {
  return messages.flatMap((message) => [
    ...(message.role === "user"
      ? (message.alternates ?? []).flatMap((reply) => everyNote(reply.messages))
      : []),
    ...seenNotes(message),
  ]);
}

// A copy held by the page can be older than what was saved of its pictures since.
export function withCurrentSeen<T extends ChatMessage>(
  message: T,
  messages: readonly ChatMessage[],
): T {
  const current = messages.find((entry) => entry.id === message.id);
  if (!current || current.role === "assistant") return message;
  const { seen, lookAgain } = current;
  const updated: T & Pick<PictureMessage, "seen" | "lookAgain"> = { ...message };
  delete updated.seen;
  delete updated.lookAgain;
  return { ...updated, ...(seen ? { seen } : {}), ...(lookAgain ? { lookAgain } : {}) };
}

const NONE: ReadonlySet<string> = new Set();

// Its mark goes once each picture has words again, or is gone and cannot have any.
export function withSeen(
  message: ChatMessage,
  seen: readonly SeenNote[],
  gone: ReadonlySet<string> = NONE,
): ChatMessage {
  if (message.role === "assistant") return message;
  const updated = { ...message, seen: [...seen] };
  if (unseenImages(updated).every((image) => gone.has(image.id))) delete updated.lookAgain;
  return updated;
}

function marked(message: ChatMessage): string[] {
  if (message.role === "assistant") return [];
  const own = message.lookAgain ? unseenImages(message).map((image) => image.id) : [];
  const swipes = message.role === "user" ? (message.alternates ?? []) : [];
  return [...own, ...swipes.flatMap((reply) => reply.messages.flatMap(marked))];
}

// Pictures whose description was dropped, wherever they are.
export function toLookAgain(messages: readonly ChatMessage[]): Set<string> {
  return new Set(messages.flatMap(marked));
}

// A reply kept as a swipe is not looked at again itself, so its mark goes with the pictures.
export function withoutSwipeMarks(
  message: ChatMessage,
  described: ReadonlySet<string>,
): ChatMessage {
  if (message.role !== "user" || !message.alternates) return message;
  let changed = false;
  const alternates = message.alternates.map((reply) => ({
    ...reply,
    messages: reply.messages.map((entry) => {
      if (entry.role !== "tool" || !entry.lookAgain) return entry;
      if (!unseenImages(entry).every((image) => described.has(image.id))) return entry;
      changed = true;
      const cleared = { ...entry };
      delete cleared.lookAgain;
      return cleared;
    }),
  }));
  return changed ? { ...message, alternates } : message;
}

// Described afresh by the next reply, whatever is known of the same pictures elsewhere.
export function withoutDescription(message: PictureMessage, note: SeenNote): PictureMessage {
  const key = JSON.stringify(note);
  const seen = seenNotes(message).filter((entry) => JSON.stringify(entry) !== key);
  return { ...message, seen, lookAgain: true };
}

export function describedIds(notes: readonly SeenNote[]): Set<string> {
  return new Set(notes.filter(({ kind }) => kind === "described").flatMap((note) => note.imageIds));
}

export function isAbout(note: SeenNote, ids: ReadonlySet<string>): boolean {
  return note.imageIds.some((id) => ids.has(id));
}

// An ask has been answered about its reply's pictures, but an answer to a user's message describes
// none of the message's own.
export function unseenImages(message: PictureMessage): ImageRef[] {
  const notes = seenNotes(message).filter(
    ({ kind }) => message.role === "tool" || kind === "described",
  );
  const seen = new Set(notes.flatMap((note) => note.imageIds));
  return distinctImages(message.images.filter((image) => !seen.has(image.id)));
}

export function distinctImages(images: readonly ImageRef[]): ImageRef[] {
  return [...new Map(images.map((image) => [image.id, image])).values()];
}

// An answer to the message as it was before an edit no longer belongs to it.
export function answersText(note: SeenNote, message: UserMessage): boolean {
  return note.question === message.text;
}

export interface SeenContext {
  // Every image of the conversation, by id, for the names of those an answer is about.
  images: ReadonlyMap<string, ImageRef>;
  canAsk: boolean;
}

export function imagesById(messages: readonly ChatMessage[]): Map<string, ImageRef> {
  return new Map(messages.flatMap(imagesOf).map((image) => [image.id, image]));
}

export function notSeenStub(image: ImageRef, canAsk: boolean): string {
  const next = canAsk
    ? `; call ask with "${recallName(image)}" among its pictures to find out what it shows.`
    : ".";
  return `[${imageLabel(image)}. Not looked at yet${next}]`;
}

const APP_NOTE = "Note from the app, not written by the user";
const APP_NOTE_END = "[End of the app's note.]";

function describedBlock(note: SeenNote, message: PictureMessage): string {
  const about = new Set(note.imageIds);
  const labels = distinctImages(message.images)
    .filter((image) => about.has(image.id))
    .map((image) => `[${imageLabel(image)}]`);
  const heading = `[${APP_NOTE}: what the looking model saw in the pictures named here.]`;
  return [heading, ...labels, note.text, APP_NOTE_END].join("\n");
}

function answerBlock(note: SeenNote, { images }: SeenContext): string {
  const names = note.imageIds.flatMap((id) => {
    const image = images.get(id);
    return image ? [recallName(image)] : [];
  });
  const about =
    names.length > 0 ? names.join(", ") : plural(note.imageIds.length, "earlier picture");
  const heading = `[${APP_NOTE}: the looking model was asked the message above about ${about}, and answered this.]`;
  return [heading, note.text, APP_NOTE_END].join("\n");
}

// What stands in for a message's images in the writer's request, after the message's own text.
export function seenText(message: PictureMessage, context: SeenContext): string {
  const notes = seenNotes(message);
  const here = new Set(message.images.map((image) => image.id));
  const described = notes.filter((note) => note.kind === "described" && isAbout(note, here));
  const answered =
    message.role === "user"
      ? notes.filter((note) => note.kind === "answered" && answersText(note, message))
      : [];
  const blocks = [
    message.text,
    ...described.map((note) => describedBlock(note, message)),
    ...unseenImages(message).map((image) => notSeenStub(image, context.canAsk)),
    ...answered.map((note) => answerBlock(note, context)),
  ];
  return blocks.filter((block) => block !== "").join("\n\n");
}

// The images a story carries past its cut come without the messages that described them.
export function withSeenNotes(message: UserMessage, messages: readonly ChatMessage[]): UserMessage {
  const left = new Set(message.images.map((image) => image.id));
  const seen: SeenNote[] = [];
  for (const note of messages.flatMap(seenNotes)) {
    if (note.kind !== "described" || !isAbout(note, left)) continue;
    seen.push(note);
    for (const id of note.imageIds) left.delete(id);
  }
  return seen.length === 0 ? message : { ...message, seen };
}
