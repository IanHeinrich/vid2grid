import { answersText, seenNotes } from "../../chat/seen";
import { plural } from "../../text";
import type { SeenNote, UserMessage } from "../../types";
import { smallButton } from "../shared/buttons";
import { renderMarkdownInto, type MarkdownOptions } from "./markdown";

export interface SeenRender {
  name(modelId: string): string;
  options: MarkdownOptions;
  // Absent with no looking model on, when nothing would look again.
  onLookAgain?: (messageId: string, note: SeenNote) => void;
  running?: boolean;
}

// What the writer is told with the message: an answer to it as it was before an edit is not.
export function userNotes(user: UserMessage | undefined): SeenNote[] {
  if (!user) return [];
  return seenNotes(user).filter((note) => note.kind === "described" || answersText(note, user));
}

export function picturesSeen(notes: readonly SeenNote[]): number {
  return new Set(notes.flatMap((note) => note.imageIds)).size;
}

export function seenText(note: SeenNote, { options }: SeenRender): HTMLElement {
  const text = document.createElement("div");
  text.className = "seen-text";
  renderMarkdownInto(text, note.text, options);
  return text;
}

function lookAgainButton(
  messageId: string,
  note: SeenNote,
  { onLookAgain, running }: SeenRender,
): HTMLElement[] {
  if (!onLookAgain || note.kind !== "described") return [];
  const button = smallButton("message-action look-again", "Look again", () =>
    onLookAgain(messageId, note),
  );
  button.title = "Drop this description; the next reply has the pictures described again";
  button.disabled = running === true;
  return [button];
}

// With a message, each description in it can be dropped.
export function seenDetails(
  label: string,
  notes: readonly SeenNote[],
  render: SeenRender,
  messageId?: string,
): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "seen-details";
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary);
  for (const note of notes) {
    details.append(seenText(note, render));
    if (messageId !== undefined) details.append(...lookAgainButton(messageId, note, render));
  }
  return details;
}

export function lookedLabel({ kind, imageIds, modelId }: SeenNote, render: SeenRender): string {
  const pictures = plural(imageIds.length, "picture");
  const name = render.name(modelId);
  return kind === "described"
    ? `Looked at ${pictures} with ${name}`
    : `Asked ${name} about ${pictures}`;
}

function lookAgainNote(): HTMLElement {
  const note = document.createElement("p");
  note.className = "seen-pending";
  note.textContent = "Its pictures will be looked at again for the next reply.";
  return note;
}

// On a user message: one disclosure per kind, so the usual case is a single line.
export function userSeenDetails(user: UserMessage, render: SeenRender): HTMLElement[] {
  const notes = userNotes(user);
  const described = notes.filter(({ kind }) => kind === "described");
  const answered = notes.filter(({ kind }) => kind === "answered");
  const names = (from: readonly SeenNote[]) =>
    [...new Set(from.map(({ modelId }) => render.name(modelId)))].join(", ");
  const pictures = plural(picturesSeen(described), "picture");
  return [
    ...(described.length > 0
      ? [seenDetails(`${pictures} described by ${names(described)}`, described, render, user.id)]
      : []),
    ...(user.lookAgain && render.onLookAgain ? [lookAgainNote()] : []),
    ...(answered.length > 0
      ? [seenDetails(`Answered from earlier pictures by ${names(answered)}`, answered, render)]
      : []),
  ];
}
