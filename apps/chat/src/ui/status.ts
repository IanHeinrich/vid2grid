import type { AppElements } from "../dom";

export interface StatusLine {
  show(message: string, kind?: "info" | "error"): void;
  clear(): void;
}

export function initStatus(els: Pick<AppElements, "status">): StatusLine {
  const { message } = els.status;
  return {
    show: (text, kind = "info") => {
      message.textContent = text;
      message.classList.toggle("is-error", kind === "error");
    },
    clear: () => {
      message.textContent = "";
      message.classList.remove("is-error");
    },
  };
}
