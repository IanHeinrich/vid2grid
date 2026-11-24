import { imageLabel, recallName, sheetLine } from "../imageRefs";
import { plural } from "../text";
import type { ImageRef, ImageStore, ToolResult } from "../types";
import { failure, imagesFollow, namesArg, type Args, type Parsed } from "./toolArgs";

export interface RecallContext {
  store: ImageStore;
  maxImages: number;
  // The conversation's images so far, found by name; absent means none.
  knownImages?: () => readonly ImageRef[];
}

function recallKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface FoundImage {
  ref: ImageRef;
  notes: string[];
}

// Most exact first: a name, a label, then a label misquoted after its name.
const FULL_NAMES: readonly ((ref: ImageRef, key: string) => boolean)[] = [
  (ref, key) => key === recallKey(recallName(ref)),
  (ref, key) => key === recallKey(imageLabel(ref)),
  (ref, key) => ref.source.kind !== "upload" && key.startsWith(`${recallKey(recallName(ref))}: `),
];

function withFullName(known: readonly ImageRef[], key: string): ImageRef[] {
  for (const matches of FULL_NAMES) {
    const found = known.filter((ref) => matches(ref, key));
    if (found.length > 0) return found;
  }
  return [];
}

function hasShortName(ref: ImageRef, key: string): boolean {
  return [ref.source.name, sheetLine(ref) ?? ""].some((name) => recallKey(name) === key);
}

// A full name picks the latest image with it; a bare sheet name must belong to one image.
export function findRecalled(known: readonly ImageRef[], name: string): Parsed<FoundImage> {
  const key = recallKey(name);
  const full = withFullName(known, key);
  const matches = full.length > 0 ? full : known.filter((ref) => hasShortName(ref, key));
  const latest = matches[matches.length - 1];
  if (latest === undefined) {
    return {
      problem: `No earlier image is named "${name}". Use a name exactly as its stub gives it.`,
    };
  }
  const distinct = new Set(matches.map((ref) => ref.id)).size;
  if (full.length === 0 && distinct > 1) {
    return {
      problem: `"${name}" names ${distinct} images. Use the full name a stub gives, such as "${recallName(latest)}".`,
    };
  }
  const shared = `${distinct} images share the name ${recallName(latest)}; this is the latest.`;
  return { value: { ref: latest, notes: distinct > 1 ? [shared] : [] } };
}

export async function runRecall(ctx: RecallContext, args: Args): Promise<ToolResult> {
  const names = namesArg(args, "names");
  if ("problem" in names) return failure(names.problem);
  const known = ctx.knownImages?.() ?? [];
  const problems: string[] = [];
  const notes: string[] = [];
  const found = new Map<string, ImageRef>();
  for (const name of names.value) {
    const match = findRecalled(known, name);
    if ("problem" in match) {
      problems.push(match.problem);
      continue;
    }
    notes.push(...match.value.notes);
    found.set(match.value.ref.id, { ...match.value.ref, pinned: false });
  }
  const stored: ImageRef[] = [];
  for (const ref of found.values()) {
    if ((await ctx.store.getImage(ref.id)) !== undefined) stored.push(ref);
    else problems.push(`${recallName(ref)} is no longer stored.`);
  }
  const pinned = new Set(known.filter((ref) => ref.pinned).map((ref) => ref.id));
  const slots = Math.max(0, ctx.maxImages - pinned.size);
  const images = stored.slice(0, slots);
  if (stored.length > images.length) {
    problems.push(
      `Only ${plural(slots, "image")} fit in one request beside the pinned ones; recall the rest later.`,
    );
  }
  if (images.length === 0) return failure(problems.join(" "));
  const errors = problems.map((problem) => `Error: ${problem}`);
  const lines = [...images.map(imageLabel), ...notes, ...errors];
  return { text: [...lines, imagesFollow(images.length)].join("\n"), images };
}
