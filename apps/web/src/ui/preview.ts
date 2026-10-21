import type { AppElements, FormElements } from "../dom";
import { setVideoFile, setVideoInfo, type AppState } from "../state";
import { readNumber } from "../inputs";
import { toUserMessage } from "../errors";
import { floorToTenth, initialRange, scrubbedRange, type RangeHandle } from "../timeRange";
import { initRangeSlider, type HandlePosition, type RangeSlider } from "./rangeSlider";
import type { StatusLine } from "./status";
import type { Gallery } from "./gallery";
import type { FramePlanPanel } from "./framePlanPanel";
import type { GenerateControls } from "./generate";
import { clamp, type VideoInfo } from "@vid2grid/core";
import { probeVideo } from "@vid2grid/browser";

const PREVIEW_MARGIN = 10;
const PREVIEW_FALLBACK_SIZE = { width: 200, height: 120 };

interface PreviewDeps {
  status: StatusLine;
  gallery: Gallery;
  framePlan: FramePlanPanel;
  generate: GenerateControls;
}

interface PreviewContext extends PreviewDeps {
  els: Pick<AppElements, "preview" | "rangeSlider" | "form">;
  state: AppState;
  player: ScrubPlayer;
  slider: RangeSlider;
}

interface ScrubPlayer {
  load(file: File | null): void;
  show(seconds: number, durationSeconds: number, handle: HandlePosition): void;
  hide(): void;
}

// Float the preview above the grabbed handle, clamped to stay on screen.
export function previewPlacement(
  handle: HandlePosition,
  size: { width: number; height: number },
  viewportWidth: number,
): { left: number; top: number } {
  const left = clamp(
    handle.centerX - size.width / 2,
    PREVIEW_MARGIN,
    viewportWidth - size.width - PREVIEW_MARGIN,
  );
  const above = handle.sliderTop - size.height - PREVIEW_MARGIN;
  const top = above >= PREVIEW_MARGIN ? above : handle.sliderBottom + PREVIEW_MARGIN;
  return { left, top };
}

export function initPreview(
  els: Pick<AppElements, "preview" | "rangeSlider" | "form">,
  state: AppState,
  deps: PreviewDeps,
): void {
  const ctx: PreviewContext = {
    ...deps,
    els,
    state,
    player: createScrubPlayer(els.preview.videoPreview),
    slider: initRangeSlider(els, state, {
      onScrub: (handle, seconds, position) => scrub(ctx, handle, seconds, position),
      onScrubEnd: () => ctx.player.hide(),
    }),
  };
  els.preview.videoFileInput.addEventListener("change", () => {
    void loadFile(ctx, els.preview.videoFileInput.files?.[0] ?? null);
  });
  listenForDrops(ctx);
  // Typing reflects onto the slider without rewriting the field mid-keystroke.
  for (const input of [els.form.startTimeInput, els.form.endTimeInput]) {
    input.addEventListener("input", () => onRangeChanged(ctx));
  }
}

function listenForDrops(ctx: PreviewContext): void {
  const { dropzone } = ctx.els.preview;
  for (const type of ["dragenter", "dragover"]) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragover");
    });
  }
  for (const type of ["dragleave", "dragend", "drop"]) {
    dropzone.addEventListener(type, () => dropzone.classList.remove("is-dragover"));
  }
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0] ?? null;
    if (file) void loadFile(ctx, file);
  });
  // A stray drop anywhere else would make the browser navigate away to the file.
  for (const type of ["dragover", "drop"]) {
    document.addEventListener(type, (event) => event.preventDefault());
  }
}

// The preview element stays in the DOM with its src loaded (so scrub seeks are
// instant) but is only shown as a floating overlay while a handle is grabbed.
function createScrubPlayer(video: HTMLVideoElement): ScrubPlayer {
  let objectUrl: string | null = null;
  return {
    load(file) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = file ? URL.createObjectURL(file) : null;
      video.classList.remove("is-scrubbing");
      if (objectUrl) {
        video.src = objectUrl;
      } else {
        video.removeAttribute("src");
        video.load();
      }
    },
    show(seconds, durationSeconds, handle) {
      if (!objectUrl) return;
      video.classList.add("is-scrubbing");
      if (!Number.isNaN(seconds)) {
        video.currentTime = clamp(seconds, 0, durationSeconds);
      }
      const size = {
        width: video.offsetWidth || PREVIEW_FALLBACK_SIZE.width,
        height: video.offsetHeight || PREVIEW_FALLBACK_SIZE.height,
      };
      const { left, top } = previewPlacement(handle, size, window.innerWidth);
      video.style.left = `${left}px`;
      video.style.top = `${top}px`;
    },
    hide() {
      video.classList.remove("is-scrubbing");
    },
  };
}

async function loadFile(ctx: PreviewContext, file: File | null): Promise<void> {
  setVideoFile(ctx.state, file);
  ctx.els.preview.dropzoneFilename.textContent = file?.name ?? "";
  ctx.els.preview.dropzoneFilename.hidden = !file;
  ctx.player.load(file);
  ctx.gallery.render();
  ctx.generate.render();
  if (!file) {
    clearVideo(ctx);
    return;
  }

  ctx.status.show("Reading video metadata...");
  let videoInfo: VideoInfo;
  try {
    videoInfo = await probeVideo(file);
  } catch (err) {
    if (ctx.state.videoFile !== file) return;
    ctx.status.show(`Failed to read video: ${toUserMessage(err)}`);
    ctx.player.load(null);
    clearVideo(ctx);
    return;
  }
  if (ctx.state.videoFile !== file) return;

  ctx.status.show("");
  setVideoInfo(ctx.state, videoInfo);
  resetTimeInputs(ctx.els.form, videoInfo.durationSeconds);
  ctx.slider.render();
  ctx.generate.render();
  ctx.framePlan.applyVideo(file);
}

function clearVideo(ctx: PreviewContext): void {
  setVideoInfo(ctx.state, null);
  ctx.generate.render();
  ctx.slider.render();
  ctx.framePlan.render();
}

function resetTimeInputs(form: FormElements, durationSeconds: number): void {
  const range = initialRange(durationSeconds);
  for (const input of [form.startTimeInput, form.endTimeInput]) {
    input.disabled = false;
    input.max = String(floorToTenth(durationSeconds));
  }
  form.startTimeInput.value = String(range.start);
  form.endTimeInput.value = String(range.end);
}

function onRangeChanged(ctx: PreviewContext): void {
  ctx.slider.render();
  ctx.framePlan.refresh();
}

// A handle moved: keep start < end, write the moved boundary back into its number
// input (the source of truth), and show the floating preview at that frame.
function scrub(
  ctx: PreviewContext,
  handle: RangeHandle,
  seconds: number,
  position: HandlePosition,
): void {
  const { form } = ctx.els;
  const duration = ctx.state.videoInfo?.durationSeconds ?? 0;
  const current = {
    start: readNumber(form.startTimeInput, 0),
    end: readNumber(form.endTimeInput, duration),
  };
  const range = scrubbedRange(handle, seconds, current, duration);
  const input = handle === "start" ? form.startTimeInput : form.endTimeInput;
  input.value = String(range[handle]);
  onRangeChanged(ctx);
  ctx.player.show(range[handle], duration, position);
}
