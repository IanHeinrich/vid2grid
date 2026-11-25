import { lookingModelId } from "../../chat/seen";
import { formatTimestamp, parseTimestamp } from "../../time";
import type { StudyPlanOptions } from "../../types";
import type { StudyEstimate, StudyPlan } from "../../video/study";
import { pickedModel, planFor, storage, type StudyContext } from "./context";
import { count } from "./studyProgress";

// Light keeps one sheet a window and Dense allows up to four; Normal leaves planStudy's own choice.
const DENSITY_FRAMES = { light: 12, dense: 72 } as const;
const SECONDS_PER_MINUTE = 60;
const AUDIO_KEY = "vid2grid-chat-study-audio";
const AUDIO_ESTIMATE = "Audio is free and analysed on this computer.";

export function studyAudioWanted(ctx: StudyContext): boolean {
  return storage(ctx).getItem(AUDIO_KEY) !== "off";
}

export function estimateText(estimate: StudyEstimate): string {
  const parts = [
    count(estimate.requests, "window"),
    count(estimate.images, "image"),
    `about ${estimate.inputTokens.toLocaleString("en-US")} input tokens`,
  ];
  if (estimate.costUsd !== undefined) parts.push(`about $${estimate.costUsd.toFixed(2)}`);
  parts.push(durationText(estimate.seconds));
  return `${parts.join(", ")}${estimate.approximate ? " (approximate)" : ""}.`;
}

export function planSummaryText(plan: StudyPlan): string {
  const start = plan.windows[0]?.startSeconds ?? 0;
  const end = plan.windows.at(-1)?.endSeconds ?? start;
  const frames = count(plan.framesPerWindow, "frame");
  const sheets = count(plan.sheetsPerWindow, "sheet");
  const span = `${formatTimestamp(start)} to ${formatTimestamp(end)}`;
  return `From ${span}, ${frames} a window on ${sheets}.`;
}

function durationText(seconds: number): string {
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  return minutes < 1 ? "under a minute" : `about ${count(minutes, "minute")}`;
}

export function listenSettings(ctx: StudyContext): void {
  const { windowInput, densityInput, fromInput, toInput } = ctx.els;
  const { fromCurrentButton, wholeVideoButton, audioInput } = ctx.els;
  audioInput.checked = studyAudioWanted(ctx);
  audioInput.addEventListener("change", () => {
    storage(ctx).setItem(AUDIO_KEY, audioInput.checked ? "on" : "off");
    renderEstimate(ctx);
  });
  for (const input of [windowInput, densityInput, fromInput, toInput]) {
    input.addEventListener("input", () => renderEstimate(ctx));
  }
  for (const input of [fromInput, toInput]) {
    // Enter would submit through the form's first button, which is Cancel.
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
    });
  }
  fromCurrentButton.addEventListener("click", () => {
    const seconds = ctx.deps.currentTime?.();
    if (seconds === undefined) {
      ctx.deps.status.show("The player is showing another video, so play the attached one first.");
      return;
    }
    fromInput.value = formatTimestamp(seconds);
    renderEstimate(ctx);
  });
  wholeVideoButton.addEventListener("click", () => {
    fromInput.value = "";
    toInput.value = "";
    renderEstimate(ctx);
  });
}

function timeField(input: HTMLInputElement): number | undefined {
  const text = input.value.trim();
  return text === "" ? undefined : (parseTimestamp(text) ?? Number.NaN);
}

function markInvalid(input: HTMLInputElement, invalid: boolean): void {
  if (invalid) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function densityFrames(value: string): number | undefined {
  return value === "light" || value === "dense" ? DENSITY_FRAMES[value] : undefined;
}

// Undefined while the range is unusable, with the offending field marked.
export function readSettings(ctx: StudyContext): StudyPlanOptions | undefined {
  const { windowInput, densityInput, fromInput, toInput } = ctx.els;
  const duration = ctx.state.currentChat?.video?.durationSeconds ?? 0;
  const startSeconds = timeField(fromInput);
  const endSeconds = timeField(toInput);
  const from = startSeconds ?? 0;
  const to = endSeconds ?? duration;
  const fromValid = !Number.isNaN(from) && from < duration;
  const toValid = !Number.isNaN(to) && (!fromValid || to > from);
  markInvalid(fromInput, !fromValid);
  markInvalid(toInput, !toValid);
  if (!fromValid || !toValid) return undefined;
  const framesPerWindow = densityFrames(densityInput.value);
  return {
    windowSeconds: Number(windowInput.value),
    ...(framesPerWindow !== undefined && { framesPerWindow }),
    ...(startSeconds !== undefined && { startSeconds }),
    ...(endSeconds !== undefined && { endSeconds }),
  };
}

export function openDialog(ctx: StudyContext, restart: boolean): void {
  const chat = ctx.state.currentChat;
  if (!chat?.video) return;
  if (!ctx.deps.toolContext()) {
    ctx.deps.status.show("Reattach the video before studying it.");
    return;
  }
  ctx.restart = restart;
  ctx.choice.modelId = lookingModelId(chat) ?? chat.settings.modelId;
  const { fromInput, toInput, fromCurrentButton } = ctx.els;
  fromInput.value = "";
  toInput.value = "";
  toInput.placeholder = formatTimestamp(chat.video.durationSeconds);
  fromCurrentButton.hidden = ctx.deps.currentTime === undefined;
  ctx.els.audioInput.checked = studyAudioWanted(ctx);
  ctx.picker.render();
  renderEstimate(ctx);
  ctx.els.dialog.returnValue = "";
  ctx.els.dialog.showModal();
}

export function renderEstimate(ctx: StudyContext): void {
  const { windowInput, windowValue, planSummary, estimate, startButton } = ctx.els;
  windowValue.textContent = `${windowInput.value} s`;
  const settings = readSettings(ctx);
  const model = pickedModel(ctx, ctx.choice.modelId);
  const plan = settings && planFor(ctx, model, settings);
  startButton.disabled = !plan;
  planSummary.textContent = plan
    ? planSummaryText(plan)
    : "Check the range: From has to come before To, within the video.";
  const audio = ctx.els.audioInput.checked ? ` ${AUDIO_ESTIMATE}` : "";
  estimate.textContent = plan ? `${estimateText(plan.estimate)}${audio}` : "";
}
