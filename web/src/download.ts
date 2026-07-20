import JSZip from "jszip";
import { gridFileName } from "./gridFileName";
import type { TranscriptFile } from "./core";

export function isFolderSaveSupported(): boolean {
  return typeof window.showDirectoryPicker === "function";
}

export async function downloadAllAsZip(blobs: Blob[], transcriptFiles: TranscriptFile[] = []): Promise<void> {
  const zip = new JSZip();
  blobs.forEach((blob, i) => zip.file(gridFileName(i), blob));
  transcriptFiles.forEach(({ name, blob }) => zip.file(name, blob));
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "vid2grid_grids.zip";
  anchor.click();
  URL.revokeObjectURL(url);
}

function sanitizeForFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return cleaned || "video";
}

/** e.g. "myClip.mp4" -> "myClip_grids_2026-07-17_143000" */
export function buildGridsFolderName(sourceFileName: string, now = new Date()): string {
  const base = sanitizeForFileName(sourceFileName.replace(/\.[^./\\]+$/, ""));
  const timestamp = now
    .toISOString()
    .slice(0, 19)
    .replace("T", "_")
    .replace(/:/g, "");
  return `${base}_grids_${timestamp}`;
}

export async function saveAllToFolder(
  blobs: Blob[],
  folderName: string,
  transcriptFiles: TranscriptFile[] = [],
): Promise<void> {
  if (!window.showDirectoryPicker) {
    throw new Error("This browser doesn't support saving directly to a folder.");
  }
  const parentHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  const dirHandle = await parentHandle.getDirectoryHandle(folderName, { create: true });
  for (const [i, blob] of blobs.entries()) {
    await writeFile(dirHandle, gridFileName(i), blob);
  }
  for (const { name, blob } of transcriptFiles) {
    await writeFile(dirHandle, name, blob);
  }
}

async function writeFile(dirHandle: FileSystemDirectoryHandle, name: string, blob: Blob): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

