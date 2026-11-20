import { CLOCK_TIME, clockSeconds, formatTimestamp, sceneLogLines } from "../time";
import type { Chat, ChatMessage, SceneNote, StorySoFar } from "../types";
import { storyCut } from "./history";
import { streamReply, textRequest, type ModelCallDeps } from "./modelCall";

// The UI still imports ModelCallDeps from here.
export type { ModelCallDeps } from "./modelCall";

const SUMMARIZE_ABOVE_SHARE = 0.6;
const FALLBACK_CONTEXT_TOKENS = 32_768;
const DEFAULT_KEEP_TURNS = 4;

export const STORY_SYSTEM_PROMPT = [
  "You keep the running summary of a conversation about a video, so it can continue once older messages are dropped.",
  "Fold the previous summary, if any, and the new messages into one updated summary. Cover:",
  "- what was discussed and decided;",
  "- what the video showed, with [m:ss] video timestamps where they are known;",
  "- the current state of the conversation;",
  "- open questions;",
  "- the user's stated preferences.",
  "Mention people or characters only when they appear in the video or the conversation.",
  "Write plain prose, under 400 words, with no headings and no preamble.",
].join("\n");

export const CONDENSE_SYSTEM_PROMPT = [
  "You tidy the scene log of a video: timestamped observations recorded while watching it.",
  "Merge notes that describe the same moment or event, drop duplicates, and keep every distinct fact.",
  "Output only lines of the form [m:ss] text, one note per line, in time order, with no other text.",
].join("\n");

export function shouldSummarize(estimatedTokens: number, contextTokens?: number): boolean {
  return estimatedTokens > (contextTokens ?? FALLBACK_CONTEXT_TOKENS) * SUMMARIZE_ABOVE_SHARE;
}

export interface SummaryInput {
  chat: Chat;
  messages: readonly ChatMessage[];
  keepTurns?: number;
}

export interface SummaryDeps extends ModelCallDeps {
  now?: () => number;
}

export async function summarizeStory(
  deps: SummaryDeps,
  input: SummaryInput,
): Promise<StorySoFar | undefined> {
  const folded = messagesToFold(input);
  const last = folded.at(-1);
  const transcript = transcriptOf(folded, input.chat);
  if (last === undefined || transcript === "") return undefined;
  const previous = input.chat.storySoFar?.text.trim();
  const sections = [
    ...(previous ? [`Summary so far:\n${previous}`] : []),
    `New messages:\n${transcript}`,
  ];
  const request = textRequest(deps, [
    { role: "system", content: STORY_SYSTEM_PROMPT },
    { role: "user", content: sections.join("\n\n") },
  ]);
  const text = await streamReply(deps, request);
  if (text === "") throw new Error("The model returned an empty summary.");
  return {
    text,
    throughMessageId: last.id,
    throughCreatedAt: last.createdAt,
    updatedAt: (deps.now ?? Date.now)(),
  };
}

function messagesToFold({ chat, messages, keepTurns }: SummaryInput): readonly ChatMessage[] {
  const start = storyCut(chat.storySoFar, messages) ?? 0;
  const turnStarts = messages.flatMap((message, index) =>
    message.role === "user" && message.continuation === undefined ? [index] : [],
  );
  const keep = keepTurns ?? DEFAULT_KEEP_TURNS;
  const end = keep <= 0 ? messages.length : turnStarts[turnStarts.length - keep];
  return end === undefined || end <= start ? [] : messages.slice(start, end);
}

function transcriptOf(messages: readonly ChatMessage[], chat: Chat): string {
  const user = chat.settings.userName ?? "User";
  const assistant = chat.settings.characterName ?? "Assistant";
  return messages
    .flatMap((message) => {
      const text = message.text.trim();
      if (text === "") return [];
      switch (message.role) {
        case "user":
          return [`${user}: ${text}`];
        case "assistant":
          return [`${assistant}: ${text}`];
        case "tool":
          return [`Tool result: ${text}`];
      }
    })
    .join("\n\n");
}

export async function condenseSceneLog(
  deps: ModelCallDeps,
  notes: readonly SceneNote[],
  durationSeconds: number,
): Promise<SceneNote[]> {
  const sorted = [...notes].sort((a, b) => a.timeSeconds - b.timeSeconds);
  if (sorted.length < 2) return sorted;
  const request = textRequest(deps, [
    { role: "system", content: CONDENSE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `The video is ${formatTimestamp(durationSeconds)} long. Scene log:\n${sceneLogLines(sorted).join("\n")}`,
    },
  ]);
  const condensed = parseSceneNotes(await streamReply(deps, request), durationSeconds);
  return condensed.length > 0 ? condensed : sorted;
}

const NOTE_LINE = new RegExp(
  String.raw`^\s*(?:[-*•]\s*)?\[?\s*${CLOCK_TIME}\s*\]?\s*[:–—-]?\s*(.*)$`,
);

export function parseSceneNotes(reply: string, durationSeconds: number): SceneNote[] {
  const notes: SceneNote[] = [];
  for (const line of reply.split(/\r?\n/)) {
    const match = NOTE_LINE.exec(line);
    const text = match?.[4]?.trim();
    if (match === null || text === undefined || text === "") continue;
    const seconds = clockSeconds(match.slice(1, 4));
    notes.push({ timeSeconds: Math.min(Math.max(0, seconds), durationSeconds), text });
  }
  return notes.sort((a, b) => a.timeSeconds - b.timeSeconds);
}
