import {
  describeAudioCoverage,
  loadAudio,
  onAudioChanged,
  settingsLabels,
  timedAudioLines,
  type TimedAudioLine,
} from "../../audio/videoAudio";
import { errorText } from "../../text";
import { seekButton } from "../shared/buttons";
import { seekShown, shownVideo, type StudyContext } from "./context";

const SHOWN_LINES = 20;

export function listenAudioList(ctx: StudyContext): void {
  ctx.els.audioMore.addEventListener("click", () => {
    ctx.showAllAudio = shownVideo(ctx)?.video.fileKey;
    renderAudioList(ctx);
  });
  onAudioChanged((audio) => {
    ctx.heard.set(audio.fileKey, audio);
    if (audio.fileKey === shownVideo(ctx)?.video.fileKey) renderAudioList(ctx);
  });
}

export function renderAudioList(ctx: StudyContext): void {
  const shown = shownVideo(ctx);
  const { audioSection, audioTitle, audioCoverage, audioList, audioMore } = ctx.els;
  audioSection.hidden = shown === undefined;
  if (!shown) return;
  const { fileKey: key, name, durationSeconds } = shown.video;
  audioTitle.textContent = `Audio for ${name}`;
  if (!ctx.heard.has(key)) loadHeard(ctx, key);
  const audio = ctx.heard.get(key);
  const labels = settingsLabels(ctx.state.settings);
  const coverage = describeAudioCoverage(audio, labels);
  audioCoverage.textContent = `${coverage.charAt(0).toUpperCase()}${coverage.slice(1)}.`;
  const range = { startSeconds: 0, endSeconds: durationSeconds };
  const lines = audio ? timedAudioLines(audio, range, labels) : [];
  const shownLines = ctx.showAllAudio === key ? lines : lines.slice(0, SHOWN_LINES);
  const seek = seekShown(ctx);
  audioList.replaceChildren(...shownLines.map((line) => audioItem(line, seek)));
  audioMore.hidden = shownLines.length === lines.length;
  audioMore.textContent = `Show all ${lines.length}`;
}

function loadHeard(ctx: StudyContext, key: string): void {
  ctx.heard.set(key, undefined);
  loadAudio(ctx.deps.store, key).catch((error: unknown) => {
    ctx.deps.status.show(`Could not load the audio: ${errorText(error)}`, "error");
  });
}

function audioItem(
  { startSeconds, line }: TimedAudioLine,
  seek: (seconds: number) => void,
): HTMLLIElement {
  const item = document.createElement("li");
  const close = line.indexOf("]") + 1;
  const time = seekButton(startSeconds, seek, line.slice(0, close));
  const text = document.createElement("span");
  text.className = "timeline-text";
  text.textContent = line.slice(close);
  item.append(time, text);
  return item;
}
