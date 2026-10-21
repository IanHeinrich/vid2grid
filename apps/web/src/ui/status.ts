import type { AppElements } from "../dom";

export interface StatusLine {
  show(message: string): void;
}

export function initStatus(els: Pick<AppElements, "status">): StatusLine {
  return {
    show: (message) => {
      els.status.message.textContent = message;
    },
  };
}
