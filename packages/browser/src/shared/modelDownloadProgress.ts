import type { PreTrainedModel } from "@huggingface/transformers";

const PERCENT_TOTAL = 100;

// transformers.js does not export its progress types from the package root.
type LoadOptions = NonNullable<Parameters<typeof PreTrainedModel.from_pretrained>[1]>;
export type ModelLoadCallback = NonNullable<LoadOptions["progress_callback"]>;

// Weighted by bytes, not averaged per file, so the tiny configs don't get equal billing with
// the weights.
export function modelDownloadProgress(onPercent: (percent: number) => void): ModelLoadCallback {
  const fileBytes = new Map<string, { loaded: number; total: number }>();
  return (info) => {
    if (info.status === "progress") {
      fileBytes.set(info.file, { loaded: info.loaded, total: info.total });
    } else if (info.status === "done") {
      const known = fileBytes.get(info.file);
      fileBytes.set(info.file, { loaded: known?.total ?? 1, total: known?.total ?? 1 });
    } else {
      return;
    }
    let loaded = 0;
    let total = 0;
    for (const file of fileBytes.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    onPercent(total > 0 ? (loaded / total) * PERCENT_TOTAL : 0);
  };
}
