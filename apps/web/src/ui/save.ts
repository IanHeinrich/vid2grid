import type { AppElements } from "../dom";
import type { AppState } from "../state";
import { toUserMessage } from "../errors";
import type { StatusLine } from "./status";
import { downloadAllAsZip, isFolderSaveSupported, saveAllToFolder } from "../download";
import { buildGridsFolderName } from "@vid2grid/core";

const FOLDER_ACCESS_BLOCKED_MESSAGE =
  "Your browser blocked folder access. In Brave, try lowering Shields' fingerprinting protection for this site, or use Chrome/Edge instead.";

interface SaveContext {
  state: AppState;
  status: StatusLine;
}

export function initSave(
  els: Pick<AppElements, "save">,
  state: AppState,
  deps: { status: StatusLine },
): void {
  const ctx: SaveContext = { state, status: deps.status };
  els.save.saveToFolderButton.hidden = !isFolderSaveSupported();
  els.save.downloadAllButton.addEventListener("click", () => {
    void downloadZip(ctx);
  });
  els.save.saveToFolderButton.addEventListener("click", () => {
    void saveToFolder(ctx);
  });
}

async function downloadZip(ctx: SaveContext): Promise<void> {
  const { results } = ctx.state;
  if (!results) return;
  try {
    await downloadAllAsZip(results.sheets, results.transcriptFiles);
  } catch (err) {
    ctx.status.show(`Failed to download: ${toUserMessage(err)}`);
  }
}

async function saveToFolder(ctx: SaveContext): Promise<void> {
  const { results, videoFile } = ctx.state;
  if (!results) return;
  const folderName = buildGridsFolderName(videoFile?.name ?? "video");
  try {
    await saveAllToFolder(results.sheets, folderName, results.transcriptFiles);
    ctx.status.show(
      `Saved ${results.sheets.length} image(s) to "${folderName}" inside the folder you chose.`,
    );
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    // The user closed the folder picker; nothing failed.
    if (name === "AbortError") return;
    if (name === "SecurityError" || name === "NotAllowedError") {
      ctx.status.show(FOLDER_ACCESS_BLOCKED_MESSAGE);
      return;
    }
    ctx.status.show(`Failed to save to folder: ${toUserMessage(err)}`);
  }
}
