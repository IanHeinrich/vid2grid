/**
 * Dual-handle timeline slider for the start/end time range. Two overlaid
 * native <input type="range"> handles (kept keyboard-accessible and
 * screen-reader-friendly for free) sit over a track whose fill shows the
 * selected span. The number inputs in the sidebar remain the source of truth;
 * this is just a second, draggable view of the same two values.
 */
import { els } from "../dom";

const THUMB_PX = 16;

/** Where a handle currently sits on screen, for positioning the scrub preview. */
export interface HandlePosition {
  centerX: number;
  sliderTop: number;
  sliderBottom: number;
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function handlePosition(input: HTMLInputElement): HandlePosition {
  const rect = input.getBoundingClientRect();
  const max = Number(input.max) || 0;
  const frac = max > 0 ? input.valueAsNumber / max : 0;
  // The native thumb is inset by ~half its width at each end of the track.
  const usable = Math.max(0, rect.width - THUMB_PX);
  return {
    centerX: rect.left + THUMB_PX / 2 + frac * usable,
    sliderTop: rect.top,
    sliderBottom: rect.bottom,
  };
}

/**
 * Wires the two handles. `onScrub` fires while a handle is grabbed or
 * arrow-keyed (with the live time and the handle's screen position);
 * `onScrubEnd` fires on release / blur so the caller can hide the preview.
 */
export function initRangeSlider(callbacks: {
  onScrub: (which: "start" | "end", seconds: number, pos: HandlePosition) => void;
  onScrubEnd: () => void;
}): void {
  let dragging = false;

  const wire = (input: HTMLInputElement, which: "start" | "end") => {
    const scrub = () => callbacks.onScrub(which, input.valueAsNumber, handlePosition(input));
    input.addEventListener("pointerdown", () => {
      dragging = true;
      scrub();
    });
    input.addEventListener("input", scrub);
    input.addEventListener("blur", () => callbacks.onScrubEnd());
  };
  wire(els.startRange, "start");
  wire(els.endRange, "end");

  // Pointer can release outside the thumb, so end the scrub at the window level.
  window.addEventListener("pointerup", () => {
    if (dragging) {
      dragging = false;
      callbacks.onScrubEnd();
    }
  });
}

export function setRangeBounds(duration: number): void {
  const max = String(duration);
  els.startRange.max = max;
  els.endRange.max = max;
  els.startRange.disabled = false;
  els.endRange.disabled = false;
  els.rangeMinLabel.textContent = formatClock(0);
  els.rangeMaxLabel.textContent = formatClock(duration);
}

export function disableRangeSlider(): void {
  els.startRange.disabled = true;
  els.endRange.disabled = true;
  els.startRange.max = "0";
  els.endRange.max = "0";
  els.rangeMinLabel.textContent = "0:00";
  els.rangeMaxLabel.textContent = "0:00";
  setRangeValues(0, 0);
}

export function setRangeValues(start: number, end: number): void {
  els.startRange.value = String(start);
  els.endRange.value = String(end);
  const max = Number(els.startRange.max) || 0;
  const pct = (value: number) => (max > 0 ? (value / max) * 100 : 0);
  els.rangeFill.style.left = `${pct(start)}%`;
  els.rangeFill.style.width = `${Math.max(0, pct(end) - pct(start))}%`;
  // When both handles sit at the far right they overlap; lift the start handle
  // above the end handle there so it stays grabbable (can still drag it left).
  els.startRange.style.zIndex = max > 0 && start >= max ? "5" : "3";
}
