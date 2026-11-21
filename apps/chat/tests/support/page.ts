import { vi } from "vitest";
import indexHtml from "../../index.html?raw";
import { queryElements, type AppElements } from "../../src/dom";
import { initToast, type Toast } from "../../src/ui/shared/toast";

export function mountPage(): AppElements {
  document.body.innerHTML = indexHtml;
  return queryElements();
}

export function stillToast(els: AppElements): Toast {
  return initToast(els, { set: () => 0, clear: vi.fn() });
}
