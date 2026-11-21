import { chatModel, sheetContext } from "../../app/toolContext";
import { overviewFor, setOverviewStatus, shownVideo, type OverviewStatus } from "../../state";
import { errorText } from "../../text";
import { renderSheets } from "../../video/render";
import { renderOverview, type ToolContext } from "../../video/tools";
import { prepareAudio } from "./audioPrep";
import { renderChip } from "./chip";
import { isCurrent, sheetSource, type VideoPanelContext } from "./context";
import { NEEDS_MODEL_TEXT } from "./overviewText";

// An overview waiting for a model starts once the chat has one.
export function startWaitingOverviews(ctx: VideoPanelContext): void {
  for (const [chatId, status] of ctx.state.overviews) {
    const chat = ctx.state.chats.find((entry) => entry.id === chatId);
    if (status.kind !== "needsModel" || overviewFor(ctx.state, chatId) !== status) continue;
    if (chat && chatModel(ctx.state, chat) !== null) startOverview(ctx, chatId);
  }
}

export function startOverview(ctx: VideoPanelContext, chatId: string): void {
  const chat = ctx.state.chats.find((entry) => entry.id === chatId);
  const source = sheetSource(ctx, chatId);
  if (!chat || !source) return;
  const key = source.video.fileKey;
  const stillShown = () => shownVideo(ctx.state, chatId)?.fileKey === key;
  const report = (status: OverviewStatus) => {
    if (!stillShown()) return;
    setOverviewStatus(ctx.state, chatId, status);
    if (isCurrent(ctx, chatId)) renderChip(ctx);
    ctx.deps.onOverviewProgress();
  };
  const model = chatModel(ctx.state, chat);
  if (model === null) {
    report({ kind: "needsModel", fileKey: key });
    if (isCurrent(ctx, chatId)) ctx.deps.status.show(`${NEEDS_MODEL_TEXT}.`);
    return;
  }
  let rendered = false;
  const renderFresh = ctx.deps.renderSheets ?? renderSheets;
  const toolCtx: ToolContext = {
    ...sheetContext(chat, model, source, ctx.deps.store),
    render: (...args) => {
      rendered = true;
      return renderFresh(...args);
    },
  };
  const render = ctx.deps.renderOverview ?? renderOverview;
  report({ kind: "rendering", fileKey: key, done: 0, total: 0 });
  const done = render(toolCtx, (finished, total) => {
    report({ kind: "rendering", fileKey: key, done: finished, total });
  })
    .then((refs) => {
      if (!stillShown()) return;
      report({
        kind: "ready",
        fileKey: key,
        sheets: refs.length,
        ...(rendered ? {} : { reused: true as const }),
      });
      ctx.deps.onOverview(chatId, refs);
      prepareAudio(ctx, chatId, toolCtx);
    })
    .catch((error: unknown) => {
      report({ kind: "failed", fileKey: key, error: errorText(error) });
    })
    .finally(() => {
      if (ctx.renders.get(chatId)?.done === done) ctx.renders.delete(chatId);
    });
  ctx.renders.set(chatId, { fileKey: key, done });
}
