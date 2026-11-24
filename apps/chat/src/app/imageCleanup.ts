import { videoKeysOf } from "../chat/store";
import { checkedImageUse, imageUse, joinUses, type ImageHolder } from "../imageIds";
import { pendingHolder, type AppState } from "../state";
import type { ImageRelease, ImageUse, UnusedImages } from "../types";
import type { TabRefusal, Tabs } from "./tabs";

export interface HeldImages {
  // What was held is saved again, or was never lost.
  letGo(): void;
  // Nothing can bring it back, so what only it used is deleted.
  final(): void;
}

export type SweepRefusal = "running" | "undo" | "late" | TabRefusal;

export type SweepResult = { deleted: UnusedImages } | { refused: SweepRefusal };

export interface ImageCleanup {
  // Keeps what an undo, or work between two saves, could still bring back.
  hold(holder: ImageHolder): HeldImages;
  // Skipped while a reply runs or another tab is open, whose unsaved images cannot be seen here.
  release(dropped: ImageHolder): Promise<void>;
  countUnused(): Promise<UnusedImages>;
  // Counted again for a deletion, or why there can be none now.
  countToDelete(): Promise<{ counted: UnusedImages } | { refused: SweepRefusal }>;
  // False when this tab cannot say whether other tabs are open.
  readonly canDelete: boolean;
  deleteUnused(counted: UnusedImages): Promise<SweepResult>;
}

export interface ImageCleanupDeps {
  store: ImageRelease;
  tabs: Tabs;
}

interface CleanupContext {
  state: AppState;
  deps: ImageCleanupDeps;
  held: Set<ImageHolder>;
}

export function createImageCleanup(state: AppState, deps: ImageCleanupDeps): ImageCleanup {
  const ctx: CleanupContext = { state, deps, held: new Set() };
  return {
    hold: (holder) => hold(ctx, holder),
    release: (dropped) => release(ctx, dropped),
    countUnused: () => deps.store.countUnusedImages(() => unsavedUse(ctx)),
    countToDelete: () => countToDelete(ctx),
    canDelete: deps.tabs.supported,
    deleteUnused: (counted) => deleteUnused(ctx, counted),
  };
}

function hold(ctx: CleanupContext, holder: ImageHolder): HeldImages {
  // A copy, so the same holder held twice is let go of separately.
  const entry = { ...holder };
  ctx.held.add(entry);
  return {
    letGo: () => ctx.held.delete(entry),
    final: () => {
      if (ctx.held.delete(entry)) void release(ctx, entry);
    },
  };
}

function unsavedUse({ state, held }: CleanupContext): ImageUse {
  const { chats, currentChat, messages, pending } = state;
  const videoKeys = [
    ...chats.flatMap((chat) => (chat.video ? [chat.video.fileKey] : [])),
    ...(currentChat ? videoKeysOf(currentChat, messages) : []),
  ];
  const holders = [{ messages, videoKeys }, ...[...pending.values()].map(pendingHolder), ...held];
  return joinUses(holders.map(checkedImageUse));
}

async function release(ctx: CleanupContext, holder: ImageHolder): Promise<void> {
  const { store, tabs } = ctx.deps;
  const running = () => ctx.state.runningChats.size > 0;
  try {
    const dropped = imageUse(holder);
    if (dropped.images.size === 0 && dropped.videos.size === 0) return;
    const unsaved = (inTime: () => boolean) =>
      running() || !inTime() ? undefined : unsavedUse(ctx);
    const refused =
      running() ||
      "refused" in
        (await tabs.whileAlone((inTime) => store.releaseImages(dropped, () => unsaved(inTime))));
    // Still told, so a sweep no longer takes them for images about to be saved.
    if (refused) await store.releaseImages(dropped, () => undefined);
  } catch {
    // The images stay, and the count in Settings says what stops them from being deleted.
  }
}

function blocker({ state, held }: CleanupContext): SweepRefusal | undefined {
  if (state.runningChats.size > 0) return "running";
  return held.size > 0 ? "undo" : undefined;
}

async function countToDelete(
  ctx: CleanupContext,
): Promise<{ counted: UnusedImages } | { refused: SweepRefusal }> {
  const { store, tabs } = ctx.deps;
  const refused = blocker(ctx);
  if (refused) return { refused };
  const result = await tabs.whileAlone(() => store.countUnusedImages(() => unsavedUse(ctx)));
  return "refused" in result ? result : { counted: result.done };
}

async function deleteUnused(ctx: CleanupContext, counted: UnusedImages): Promise<SweepResult> {
  const { store, tabs } = ctx.deps;
  const refused = blocker(ctx);
  if (refused) return { refused };
  const result = await tabs.whileAlone((inTime) =>
    store.deleteUnusedImages(counted, () =>
      blocker(ctx) || !inTime() ? undefined : unsavedUse(ctx),
    ),
  );
  if ("refused" in result) return result;
  return result.done ? { deleted: result.done } : { refused: blocker(ctx) ?? "late" };
}
