import { overviewFor, pendingFor, pendingVideo } from "../../state";
import { formatTimestamp } from "../../time";
import { currentShownVideo, isMissing, type VideoPanelContext } from "./context";
import { overviewText } from "./overviewText";

export function renderChip(ctx: VideoPanelContext): void {
  const { chip, chipName, chipMeta } = ctx.els.video;
  const chat = ctx.state.currentChat;
  const video = currentShownVideo(ctx);
  chip.hidden = !chat || !video;
  if (!chat || !video) return;
  const missing = isMissing(ctx);
  chip.classList.toggle("is-missing", missing);
  chipName.textContent = video.name;
  const status = overviewFor(ctx.state, chat.id);
  const pending = pendingVideo(pendingFor(ctx.state, chat.id)) !== undefined;
  const overview = status?.kind === "ready" && !pending ? "" : overviewText(status);
  const study = ctx.deps.studyStatus();
  const copy = ctx.deps.copyStatus(video.fileKey);
  const audio = ctx.audioPrep?.chatId === chat.id ? ctx.audioPrep.text : "";
  chipMeta.textContent = missing
    ? "Reattach"
    : [formatTimestamp(video.durationSeconds), overview, study, audio, copy]
        .filter((part) => part !== "")
        .join(" · ");
  chip.title = missing
    ? `${video.name} is not loaded. Click to reattach it.`
    : `Open ${video.name} in the player`;
}
