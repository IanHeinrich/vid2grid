import { streamReply, textRequest, type ModelCallDeps } from "../api/modelCall";
import { clamp } from "../spans";
import { CLOCK_TIME, clockSeconds, formatTimestamp } from "../time";
import type { CastCard, ContentPart, SceneNote } from "../types";
import { sceneLogLines } from "./prompts";

export const CAST_SYSTEM_PROMPT = [
  "You list the people or characters in a video from contact sheets of its frames and a log of what happens.",
  'Name each one once. Use their name if the video or log gives it, otherwise a short label such as "Woman in red coat".',
  "Output only lines of the form Name | short visual description | first seen m:ss, one per line, with no other text.",
].join("\n");

export interface CastDeps extends ModelCallDeps {
  newId?: () => string;
}

export interface CastInput {
  // Data URLs of the overview sheets.
  overview: readonly string[];
  sceneLog: readonly SceneNote[];
  durationSeconds: number;
}

export async function suggestCast(deps: CastDeps, input: CastInput): Promise<CastCard[]> {
  if (input.overview.length === 0 && input.sceneLog.length === 0) return [];
  const notes = sceneLogLines(input.sceneLog);
  const text = [
    `The video is ${formatTimestamp(input.durationSeconds)} long.`,
    ...(notes.length > 0 ? [`Scene log:\n${notes.join("\n")}`] : []),
  ].join("\n\n");
  const content: ContentPart[] = [
    { type: "text", text },
    ...input.overview.map((url): ContentPart => ({ type: "image_url", image_url: { url } })),
  ];
  const request = textRequest(deps, [
    { role: "system", content: CAST_SYSTEM_PROMPT },
    { role: "user", content },
  ]);
  const reply = await streamReply(deps, request);
  return parseCast(reply, input.durationSeconds, deps.newId ?? (() => crypto.randomUUID()));
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s*/;
const SEEN = new RegExp(CLOCK_TIME);

function cleanName(text: string): string {
  return text.replace(BULLET, "").replace(/\*\*/g, "").trim();
}

function seenSeconds(text: string | undefined, durationSeconds: number): number | undefined {
  const match = text === undefined ? null : SEEN.exec(text);
  if (match === null) return undefined;
  return clamp(clockSeconds(match.slice(1)), 0, durationSeconds);
}

export function parseCast(reply: string, durationSeconds: number, newId: () => string): CastCard[] {
  const cards: CastCard[] = [];
  for (const line of reply.split(/\r?\n/)) {
    const [rawName, rawDescription, rawSeen] = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|");
    const name = cleanName(rawName ?? "");
    if (rawDescription === undefined || name === "" || /^name$/i.test(name)) continue;
    if (/^[-:\s]+$/.test(rawDescription)) continue;
    const firstSeenSeconds = seenSeconds(rawSeen, durationSeconds);
    cards.push({
      id: newId(),
      name,
      description: rawDescription.trim(),
      ...(firstSeenSeconds === undefined ? {} : { firstSeenSeconds }),
    });
  }
  return mergeCast([], cards);
}

function nameKey(card: CastCard): string {
  return card.name.trim().toLowerCase();
}

// Existing cards may hold the user's edits, so a suggestion only adds a name not already there.
export function mergeCast(
  existing: readonly CastCard[],
  suggested: readonly CastCard[],
): CastCard[] {
  const names = new Set(existing.map(nameKey));
  const added = suggested.filter((card) => {
    const key = nameKey(card);
    if (key === "" || names.has(key)) return false;
    names.add(key);
    return true;
  });
  return [...existing, ...added];
}
