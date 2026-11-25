import { part } from "../../dom";
import { latestCalls } from "../../latest";
import { icon, type IconName } from "../shared/icons";

export type ResultKind = "busy" | "success" | "error";

export interface ConnectionResult {
  kind: ResultKind;
  heading: string;
  lines: readonly string[];
  // What to try, on a failure.
  advice?: string;
  // What the server or the browser said, for whoever runs the server.
  detail?: string;
}

export interface ConnectionBlock {
  // Undefined when it was cleared, or another test was started, before the test ended.
  run(test: () => Promise<ConnectionResult>): Promise<ConnectionResult | undefined>;
  show(result: ConnectionResult): void;
  // Drops what is shown and whatever a running test comes back with.
  clear(): void;
}

export interface ConnectionBlockElements {
  button: HTMLButtonElement;
  // Always there, so a result put in it is announced.
  status: HTMLElement;
}

const ICONS: Record<Exclude<ResultKind, "busy">, IconName> = { success: "verify", error: "alert" };

function showOptional(el: HTMLElement, text: string | undefined): void {
  el.textContent = text ?? "";
  el.hidden = text === undefined;
}

function render(status: HTMLElement, result: ConnectionResult): void {
  const block = part(status, ".connection-result", HTMLElement);
  block.className = `connection-result is-${result.kind}`;
  const mark = part(block, ".connection-result-icon", HTMLElement);
  if (result.kind === "busy") mark.replaceChildren();
  else mark.replaceChildren(icon(ICONS[result.kind], 18));
  part(block, ".connection-result-heading", HTMLElement).textContent = result.heading;
  part(block, ".connection-result-lines", HTMLUListElement).replaceChildren(
    ...result.lines.map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }),
  );
  showOptional(part(block, ".connection-result-advice", HTMLElement), result.advice);
  showOptional(part(block, ".connection-result-detail", HTMLElement), result.detail);
  block.hidden = false;
}

export function initConnectionBlock({ button, status }: ConnectionBlockElements): ConnectionBlock {
  const start = latestCalls();
  const setBusy = (busy: boolean) => {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  };
  return {
    show: (result) => render(status, result),
    clear: () => {
      start();
      setBusy(false);
      part(status, ".connection-result", HTMLElement).hidden = true;
    },
    run: async (test) => {
      const isLatest = start();
      setBusy(true);
      render(status, { kind: "busy", heading: "Testing…", lines: [] });
      try {
        const result = await test();
        if (!isLatest()) return undefined;
        render(status, result);
        return result;
      } finally {
        if (isLatest()) setBusy(false);
      }
    },
  };
}
