export function createVideoElement(preload: "metadata" | "auto"): HTMLVideoElement {
  const video = document.createElement("video");
  video.preload = preload;
  video.muted = true;
  video.playsInline = true;
  return video;
}

export function waitForEvent(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Video failed while waiting for ${event}`, { cause: target.error }));
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}
