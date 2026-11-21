import type { AudioAnalysisProgress } from "@vid2grid/core";
import {
  AUDIO_PIECE_SECONDS,
  audioProgressText,
  ensureAudio,
  settingsLabels,
  type AudioDeps,
} from "../../audio/videoAudio";
import { shownVideo } from "../../state";
import type { ToolContext } from "../../video/tools";
import { renderChip } from "./chip";
import { isCurrent, type AudioPrep, type VideoPanelContext } from "./context";

function stopAudioPrep(ctx: VideoPanelContext): void {
  ctx.audioPrep?.controller.abort();
  ctx.audioPrep = undefined;
}

export function dropStaleAudio(ctx: VideoPanelContext): void {
  const prep = ctx.audioPrep;
  if (!prep) return;
  const still =
    isCurrent(ctx, prep.chatId) && shownVideo(ctx.state, prep.chatId)?.fileKey === prep.fileKey;
  if (!still) stopAudioPrep(ctx);
}

function showAudioPrep(ctx: VideoPanelContext, prep: AudioPrep, text: string): void {
  if (ctx.audioPrep !== prep) return;
  prep.text = text;
  if (isCurrent(ctx, prep.chatId)) renderChip(ctx);
}

// Analysed ahead so a later turn can listen without waiting; a failure here stays quiet.
export function prepareAudio(ctx: VideoPanelContext, chatId: string, toolCtx: ToolContext): void {
  if (!ctx.deps.audioWanted() || !isCurrent(ctx, chatId)) return;
  stopAudioPrep(ctx);
  const prep: AudioPrep = {
    chatId,
    fileKey: toolCtx.video.fileKey,
    controller: new AbortController(),
    text: "Getting the audio ready…",
  };
  ctx.audioPrep = prep;
  renderChip(ctx);
  void hearWholeVideo(ctx, prep, toolCtx)
    .catch(() => undefined)
    .finally(() => {
      if (ctx.audioPrep !== prep) return;
      ctx.audioPrep = undefined;
      if (isCurrent(ctx, chatId)) renderChip(ctx);
    });
}

function piecePrefix(index: number, pieces: number): string {
  return pieces > 1 ? `Audio ${index + 1} of ${pieces}: ` : "";
}

// One piece per call, so a turn's listen call can run between pieces instead of after them all.
async function hearWholeVideo(
  ctx: VideoPanelContext,
  prep: AudioPrep,
  toolCtx: ToolContext,
): Promise<void> {
  const deps: AudioDeps = {
    store: ctx.deps.store,
    labels: settingsLabels(ctx.state.settings),
    ...(ctx.deps.analyseAudio ? { analyse: ctx.deps.analyseAudio } : {}),
  };
  const durationSeconds = toolCtx.video.durationSeconds;
  const source = { file: toolCtx.file, fileKey: prep.fileKey, durationSeconds };
  const pieces = Math.max(1, Math.ceil(durationSeconds / AUDIO_PIECE_SECONDS));
  for (let index = 0; index < pieces; index++) {
    const range = {
      startSeconds: index * AUDIO_PIECE_SECONDS,
      endSeconds: Math.min(durationSeconds, (index + 1) * AUDIO_PIECE_SECONDS),
    };
    const onProgress = (progress: AudioAnalysisProgress) =>
      showAudioPrep(ctx, prep, `${piecePrefix(index, pieces)}${audioProgressText(progress)}`);
    const audio = await ensureAudio(deps, source, range, {
      signal: prep.controller.signal,
      onProgress,
    });
    if (audio.noAudio) return;
  }
}
