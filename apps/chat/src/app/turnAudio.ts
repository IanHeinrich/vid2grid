import type { AudioAnalysisProgress } from "@vid2grid/core";
import { audioCoverage, audioProgressText, loadAudio, settingsLabels } from "../audio/videoAudio";
import type { HeardSpeech } from "../chat/transcript";
import type { GlobalSettings } from "../settings";
import type { AudioCoverage, ChatStore } from "../types";
import type { StatusLine } from "../ui/shared/status";
import type { ListenContext } from "../video/tools";

export interface AudioStatus {
  show: (progress: AudioAnalysisProgress) => void;
  clear: () => void;
}

interface TurnAudioBase {
  progress: AudioStatus;
  // What has been heard of the chat's video, loaded or not; absent when audio is off.
  speech?: HeardSpeech;
}

export type TurnAudio =
  | (TurnAudioBase & { on: false })
  | (TurnAudioBase & { on: true; coverage: AudioCoverage; listen: ListenContext | undefined });

export interface TurnAudioInput {
  // Audio was turned on for the message.
  on: boolean;
  // The loaded video's, or undefined when none is loaded to listen to.
  fileKey: string | undefined;
  // The chat's video, whose stored speech is sent even while its file is not loaded.
  chatVideoKey?: string | undefined;
  store: ChatStore;
  settings: Pick<GlobalSettings, "soundLabels" | "backgroundSoundLabels">;
  status: StatusLine;
  signal: AbortSignal;
}

function audioStatus(status: StatusLine): AudioStatus {
  let showing = false;
  return {
    show: (progress) => {
      showing = true;
      status.show(audioProgressText(progress));
    },
    clear: () => {
      if (showing) status.clear();
      showing = false;
    },
  };
}

export async function turnAudio(input: TurnAudioInput): Promise<TurnAudio> {
  const progress = audioStatus(input.status);
  const fileKey = input.fileKey ?? input.chatVideoKey;
  if (!input.on || fileKey === undefined) return { on: false, progress };
  const labels = settingsLabels(input.settings);
  // Audio that cannot be read only reads as not analysed yet, so the turn goes ahead without it.
  const record = await loadAudio(input.store, fileKey).catch(() => undefined);
  const base: TurnAudioBase = { progress, ...(record ? { speech: record } : {}) };
  if (input.fileKey === undefined) return { on: false, ...base };
  const coverage = audioCoverage(record, labels);
  const listen: ListenContext | undefined = coverage.canListen
    ? { store: input.store, labels, signal: input.signal, onProgress: progress.show }
    : undefined;
  return { on: true, coverage, listen, ...base };
}
