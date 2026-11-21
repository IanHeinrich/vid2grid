import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DroppedFile } from "../src/app/attachFiles";
import { droppedFiles, listenForDrops } from "../src/ui/shell/fileDrop";

function item(file: File | null, handle?: Promise<FileSystemHandle | null>) {
  return {
    kind: file ? "file" : "string",
    getAsFile: () => file,
    ...(handle ? { getAsFileSystemHandle: () => handle } : {}),
  };
}

function transfer(items: unknown[], files: File[] = [], types = ["Files"]): DataTransfer {
  return { items, files, types } as unknown as DataTransfer;
}

function dragEvent(type: string, dataTransfer?: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

describe("droppedFiles", () => {
  it("takes the files from the items with their handles", () => {
    const clip = new File(["x"], "clip.mp4");
    const handle = Promise.resolve(null);
    const dropped = droppedFiles(transfer([item(clip, handle), item(null)]));
    expect(dropped).toEqual([{ file: clip, handle }]);
  });

  it("falls back to the file list when no item is a file", () => {
    const photo = new File(["x"], "photo.png");
    expect(droppedFiles(transfer([], [photo]))).toEqual([{ file: photo }]);
  });
});

describe("listenForDrops", () => {
  let main: HTMLElement;
  let onDrop: ReturnType<typeof vi.fn<(files: DroppedFile[]) => void>>;

  beforeEach(() => {
    main = document.createElement("main");
    document.body.append(main);
    onDrop = vi.fn();
    listenForDrops(main, onDrop);
  });

  it("highlights while files are dragged over and clears when the drag leaves", () => {
    main.dispatchEvent(dragEvent("dragenter", transfer([], [], ["text/plain"])));
    expect(main.classList.contains("is-dragover")).toBe(false);
    main.dispatchEvent(dragEvent("dragenter", transfer([])));
    main.dispatchEvent(dragEvent("dragenter", transfer([])));
    main.dispatchEvent(dragEvent("dragleave"));
    expect(main.classList.contains("is-dragover")).toBe(true);
    main.dispatchEvent(dragEvent("dragleave"));
    expect(main.classList.contains("is-dragover")).toBe(false);
  });

  it("hands the dropped files on and clears the highlight", () => {
    const clip = new File(["x"], "clip.mp4");
    main.dispatchEvent(dragEvent("dragenter", transfer([])));
    main.dispatchEvent(dragEvent("drop", transfer([item(clip)])));
    expect(onDrop).toHaveBeenCalledWith([{ file: clip }]);
    expect(main.classList.contains("is-dragover")).toBe(false);
  });

  it("keeps a stray drop elsewhere from opening the file", () => {
    const stray = dragEvent("drop");
    document.body.dispatchEvent(stray);
    expect(stray.defaultPrevented).toBe(true);
  });
});
