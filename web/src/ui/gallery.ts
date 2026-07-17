/**
 * Gallery + lightbox rendering: owns the generated grid images' object URLs
 * and the click-to-zoom overlay.
 */
import { els } from "../dom";
import { state } from "../state";
import { gridFileName } from "../gridFileName";

export function resetGallery(): void {
  state.jpegBlobs = [];
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
  state.galleryUrls.forEach((url, i) => {
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    img.src = url;
    img.alt = gridFileName(i);
    img.title = "Click to view larger";
    img.addEventListener("click", () => openLightbox(url, img.alt));
    const caption = document.createElement("figcaption");
    caption.textContent = img.alt;
    figure.append(img, caption);
    els.gallery.appendChild(figure);
  });
  els.resultsCount.textContent = `Generated ${state.jpegBlobs.length} grid image(s)`;
  els.resultsHeader.hidden = state.jpegBlobs.length === 0;
  els.emptyState.hidden = true;
}

function openLightbox(url: string, alt: string): void {
  els.lightboxImage.src = url;
  els.lightboxImage.alt = alt;
  els.lightbox.hidden = false;
}

function closeLightbox(): void {
  els.lightbox.hidden = true;
  els.lightboxImage.src = "";
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
