/**
 * Gallery + lightbox rendering: owns the generated grid images' object URLs
 * and the click-to-zoom overlay.
 */
import { els } from "../dom";
import { state } from "../state";
import { gridFileName, gridTranscriptFileName } from "../grid/gridFileName";
import { vttToPlainText } from "../transcription/transcription";
import type { TranscriptFile } from "../core";

type PreviewSlot = { el: HTMLElement; file: TranscriptFile } | null;

export function resetGallery(): void {
  state.jpegBlobs = [];
  state.transcriptFiles = [];
  state.galleryUrls.forEach((url) => URL.revokeObjectURL(url));
  state.galleryUrls = [];
  els.gallery.innerHTML = "";
  closeLightbox();
  els.resultsHeader.hidden = true;
  els.saveToFolderButton.hidden = true;
}

export function renderGallery(): void {
  els.gallery.innerHTML = "";
  state.galleryUrls = state.jpegBlobs.map((blob) => URL.createObjectURL(blob));
  const previewSlots: PreviewSlot[] = [];
  state.galleryUrls.forEach((url, i) => {
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    img.src = url;
    img.alt = gridFileName(i);
    img.title = "Click to view larger";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("click", () => openLightbox(url, img.alt));
    const caption = document.createElement("figcaption");
    caption.textContent = img.alt;
    figure.append(img, caption);

    const transcriptFile = state.transcriptFiles.find((f) => f.name === gridTranscriptFileName(i));
    if (transcriptFile) {
      const block = document.createElement("div");
      block.className = "transcript-block";
      const label = document.createElement("span");
      label.className = "transcript-label";
      label.textContent = "Transcript";
      const preview = document.createElement("p");
      preview.className = "transcript-preview";
      block.append(label, preview);
      figure.appendChild(block);
      previewSlots[i] = { el: preview, file: transcriptFile };
    } else {
      previewSlots[i] = null;
    }

    els.gallery.appendChild(figure);
  });
  populateTranscriptPreviews(previewSlots);
  els.resultsCount.textContent = `Generated ${state.jpegBlobs.length} grid image(s)`;
  els.resultsHeader.hidden = state.jpegBlobs.length === 0;
  els.emptyState.hidden = true;
}

/**
 * Fills every per-sheet transcript preview. A low frames-per-grid + high FPS
 * makes each sheet span a fraction of a second, so one multi-second speech cue
 * overlaps a whole run of consecutive sheets and repeats verbatim. To avoid a
 * wall of duplicated text, the full transcript is shown on the first sheet of
 * each run and the repeats collapse to a reference back to it.
 */
function populateTranscriptPreviews(slots: PreviewSlot[]): void {
  const texts = slots.map((slot) => (slot ? slot.file.blob.text() : Promise.resolve(null)));
  void Promise.all(texts).then((vtts) => {
    let runText: string | null = null;
    let runStartName = "";
    vtts.forEach((vtt, i) => {
      const slot = slots[i];
      if (!slot) {
        runText = null;
        return;
      }
      const text = vtt ? vttToPlainText(vtt) : "";
      if (!text) {
        slot.el.textContent = "No speech detected";
        slot.el.classList.add("is-empty");
        runText = null;
        return;
      }
      if (text === runText) {
        slot.el.textContent = `Same as ${runStartName}`;
        slot.el.title = text; // hover still reveals the shared transcript
        slot.el.classList.add("is-duplicate");
      } else {
        slot.el.textContent = text;
        slot.el.title = text; // hover to read the full transcript inline
        runText = text;
        runStartName = gridFileName(i);
      }
    });
  });
}

let lastFocusedBeforeLightbox: HTMLElement | null = null;

function openLightbox(url: string, alt: string): void {
  lastFocusedBeforeLightbox = document.activeElement as HTMLElement | null;
  els.lightboxImage.src = url;
  els.lightboxImage.alt = alt;
  els.lightbox.hidden = false;
  els.lightboxClose.focus();
}

function closeLightbox(): void {
  els.lightbox.hidden = true;
  els.lightboxImage.src = "";
  lastFocusedBeforeLightbox?.focus();
  lastFocusedBeforeLightbox = null;
}

export function initLightbox(): void {
  els.lightbox.addEventListener("click", closeLightbox);
  els.lightboxClose.addEventListener("click", (event) => {
    event.stopPropagation();
    closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.lightbox.hidden) closeLightbox();
  });
}
