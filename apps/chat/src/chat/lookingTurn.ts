import { imagesOf } from "../imageRefs";
import type { ChatMessage, ImageRef, SeenNote, ToolMessage, UserMessage } from "../types";
import type { Turn, TurnLooking } from "./agentLoop";
import { currentTurn, latestOverview, newestUserMessage } from "./imageSelection";
import { inTimeOrder, lookAt, lookBatches, storedImages, type LookRequest } from "./looking";
import {
  answersText,
  describedIds,
  everyNote,
  distinctImages,
  isAbout,
  seenNotes,
  toLookAgain,
  unseenImages,
  withoutSwipeMarks,
  withSeen,
  type PictureMessage,
} from "./seen";

// Everything the writer is about to read has been looked at first. Answer now skips what is left.
export async function lookBeforeRound(turn: Turn): Promise<void> {
  const { looking, answerNow } = turn.deps;
  if (!looking || answerNow?.aborted) return;
  try {
    for (const { id } of toDescribe(turn)) await describeNewImages(turn, id);
    if (!canAsk(turn)) await askForWriter(turn);
  } catch (error) {
    if (answerNow?.aborted && !turn.deps.signal.aborted) return;
    throw error;
  }
}

function toDescribe({ messages }: Turn): ChatMessage[] {
  const current = new Set(currentTurn(messages));
  return messages.filter(
    (message) => current.has(message) || (message.role !== "assistant" && message.lookAgain),
  );
}

export function canAsk({ deps, toolsRefused }: Turn): boolean {
  return deps.runTool !== undefined && !toolsRefused && deps.model.tools && deps.tools.length > 0;
}

function lookSignal({ deps }: Turn): AbortSignal {
  return deps.answerNow ? AbortSignal.any([deps.signal, deps.answerNow]) : deps.signal;
}

function pictureMessage(turn: Turn, id: string): PictureMessage | undefined {
  const message = turn.messages.find((entry) => entry.id === id);
  return message === undefined || message.role === "assistant" ? undefined : message;
}

async function saveNotes(
  turn: Turn,
  id: string,
  seen: readonly SeenNote[],
  gone: ReadonlySet<string> = new Set(),
): Promise<void> {
  const described = describedIds(seen);
  turn.messages = turn.messages.map((message) =>
    withoutSwipeMarks(message.id === id ? withSeen(message, seen, gone) : message, described),
  );
  await turn.deps.looking?.save(id, seen, gone);
  turn.deps.onEvent({ type: "looked", messageId: id, seen });
}

async function look(
  turn: Turn,
  request: Omit<LookRequest, "signal">,
): Promise<SeenNote | undefined> {
  const { looking } = turn.deps;
  if (!looking) return undefined;
  lookSignal(turn).throwIfAborted();
  const { images } = request;
  turn.deps.onEvent({ type: "lookStart", images: images.length, modelId: looking.model.id });
  turn.imagesSent += images.length;
  return lookAt(looking, { ...request, signal: lookSignal(turn) });
}

async function describeNewImages(turn: Turn, id: string): Promise<void> {
  const { looking } = turn.deps;
  const message = pictureMessage(turn, id);
  if (!looking || !message || unseenImages(message).length === 0) return;
  const reused = reusedNotes(turn, message);
  if (reused.length > 0) await saveNotes(turn, id, [...seenNotes(message), ...reused]);
  const left = unseenImages(pictureMessage(turn, id) ?? message);
  const images = inTimeOrder(await storedImages(looking.store, left));
  const gone = new Set(left.filter((image) => !images.includes(image)).map((image) => image.id));
  if (message.lookAgain && images.length === 0) await saveNotes(turn, id, notesOf(turn, id), gone);
  const question = callQuestion(turn, message) ?? askedWith(turn, message);
  for (const batch of lookBatches(looking, images)) {
    const note = await look(turn, { kind: "described", images: batch, question });
    if (note) await saveNotes(turn, id, [...notesOf(turn, id), note], gone);
  }
}

function notesOf(turn: Turn, id: string): readonly SeenNote[] {
  const message = pictureMessage(turn, id);
  return message ? seenNotes(message) : [];
}

// The user's message that the pictures came with or were looked up for.
function askedWith({ messages }: Turn, message: PictureMessage): string {
  const at = messages.findIndex((entry) => entry.id === message.id);
  const started = currentTurn(messages.slice(0, at + 1))[0];
  return started?.role === "user" ? started.text : "";
}

// A look, frames or zoom call may say what to pay attention to.
function callQuestion(turn: Turn, message: PictureMessage): string | undefined {
  if (message.role !== "tool") return undefined;
  // Servers reuse call ids from round to round, so the call is the nearest one before the reply.
  const at = turn.messages.findIndex((entry) => entry.id === message.id);
  for (const entry of turn.messages.slice(0, at).reverse()) {
    if (entry.role !== "assistant") continue;
    const call = entry.toolCalls.find(({ id }) => id === message.toolCallId);
    if (call) return questionIn(call.arguments);
  }
  return undefined;
}

function questionIn(argumentsText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (typeof parsed !== "object" || parsed === null || !("question" in parsed)) return undefined;
    const { question } = parsed;
    return typeof question === "string" && question.trim() !== "" ? question : undefined;
  } catch {
    return undefined;
  }
}

// What was already said of the same images, unless the call asks something new about them.
function reusedNotes(turn: Turn, message: PictureMessage): SeenNote[] {
  const question = callQuestion(turn, message);
  const again = toLookAgain(turn.messages);
  const ids = unseenImages(message).map((image) => image.id);
  const left = new Set(ids.filter((id) => !again.has(id)));
  const known = everyNote(turn.messages).filter(
    (note) => note.kind === "described" && (question === undefined || note.question === question),
  );
  const reused: SeenNote[] = [];
  for (const note of known.reverse()) {
    if (!isAbout(note, left)) continue;
    reused.push(copyOf(note, left));
    for (const id of note.imageIds) left.delete(id);
  }
  return reused;
}

function copyOf(note: SeenNote, ids: ReadonlySet<string>): SeenNote {
  const copy = { ...note, imageIds: note.imageIds.filter((id) => ids.has(id)) };
  delete copy.usage;
  return copy;
}

function hasAnswer(user: UserMessage): boolean {
  return seenNotes(user).some((note) => answersText(note, user));
}

// A writer with no tools cannot ask, so the user's message is asked for it about the newest images.
async function askForWriter(turn: Turn): Promise<void> {
  const { looking } = turn.deps;
  const user = newestUserMessage(turn.messages);
  if (!looking || !user || user.continuation || user.text.trim() === "" || hasAnswer(user)) return;
  const images = inTimeOrder(await imagesForWriter(turn, looking));
  if (images.length === 0) return;
  const note = await look(turn, {
    kind: "answered",
    images,
    question: user.text,
    earlier: turn.messages.flatMap(seenNotes),
  });
  const kept = notesOf(turn, user.id).filter(({ kind }) => kind === "described");
  if (note) await saveNotes(turn, user.id, [...kept, note]);
}

// What fits one request, most wanted first: this turn's, pinned ones, the overview, then the newest.
async function imagesForWriter({ messages }: Turn, looking: TurnLooking): Promise<ImageRef[]> {
  const all = messages.flatMap(imagesOf);
  const wanted = distinctImages([
    ...currentTurn(messages).flatMap(imagesOf),
    ...all.filter((image) => image.pinned),
    ...latestOverview(messages),
    ...all.reverse(),
  ]);
  return lookBatches(looking, await storedImages(looking.store, wanted))[0] ?? [];
}

export function imagesLookedAt(message: ToolMessage): number {
  return new Set((message.seen ?? []).flatMap((note) => note.imageIds)).size;
}
