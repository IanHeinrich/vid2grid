import { classifyFile } from "../attachments/images";
import type { AppState } from "../state";
import type { Composer, PickedFile } from "../ui/composer";
import type { StatusLine } from "../ui/status";
import type { VideoPanel } from "../ui/videoPanel";

export interface DroppedFile {
  file: File;
  handle?: Promise<FileSystemHandle | null> | undefined;
}

export interface AttachFilesDeps {
  state: AppState;
  status: Pick<StatusLine, "show">;
  composer: Pick<Composer, "addImages">;
  video: Pick<VideoPanel, "attach">;
}

function isFileHandle(handle: FileSystemHandle | null | undefined): handle is FileSystemFileHandle {
  return handle?.kind === "file";
}

export async function attachFiles(
  deps: AttachFilesDeps,
  dropped: readonly DroppedFile[],
): Promise<void> {
  if (!deps.state.currentChat) return;
  const ofKind = (kind: ReturnType<typeof classifyFile>) =>
    dropped.filter(({ file }) => classifyFile(file) === kind);
  const unsupported = ofKind("unsupported").map(({ file }) => file.name);
  if (unsupported.length > 0) {
    deps.status.show(`Only videos and images can be attached: ${unsupported.join(", ")}`, "error");
  }
  const images = ofKind("image").map(({ file }) => file);
  if (images.length > 0) await deps.composer.addImages(images);
  const [video] = ofKind("video");
  if (!video) return;
  const handle = await video.handle?.catch(() => null);
  await deps.video.attach(video.file, isFileHandle(handle) ? handle : undefined);
}

export function attachPicked(deps: AttachFilesDeps, files: readonly PickedFile[]): Promise<void> {
  return attachFiles(
    deps,
    files.map(({ file, handle }) => ({ file, handle: handle && Promise.resolve(handle) })),
  );
}
