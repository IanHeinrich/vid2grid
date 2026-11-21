import { isVenice } from "../api/venice";
import type { AppElements } from "../dom";
import { chatModelId, defaultModelId, type AppState } from "../state";
import type { ChatStore } from "../types";
import { lastTestPassed } from "./connectionTest";
import { icon } from "./icons";

const DISMISSED_KEY = "vid2grid-chat-welcome-dismissed";

export type WelcomeStep = "key" | "test" | "model" | "media";

const STEPS: readonly WelcomeStep[] = ["key", "test", "model", "media"];

export interface Welcome {
  render(): void;
}

export interface WelcomeDeps {
  store: Pick<ChatStore, "listMessages">;
  onOpenSettings(): void;
  onTestConnection(): void;
  storage?: Storage;
}

interface WelcomeContext {
  els: AppElements["welcome"];
  state: AppState;
  deps: WelcomeDeps;
  storage: Storage;
  scanned: Set<string>;
  scanning: boolean;
  chatted: boolean;
}

function isStep(value: string | undefined): value is WelcomeStep {
  return STEPS.some((step) => step === value);
}

function hasMedia(state: AppState): boolean {
  return (
    state.chats.some((chat) => chat.video !== undefined) ||
    [...state.pending.values()].some((attachments) => attachments.length > 0) ||
    state.messages.some(
      (message) =>
        message.role === "user" && (message.images.length > 0 || message.video !== undefined),
    )
  );
}

function needsKey(state: AppState): boolean {
  const { apiKey, baseUrl } = state.settings;
  return isVenice(baseUrl) && apiKey.trim() === "";
}

export function keyStepLabel(state: AppState): string {
  return needsKey(state) ? "Add your API key" : "Choose an API";
}

export function completedSteps(state: AppState, testPassed: boolean): Set<WelcomeStep> {
  const chat = state.currentChat;
  const chosen = chat ? chatModelId(state, chat) : defaultModelId(state);
  const done: Record<WelcomeStep, boolean> = {
    key: state.settings.baseUrl.trim() !== "" && !needsKey(state),
    test: testPassed,
    model: state.models.some((model) => model.id === chosen),
    media: hasMedia(state),
  };
  return new Set(STEPS.filter((step) => done[step]));
}

export function initWelcome(
  els: Pick<AppElements, "welcome">,
  state: AppState,
  deps: WelcomeDeps,
): Welcome {
  const ctx: WelcomeContext = {
    els: els.welcome,
    state,
    deps,
    storage: deps.storage ?? localStorage,
    scanned: new Set(),
    scanning: false,
    chatted: false,
  };
  const { el, dismiss, steps } = els.welcome;
  dismiss.addEventListener("click", () => {
    ctx.storage.setItem(DISMISSED_KEY, "1");
    el.hidden = true;
  });
  for (const item of steps.querySelectorAll<HTMLElement>("[data-step]")) {
    const action = item.querySelector<HTMLButtonElement>(".welcome-action");
    const step = item.dataset["step"];
    action?.addEventListener("click", () => {
      if (step === "test") deps.onTestConnection();
      else deps.onOpenSettings();
    });
  }
  render(ctx);
  return { render: () => render(ctx) };
}

// Hidden until every chat is known to be empty, so returning users never see it flash.
function render(ctx: WelcomeContext): void {
  const { state, els } = ctx;
  if (state.messages.length > 0) ctx.chatted = true;
  const unscanned = state.chats.filter((chat) => !ctx.scanned.has(chat.id));
  if (!ctx.chatted && unscanned.length > 0) {
    els.el.hidden = true;
    void scan(
      ctx,
      unscanned.map((chat) => chat.id),
    );
    return;
  }
  const done = completedSteps(state, lastTestPassed(ctx.storage));
  const dismissed = ctx.storage.getItem(DISMISSED_KEY) !== null;
  els.el.hidden = ctx.chatted || dismissed || done.size === STEPS.length;
  if (els.el.hidden) return;
  for (const item of els.steps.querySelectorAll<HTMLElement>("[data-step]")) {
    const step = item.dataset["step"];
    const isDone = isStep(step) && done.has(step);
    item.classList.toggle("is-done", isDone);
    item.querySelector(".welcome-check")?.replaceChildren(...(isDone ? [icon("check", 14)] : []));
    const action = item.querySelector<HTMLButtonElement>(".welcome-action");
    if (action) action.hidden = isDone;
    const label = item.querySelector(".welcome-label");
    if (step === "key" && label) label.textContent = keyStepLabel(state);
  }
}

async function scan(ctx: WelcomeContext, chatIds: readonly string[]): Promise<void> {
  if (ctx.scanning) return;
  ctx.scanning = true;
  try {
    for (const id of chatIds) {
      ctx.scanned.add(id);
      if ((await ctx.deps.store.listMessages(id)).length > 0) {
        ctx.chatted = true;
        break;
      }
    }
  } catch {
    // Unreadable history is treated as history: the checklist is only for a fresh start.
    ctx.chatted = true;
  } finally {
    ctx.scanning = false;
  }
  render(ctx);
}
