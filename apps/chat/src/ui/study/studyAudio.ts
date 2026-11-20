import {
  audioProgressText,
  ensureAudio,
  settingsLabels,
  type AudioDeps,
} from "../../audio/videoAudio";
import { errorText } from "../../text";
import type { ToolContext } from "../../video/tools";
import type { RunningPass, StudyContext } from "./context";
import { studyAudioWanted } from "./studyDialog";
import { renderAudioLine } from "./studyProgress";

function note(ctx: StudyContext, fileKey: string, text: string): void {
  ctx.audioNote = { fileKey, text };
  renderAudioLine(ctx);
}

function audioDeps(ctx: StudyContext): AudioDeps {
  return {
    store: ctx.deps.store,
    labels: settingsLabels(ctx.state.settings),
    ...(ctx.deps.analyseAudio ? { analyse: ctx.deps.analyseAudio } : {}),
  };
}

// Runs on this computer while the study waits on the model, and never fails the study.
export async function listenAlong(
  ctx: StudyContext,
  running: RunningPass,
  toolCtx: ToolContext,
): Promise<void> {
  if (!studyAudioWanted(ctx)) return;
  const { fileKey, plan, controller } = running;
  const range = {
    startSeconds: plan.windows[0]?.startSeconds ?? 0,
    endSeconds: plan.windows.at(-1)?.endSeconds ?? 0,
  };
  const source = { file: toolCtx.file, fileKey, durationSeconds: toolCtx.video.durationSeconds };
  note(ctx, fileKey, "Getting the audio ready…");
  try {
    const audio = await ensureAudio(audioDeps(ctx), source, range, {
      signal: controller.signal,
      onProgress: (progress) => note(ctx, fileKey, audioProgressText(progress)),
    });
    note(ctx, fileKey, audio.noAudio ? "The video has no audio track." : "Audio analysed.");
  } catch (error) {
    const ended = running.stopping ? "stopped" : "paused";
    note(
      ctx,
      fileKey,
      controller.signal.aborted
        ? `Audio ${ended}. What was heard is kept.`
        : `Audio not analysed: ${errorText(error)}`,
    );
  }
}
