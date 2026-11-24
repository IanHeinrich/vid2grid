import { isAbortError } from "../abort";
import { inTimeOrder, lookAt, lookBatches, storedImages, type Looker } from "../chat/looking";
import { seenNotes } from "../chat/seen";
import { imagesOf, recallName } from "../imageRefs";
import { errorText, plural } from "../text";
import type { ChatMessage, ImageRef, ToolResult } from "../types";
import { findRecalled } from "./recallTool";
import { failure, namesArg, textArg, type Args } from "./toolArgs";

export interface AskContext {
  looker: Looker;
  // The conversation so far, whose images are found by name and whose answers are built on.
  messages(): readonly ChatMessage[];
  signal: AbortSignal;
}

interface FoundPictures {
  images: ImageRef[];
  notes: string[];
  problems: string[];
}

function findPictures(messages: readonly ChatMessage[], names: readonly string[]): FoundPictures {
  const known = messages.flatMap(imagesOf);
  const found = new Map<string, ImageRef>();
  const notes: string[] = [];
  const problems: string[] = [];
  for (const name of names) {
    const match = findRecalled(known, name);
    if ("problem" in match) {
      problems.push(match.problem);
      continue;
    }
    notes.push(...match.value.notes);
    found.set(match.value.ref.id, { ...match.value.ref, pinned: false });
  }
  return { images: [...found.values()], notes, problems };
}

async function picturesToAsk(
  { looker }: AskContext,
  { images, notes, problems }: FoundPictures,
): Promise<FoundPictures> {
  const stored = await storedImages(looker.store, images);
  const gone = images.filter((image) => !stored.includes(image));
  const [fitting = []] = lookBatches(looker, stored);
  const left = stored.length - fitting.length;
  return {
    images: inTimeOrder(fitting),
    notes,
    problems: [
      ...problems,
      ...gone.map((image) => `${recallName(image)} is no longer stored.`),
      ...(left > 0
        ? [
            `Only ${plural(fitting.length, "picture")} fit in one question; ask about the rest separately.`,
          ]
        : []),
    ],
  };
}

// The answer comes as text, with its pictures attached as already looked at.
export async function runAsk(ctx: AskContext, args: Args): Promise<ToolResult> {
  const question = textArg(args, "question");
  if ("problem" in question) return failure(question.problem);
  const names = namesArg(args, "pictures");
  if ("problem" in names) return failure(names.problem);
  try {
    const messages = ctx.messages();
    const { images, notes, problems } = await picturesToAsk(
      ctx,
      findPictures(messages, names.value),
    );
    if (images.length === 0) return failure(problems.join(" "));
    const note = await lookAt(ctx.looker, {
      kind: "answered",
      images,
      question: question.value,
      earlier: messages.flatMap(seenNotes),
      signal: ctx.signal,
    });
    const about = `About ${images.map(recallName).join(", ")}:`;
    const errors = problems.map((problem) => `Error: ${problem}`);
    return { text: [about, note.text, ...notes, ...errors].join("\n"), images, seen: [note] };
  } catch (error) {
    // A stopped question is dropped with the turn's other calls.
    return failure(isAbortError(error) ? "The question was stopped." : errorText(error));
  }
}
