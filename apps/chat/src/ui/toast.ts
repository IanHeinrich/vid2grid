import type { AppElements } from "../dom";

const SHOWN_MS = 6000;

export interface ToastAction {
  label: string;
  run(): void;
  // Called when the toast goes away without the action being chosen, so deferred cleanup can run.
  expired?: () => void;
}

export interface ToastHandle {
  dismiss(): void;
}

export interface Toast {
  show(text: string, action?: ToastAction): ToastHandle;
  hide(): void;
}

export interface ToastTimers {
  set(run: () => void, ms: number): number;
  clear(id: number): void;
}

const windowTimers: ToastTimers = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (id) => window.clearTimeout(id),
};

// A hovered or focused toast is being read or reached for, so it waits until attention leaves.
function watchAttention(el: HTMLElement, onChange: (attended: boolean) => void): void {
  let hovered = false;
  let focused = false;
  const update = () => onChange(hovered || focused);
  el.addEventListener("mouseenter", () => {
    hovered = true;
    update();
  });
  el.addEventListener("mouseleave", () => {
    hovered = false;
    update();
  });
  el.addEventListener("focusin", () => {
    focused = true;
    update();
  });
  el.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) return;
    focused = false;
    update();
  });
}

// Everything outside an open modal dialog is inert and hidden from screen readers, so the toast
// moves into the dialog while one is open.
function followModals(el: HTMLElement): () => void {
  const home = el.parentElement;
  const place = () => {
    const target = document.querySelector("dialog[open]") ?? home;
    if (target && el.parentElement !== target) target.append(el);
  };
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("close", place);
  }
  return place;
}

export function initToast(els: Pick<AppElements, "toast">, timers = windowTimers): Toast {
  const { el, text, action, close } = els.toast;
  const place = followModals(el);
  let timer: number | null = null;
  let current: ToastAction | undefined;
  let shown = 0;
  let attended = false;
  const stopTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const expire = () => {
    const expiring = current;
    current = undefined;
    expiring?.expired?.();
  };
  const hide = () => {
    stopTimer();
    expire();
    el.classList.remove("is-visible");
    el.hidden = true;
  };
  const startTimer = () => {
    stopTimer();
    if (!el.hidden && !attended) timer = timers.set(hide, SHOWN_MS);
  };
  action.addEventListener("click", () => {
    const chosen = current;
    current = undefined;
    hide();
    chosen?.run();
  });
  close.addEventListener("click", hide);
  watchAttention(el, (now) => {
    attended = now;
    if (attended) stopTimer();
    else startTimer();
  });
  return {
    show: (message, nextAction) => {
      expire();
      const id = ++shown;
      current = nextAction;
      text.textContent = message;
      action.hidden = !nextAction;
      action.textContent = nextAction?.label ?? "";
      place();
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add("is-visible"));
      startTimer();
      return {
        dismiss: () => {
          if (id === shown && !el.hidden) hide();
        },
      };
    },
    hide,
  };
}
