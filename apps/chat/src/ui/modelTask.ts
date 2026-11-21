import type { ModelCallDeps } from "../api/modelCall";
import { isVenice } from "../api/venice";
import type { AppState } from "../state";
import { errorText } from "../text";
import type { StreamChat } from "../types";

export interface ModelTaskEls {
  status: HTMLElement;
  stopButton: HTMLButtonElement;
}

export interface ModelTask {
  running(): boolean;
  run<T>(label: string, work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined>;
  report(message: string, kind?: "info" | "error"): void;
  // Shows the status only in the chat it is about.
  sync(): void;
}

export function modelCallDeps(
  state: AppState,
  streamChat: StreamChat,
  modelId: string,
  signal: AbortSignal,
): ModelCallDeps {
  const { baseUrl, apiKey } = state.settings;
  return {
    api: { baseUrl, apiKey },
    streamChat,
    modelId,
    veniceParameters: isVenice(baseUrl),
    signal,
  };
}

// One model call at a time per panel, with a status line and a Stop button beside it.
export function createModelTask(
  els: ModelTaskEls,
  onChange: () => void,
  chatId: () => string | undefined,
): ModelTask {
  let controller: AbortController | null = null;
  let status = { owner: chatId(), message: "", kind: "info" };
  const sync = () => {
    const here = status.owner === chatId();
    els.status.textContent = here ? status.message : "";
    els.status.classList.toggle("is-error", here && status.kind === "error");
    els.stopButton.hidden = controller === null || !here;
  };
  const report = (message: string, kind: "info" | "error" = "info", owner = chatId()) => {
    status = { owner, message, kind };
    sync();
  };
  els.stopButton.addEventListener("click", () => controller?.abort());
  return {
    running: () => controller !== null,
    report: (message, kind) => report(message, kind),
    sync,
    run: async (label, work) => {
      if (controller) return undefined;
      const current = new AbortController();
      const owner = chatId();
      controller = current;
      report(label, "info", owner);
      onChange();
      try {
        const result = await work(current.signal);
        report("", "info", owner);
        return result;
      } catch (error) {
        if (current.signal.aborted) report("Stopped.", "info", owner);
        else report(errorText(error), "error", owner);
        return undefined;
      } finally {
        controller = null;
        sync();
        onChange();
      }
    },
  };
}
