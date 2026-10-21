import type { Vid2GridErrorCode } from "../errors";
import type { RenderPlan, TranscriptWindow } from "../plan/renderPlan";
import type { Vid2GridWarning } from "../warnings";
import { cuesInWindow, cuesToVtt, type TranscriptCue } from "./vtt";

export interface TranscriptFile {
  fileName: string;
  vtt: string;
}

const TRANSCRIPT_FAILED_PREFIX = "Transcript generation failed: ";

export const NO_TRANSCRIPTION_PORT: Vid2GridWarning = {
  code: "no_transcription_port",
  message: `${TRANSCRIPT_FAILED_PREFIX}this host has no transcription support`,
};

export function transcriptionFailedWarning(
  reason: string,
  errorCode?: Vid2GridErrorCode,
): Vid2GridWarning {
  return {
    code: errorCode === "no_audio" ? "no_audio" : "transcription_failed",
    message: `${TRANSCRIPT_FAILED_PREFIX}${reason}`,
  };
}

// Sheets render in plan order, so the rendered ones are the first renderedSheetCount.
// A short capture drops the trailing sheets, so the last surviving window takes over
// their range rather than leaving the cues past it in no file at all.
export function transcriptWindows(
  plan: RenderPlan,
  renderedSheetCount: number,
  endSeconds: number,
): TranscriptWindow[] {
  if (plan.combinedTranscript !== undefined) return [plan.combinedTranscript];
  const windows = plan.sheets
    .slice(0, renderedSheetCount)
    .flatMap((sheet) => (sheet.transcript ? [sheet.transcript] : []));
  const last = windows[windows.length - 1];
  if (!last) return windows;
  return [...windows.slice(0, -1), { ...last, endSeconds }];
}

export function transcriptFiles(
  plan: RenderPlan,
  renderedSheetCount: number,
  endSeconds: number,
  cues: TranscriptCue[],
): TranscriptFile[] {
  return transcriptWindows(plan, renderedSheetCount, endSeconds).map((window) => ({
    fileName: window.fileName,
    vtt: cuesToVtt(cuesInWindow(cues, window.startSeconds, window.endSeconds)),
  }));
}
