// Two overlaid native range inputs, for keyboard and screen-reader support for free.
// The sidebar's number inputs stay the source of truth; this is a second view of them.
import type { AppElements } from "../dom";
import type { AppState } from "../state";
import { readNumber } from "../inputs";
import { floorToTenth, type RangeHandle } from "../timeRange";
import { formatClock } from "@vid2grid/core";

const THUMB_PX = 16;
// Lifted above the end handle when both sit at the far right, so it stays grabbable.
const START_HANDLE_Z_INDEX = { normal: "3", lifted: "5" };

type RangeSliderElements = AppElements["rangeSlider"];

export interface HandlePosition {
  centerX: number;
  sliderTop: number;
  sliderBottom: number;
}

export interface RangeSliderCallbacks {
  onScrub: (handle: RangeHandle, seconds: number, position: HandlePosition) => void;
  onScrubEnd: () => void;
}

export interface RangeSlider {
  render(): void;
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

export function initRangeSlider(
  els: Pick<AppElements, "rangeSlider" | "form">,
  state: AppState,
  callbacks: RangeSliderCallbacks,
): RangeSlider {
  let dragging = false;
  const listen = (input: HTMLInputElement, handle: RangeHandle) => {
    const scrub = () => callbacks.onScrub(handle, input.valueAsNumber, handlePosition(input));
    input.addEventListener("pointerdown", () => {
      dragging = true;
      scrub();
    });
    input.addEventListener("input", scrub);
    input.addEventListener("blur", () => callbacks.onScrubEnd());
  };
  listen(els.rangeSlider.startRange, "start");
  listen(els.rangeSlider.endRange, "end");

  // Pointer can release outside the thumb, so end the scrub at the window level.
  window.addEventListener("pointerup", () => {
    if (dragging) {
      dragging = false;
      callbacks.onScrubEnd();
    }
  });

  const render = () => renderRangeSlider(els, state);
  render();
  return { render };
}

function renderRangeSlider(els: Pick<AppElements, "rangeSlider" | "form">, state: AppState): void {
  const duration = state.videoInfo?.durationSeconds;
  if (duration === undefined) {
    renderBounds(els.rangeSlider, 0, true);
    renderValues(els.rangeSlider, 0, 0);
    return;
  }
  renderBounds(els.rangeSlider, floorToTenth(duration), false);
  renderValues(
    els.rangeSlider,
    readNumber(els.form.startTimeInput, 0),
    readNumber(els.form.endTimeInput, duration),
  );
}

function renderBounds(els: RangeSliderElements, max: number, disabled: boolean): void {
  for (const input of [els.startRange, els.endRange]) {
    input.max = String(max);
    input.disabled = disabled;
  }
  els.rangeMinLabel.textContent = formatClock(0);
  els.rangeMaxLabel.textContent = formatClock(max);
}

function renderValues(els: RangeSliderElements, start: number, end: number): void {
  els.startRange.value = String(start);
  els.endRange.value = String(end);
  const max = Number(els.startRange.max) || 0;
  const pct = (value: number) => (max > 0 ? (value / max) * 100 : 0);
  els.rangeFill.style.left = `${pct(start)}%`;
  els.rangeFill.style.width = `${Math.max(0, pct(end) - pct(start))}%`;
  els.startRange.style.zIndex =
    max > 0 && start >= max ? START_HANDLE_Z_INDEX.lifted : START_HANDLE_Z_INDEX.normal;
}
