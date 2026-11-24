import type { ImageCleanup, SweepRefusal } from "../../app/imageCleanup";
import type { AppElements } from "../../dom";
import { latestCalls } from "../../latest";
import { errorText, plural } from "../../text";
import type { UnusedImages } from "../../types";
import { formatBytes } from "../video/videoCopies";

export interface UnusedImagesPanel {
  render(): Promise<void>;
}

export interface UnusedImagesDeps {
  images: Pick<ImageCleanup, "countUnused" | "countToDelete" | "canDelete" | "deleteUnused">;
  confirm(message: string): boolean;
}

const REFUSALS: Record<SweepRefusal, string> = {
  running: "Wait for the reply to finish, then try again.",
  undo: "A deletion can still be undone, or a restore is running. Try again in a few seconds.",
  late: "That took too long to be safe, so nothing was deleted. Try again.",
  otherTabs: "Close the other vid2grid chat tabs, then try again.",
  unsupported: "This tab cannot tell whether other tabs use them, so they are kept.",
};

function unusedText({ images, bytes }: UnusedImages): string {
  return `${plural(images.length, "unused image")}, ${formatBytes(bytes)}`;
}

interface PanelContext {
  els: AppElements["settingsDialog"];
  deps: UnusedImagesDeps;
  startRender: ReturnType<typeof latestCalls>;
}

export function initUnusedImages(
  els: Pick<AppElements, "settingsDialog">,
  deps: UnusedImagesDeps,
): UnusedImagesPanel {
  const ctx: PanelContext = {
    els: els.settingsDialog,
    deps,
    startRender: latestCalls(),
  };
  ctx.els.deleteUnusedImagesButton.addEventListener("click", () => void askAndDelete(ctx));
  return {
    render: () => {
      ctx.els.unusedImagesStatus.textContent = "";
      return render(ctx).catch((error: unknown) => {
        ctx.els.unusedImagesStatus.textContent = `Could not count them: ${errorText(error)}`;
      });
    },
  };
}

async function render(ctx: PanelContext): Promise<void> {
  const { unusedImagesText, unusedImagesStatus, deleteUnusedImagesButton } = ctx.els;
  const { images } = ctx.deps;
  const isLatest = ctx.startRender();
  const unused = await images.countUnused();
  if (!isLatest()) return;
  const none = unused.images.length === 0;
  unusedImagesText.textContent = none ? "No unused images." : unusedText(unused);
  deleteUnusedImagesButton.hidden = none || !images.canDelete;
  if (!none && !images.canDelete) unusedImagesStatus.textContent = REFUSALS.unsupported;
}

async function askAndDelete(ctx: PanelContext): Promise<void> {
  const { unusedImagesStatus, deleteUnusedImagesButton } = ctx.els;
  deleteUnusedImagesButton.disabled = true;
  unusedImagesStatus.textContent = "";
  try {
    unusedImagesStatus.textContent = await recountAndDelete(ctx);
    await render(ctx);
  } catch (error) {
    unusedImagesStatus.textContent = `Could not delete the unused images: ${errorText(error)}`;
  } finally {
    deleteUnusedImagesButton.disabled = false;
  }
}

// Counted again here, so the question is about exactly what is then deleted.
async function recountAndDelete({ deps }: PanelContext): Promise<string> {
  const { images } = deps;
  const recount = await images.countToDelete();
  if ("refused" in recount) return REFUSALS[recount.refused];
  const { counted } = recount;
  if (counted.images.length === 0) return "";
  if (!deps.confirm(`Delete ${unusedText(counted)}? This cannot be undone.`)) return "";
  const result = await images.deleteUnused(counted);
  return "deleted" in result ? `Deleted ${unusedText(result.deleted)}.` : REFUSALS[result.refused];
}
