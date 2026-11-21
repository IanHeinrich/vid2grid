import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachFiles, attachPicked, type AttachFilesDeps } from "../src/app/attachFiles";
import { blankChat } from "../src/chat/chats";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setCurrentChat } from "../src/state";

let deps: AttachFilesDeps & {
  status: { show: ReturnType<typeof vi.fn> };
  composer: { addImages: ReturnType<typeof vi.fn> };
  video: { attach: ReturnType<typeof vi.fn> };
};

function file(name: string, type = ""): File {
  return new File(["x"], name, { type });
}

beforeEach(() => {
  const state = createAppState(DEFAULT_SETTINGS);
  setCurrentChat(state, blankChat("m", "chat", 1), []);
  deps = {
    state,
    status: { show: vi.fn() },
    composer: { addImages: vi.fn(() => Promise.resolve()) },
    video: { attach: vi.fn(() => Promise.resolve()) },
  };
});

describe("attachFiles", () => {
  it("adds the images, attaches the first video and names what cannot be attached", async () => {
    const photo = file("photo.png", "image/png");
    const clip = file("clip.mp4", "video/mp4");
    await attachFiles(deps, [
      { file: photo },
      { file: file("notes.txt", "text/plain") },
      { file: clip },
      { file: file("second.mov") },
    ]);
    expect(deps.composer.addImages).toHaveBeenCalledWith([photo]);
    expect(deps.video.attach).toHaveBeenCalledWith(clip, undefined);
    expect(deps.video.attach).toHaveBeenCalledTimes(1);
    expect(deps.status.show).toHaveBeenCalledWith(
      "Only videos and images can be attached: notes.txt",
      "error",
    );
  });

  it("passes on a file handle and ignores a directory or a failed one", async () => {
    const clip = file("clip.mp4", "video/mp4");
    const handle = { kind: "file" } as FileSystemFileHandle;
    await attachFiles(deps, [{ file: clip, handle: Promise.resolve(handle) }]);
    expect(deps.video.attach).toHaveBeenLastCalledWith(clip, handle);
    const folder = { kind: "directory" } as FileSystemHandle;
    await attachFiles(deps, [{ file: clip, handle: Promise.resolve(folder) }]);
    expect(deps.video.attach).toHaveBeenLastCalledWith(clip, undefined);
    await attachFiles(deps, [{ file: clip, handle: Promise.reject(new Error("denied")) }]);
    expect(deps.video.attach).toHaveBeenLastCalledWith(clip, undefined);
  });

  it("does nothing without a chat open", async () => {
    deps.state = createAppState(DEFAULT_SETTINGS);
    await attachFiles(deps, [{ file: file("photo.png", "image/png") }]);
    expect(deps.composer.addImages).not.toHaveBeenCalled();
  });
});

describe("attachPicked", () => {
  it("attaches a picked video with its handle", async () => {
    const clip = file("clip.mp4", "video/mp4");
    const handle = { kind: "file" } as FileSystemFileHandle;
    await attachPicked(deps, [{ file: clip, handle }]);
    expect(deps.video.attach).toHaveBeenCalledWith(clip, handle);
  });
});
