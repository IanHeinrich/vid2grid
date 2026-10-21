import type { AppElements } from "../dom";
import type { AppState, GenerationResults } from "../state";
import { vttToPlainText, type GeneratedFile } from "@vid2grid/core";

type GalleryElements = AppElements["gallery"];
type PreviewSlot = { el: HTMLElement; file: GeneratedFile<Blob> } | null;

export interface Gallery {
  render(): void;
}

interface Lightbox {
  open(url: string, alt: string): void;
  close(): void;
}

interface GalleryContext {
  els: GalleryElements;
  state: AppState;
  lightbox: Lightbox;
  imageUrls: string[];
}

export function initGallery(els: Pick<AppElements, "gallery">, state: AppState): Gallery {
  const ctx: GalleryContext = {
    els: els.gallery,
    state,
    lightbox: initLightbox(els.gallery),
    imageUrls: [],
  };
  const render = () => renderGallery(ctx);
  render();
  return { render };
}

function renderGallery(ctx: GalleryContext): void {
  const { els, state } = ctx;
  const { results } = state;
  ctx.imageUrls.forEach((url) => URL.revokeObjectURL(url));
  ctx.imageUrls = [];
  els.grid.innerHTML = "";
  ctx.lightbox.close();
  els.emptyState.hidden = results !== null || state.videoFile !== null;
  els.resultsHeader.hidden = !results || results.sheets.length === 0;
  if (!results) return;

  ctx.imageUrls = results.sheets.map((sheet) => URL.createObjectURL(sheet.data));
  const previewSlots = ctx.imageUrls.map((url, i) => appendFigure(ctx, results, url, i));
  populateTranscriptPreviews(previewSlots, results.sheets);
  els.resultsCount.textContent = `Generated ${results.sheets.length} grid image(s)`;
}

function appendFigure(
  ctx: GalleryContext,
  results: GenerationResults,
  url: string,
  index: number,
): PreviewSlot {
  const figure = document.createElement("figure");
  const img = document.createElement("img");
  img.src = url;
  img.alt = results.sheets[index]?.name ?? "";
  img.title = "Click to view larger";
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("click", () => ctx.lightbox.open(url, img.alt));
  const caption = document.createElement("figcaption");
  caption.textContent = img.alt;
  figure.append(img, caption);

  const transcriptName = results.plan.sheets[index]?.transcript?.fileName;
  const transcriptFile = results.transcriptFiles.find((file) => file.name === transcriptName);
  const slot = transcriptFile ? appendTranscriptBlock(figure, transcriptFile) : null;
  ctx.els.grid.appendChild(figure);
  return slot;
}

function appendTranscriptBlock(figure: HTMLElement, file: GeneratedFile<Blob>): PreviewSlot {
  const block = document.createElement("div");
  block.className = "transcript-block";
  const label = document.createElement("span");
  label.className = "transcript-label";
  label.textContent = "Transcript";
  const preview = document.createElement("p");
  preview.className = "transcript-preview";
  block.append(label, preview);
  figure.appendChild(block);
  return { el: preview, file };
}

// One multi-second cue overlaps a whole run of short sheets and would repeat verbatim
// on each, so only the run's first sheet shows it and the rest point back at that one.
function populateTranscriptPreviews(slots: PreviewSlot[], sheets: GeneratedFile<Blob>[]): void {
  const texts = slots.map((slot) => (slot ? slot.file.data.text() : Promise.resolve(null)));
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
      slot.el.title = text;
      if (text === runText) {
        slot.el.textContent = `Same as ${runStartName}`;
        slot.el.classList.add("is-duplicate");
      } else {
        slot.el.textContent = text;
        runText = text;
        runStartName = sheets[i]?.name ?? "";
      }
    });
  });
}

function initLightbox(els: GalleryElements): Lightbox {
  let lastFocused: HTMLElement | null = null;
  const lightbox: Lightbox = {
    open(url, alt) {
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      els.lightboxImage.src = url;
      els.lightboxImage.alt = alt;
      els.lightbox.hidden = false;
      els.lightboxClose.focus();
    },
    close() {
      els.lightbox.hidden = true;
      els.lightboxImage.src = "";
      lastFocused?.focus();
      lastFocused = null;
    },
  };
  els.lightbox.addEventListener("click", () => lightbox.close());
  els.lightboxClose.addEventListener("click", (event) => {
    event.stopPropagation();
    lightbox.close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.lightbox.hidden) lightbox.close();
  });
  return lightbox;
}
