import { exportBackup, importBackup, type ImportCounts } from "../../chat/exportChat";
import type { AppElements } from "../../dom";
import { errorText, plural } from "../../text";
import type { ChatStore } from "../../types";
import type { Toast } from "../shared/toast";

export interface BackupDeps {
  store: ChatStore;
  toast: Pick<Toast, "show">;
  download(blob: Blob, filename: string): void;
  onRestored(): Promise<void>;
  now?: () => number;
}

function backupSize(bytes: number): string {
  const mb = bytes / 1024 ** 2;
  return mb < 1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb.toFixed(1)} MB`;
}

export function restoredText(counts: ImportCounts): string {
  const { chats, messages, images, timelines } = counts;
  return `Restored ${plural(chats, "chat")}, ${plural(messages, "message")}, ${plural(images, "image")} and ${plural(timelines, "timeline")}.`;
}

async function downloadBackup(els: AppElements["backup"], deps: BackupDeps): Promise<void> {
  const now = (deps.now ?? Date.now)();
  const includeImages = els.includeImagesInput.checked;
  const blob = await exportBackup(deps.store, { includeImages, now });
  deps.download(blob, `vid2grid-chat-backup-${new Date(now).toISOString().slice(0, 10)}.json`);
  els.status.textContent = `Backup downloaded, about ${backupSize(blob.size)}.`;
}

async function restoreBackup(file: File, deps: BackupDeps): Promise<void> {
  const counts = await importBackup(deps.store, file);
  await deps.onRestored();
  deps.toast.show(restoredText(counts));
}

export function initBackup(els: Pick<AppElements, "backup">, deps: BackupDeps): void {
  const backup = els.backup;
  const fail = (action: string, error: unknown) => {
    deps.toast.show(`Could not ${action}: ${errorText(error)}`);
  };
  backup.downloadButton.addEventListener("click", () => {
    backup.downloadButton.disabled = true;
    backup.status.textContent = "Preparing the backup…";
    downloadBackup(backup, deps)
      .catch((error: unknown) => {
        backup.status.textContent = "";
        fail("download the backup", error);
      })
      .finally(() => {
        backup.downloadButton.disabled = false;
      });
  });
  backup.restoreButton.addEventListener("click", () => backup.restoreInput.click());
  backup.restoreInput.addEventListener("change", () => {
    const file = backup.restoreInput.files?.[0];
    backup.restoreInput.value = "";
    if (!file) return;
    restoreBackup(file, deps).catch((error: unknown) => fail("restore the backup", error));
  });
}
