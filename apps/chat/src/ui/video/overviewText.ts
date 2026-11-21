import type { OverviewStatus } from "../../state";
import { formatTimestamp } from "../../time";
import type { VideoAttachment } from "../../types";

export const NEEDS_MODEL_TEXT = "Choose a model to prepare the overview";
export const REUSED_TEXT = "Seen before, overview reused";

// A finished overview needs no label unless it was reused, which would otherwise look instant.
export function overviewText(status: OverviewStatus | undefined): string {
  switch (status?.kind) {
    case undefined:
      return "";
    case "needsModel":
      return NEEDS_MODEL_TEXT;
    case "ready":
      return status.reused ? REUSED_TEXT : "";
    case "rendering":
      return status.total > 0
        ? `Overview ${Math.round((status.done / status.total) * 100)}%`
        : "Rendering overview";
    case "failed":
      return "Overview failed";
  }
}

export function videoSummary(video: VideoAttachment): string {
  return `${video.name} · ${formatTimestamp(video.durationSeconds)}`;
}
