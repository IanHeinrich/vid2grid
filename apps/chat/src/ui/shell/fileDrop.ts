import type { DroppedFile } from "../../app/attachFiles";

// Handles must be requested while the drop event is dispatching; the items go stale after it.
export function droppedFiles(transfer: DataTransfer): DroppedFile[] {
  const fromItems = [...transfer.items].flatMap((item): DroppedFile[] => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    if (!file) return [];
    const handle = item.getAsFileSystemHandle?.();
    return [handle ? { file, handle } : { file }];
  });
  return fromItems.length > 0 ? fromItems : [...transfer.files].map((file) => ({ file }));
}

export function listenForDrops(main: HTMLElement, onDrop: (files: DroppedFile[]) => void): void {
  let depth = 0;
  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
  main.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    depth += 1;
    main.classList.add("is-dragover");
  });
  main.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) main.classList.remove("is-dragover");
  });
  main.addEventListener("drop", (event) => {
    depth = 0;
    main.classList.remove("is-dragover");
    if (event.dataTransfer) onDrop(droppedFiles(event.dataTransfer));
  });
  // A stray drop anywhere else would make the browser navigate away to the file.
  for (const type of ["dragover", "drop"]) {
    document.addEventListener(type, (event) => event.preventDefault());
  }
}
