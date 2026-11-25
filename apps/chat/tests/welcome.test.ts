import { beforeEach, describe, expect, it, vi } from "vitest";
import { VENICE_BASE_URL } from "../src/api/venice";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  addPending,
  createAppState,
  setChats,
  setCurrentChat,
  setModels,
  setSettings,
  type AppState,
} from "../src/state";
import type { Chat, ChatStore } from "../src/types";
import {
  completedSteps,
  initWelcome,
  keyStepLabel,
  type WelcomeDeps,
} from "../src/ui/shell/welcome";
import { model } from "./support/factories";
import { mountPage } from "./support/page";

let els: AppElements;
let state: AppState;
let store: ChatStore;
let deps: WelcomeDeps;
let onOpenSettings: ReturnType<typeof vi.fn>;
let onTestConnection: ReturnType<typeof vi.fn>;

function chat(id: string, extra: Partial<Chat> = {}): Chat {
  return { ...blankChat(DEFAULT_SETTINGS.defaultModelId, id, 1), ...extra };
}

function doneSteps(): string[] {
  return [...els.welcome.steps.querySelectorAll<HTMLElement>(".welcome-step.is-done")].map(
    (item) => item.dataset["step"] ?? "",
  );
}

function stepAction(step: string): HTMLButtonElement {
  const button = els.welcome.steps.querySelector<HTMLButtonElement>(
    `[data-step="${step}"] .welcome-action`,
  );
  if (!button) throw new Error(`No action for ${step}`);
  return button;
}

beforeEach(() => {
  els = mountPage();
  state = createAppState(DEFAULT_SETTINGS);
  store = createMemoryStore();
  localStorage.clear();
  onOpenSettings = vi.fn();
  onTestConnection = vi.fn();
  deps = { store, onOpenSettings, onTestConnection, storage: localStorage };
});

describe("completedSteps", () => {
  it("ticks each step from the state", () => {
    expect([...completedSteps(state, false)]).toEqual([]);
    setSettings(state, { ...state.settings, baseUrl: VENICE_BASE_URL, apiKey: "key" });
    setModels(state, [model("listed")]);
    expect([...completedSteps(state, true)]).toEqual(["key", "test", "model"]);
    const video = { name: "v.mp4", fileKey: "v", durationSeconds: 1, width: 1, height: 1 };
    setChats(state, [chat("a", { video })]);
    expect(completedSteps(state, true).has("media")).toBe(true);
  });

  it("counts a model that cannot see images only with a looking model", () => {
    const blind = model("blind", { vision: false });
    const looking = { ...DEFAULT_SETTINGS, defaultModelId: "blind", defaultLookingModelId: "eyes" };
    const without = createAppState({ ...looking, defaultLookingModelId: "" });
    setModels(without, [blind]);
    expect(completedSteps(without, false).has("model")).toBe(false);
    const withOne = createAppState(looking);
    setModels(withOne, [blind]);
    expect(completedSteps(withOne, false).has("model")).toBe(true);
    setCurrentChat(withOne, blankChat("blind", "a", 1), []);
    expect(completedSteps(withOne, false).has("model")).toBe(false);
    setCurrentChat(withOne, blankChat("blind", "a", 1, "eyes"), []);
    expect(completedSteps(withOne, false).has("model")).toBe(true);
  });

  it("needs no key for a server that is not Venice", () => {
    setSettings(state, { ...state.settings, baseUrl: "http://localhost:1234/v1" });
    expect(completedSteps(state, false).has("key")).toBe(true);
    expect(keyStepLabel(state)).toBe("Choose an API");
  });

  it("asks for an API first, and for a key only on Venice", () => {
    setSettings(state, { ...state.settings, apiKey: "key" });
    expect(completedSteps(state, false).has("key")).toBe(false);
    expect(keyStepLabel(state)).toBe("Choose an API");
    setSettings(state, { ...state.settings, baseUrl: VENICE_BASE_URL, apiKey: "" });
    expect(completedSteps(state, false).has("key")).toBe(false);
    expect(keyStepLabel(state)).toBe("Add your API key");
  });

  it("ticks the model step from the current chat's model, as the composer sees it", () => {
    setSettings(state, { ...state.settings, baseUrl: "http://localhost:1234/v1" });
    setCurrentChat(state, chat("a"), []);
    expect(completedSteps(state, false).has("model")).toBe(false);
    setModels(state, [model("listed")]);
    expect(completedSteps(state, false).has("model")).toBe(true);
    setCurrentChat(
      state,
      { ...chat("b"), settings: { ...chat("b").settings, modelId: "gone" } },
      [],
    );
    expect(completedSteps(state, false).has("model")).toBe(false);
  });

  it("counts images waiting in the composer as media", () => {
    setChats(state, [chat("a")]);
    const ref = { id: "img", source: { kind: "upload" as const, name: "a.jpg" }, pinned: false };
    addPending(state, "a", { kind: "image", ref });
    expect(completedSteps(state, false).has("media")).toBe(true);
  });
});

describe("initWelcome", () => {
  it("shows the checklist on a fresh start, with the finished steps ticked", async () => {
    setSettings(state, { ...state.settings, baseUrl: VENICE_BASE_URL, apiKey: "key" });
    setChats(state, [chat("a")]);
    initWelcome(els, state, deps);
    await vi.waitFor(() => expect(els.welcome.el.hidden).toBe(false));
    expect(doneSteps()).toEqual(["key"]);
    expect(stepAction("key").hidden).toBe(true);
    expect(stepAction("test").hidden).toBe(false);
  });

  it("ticks a passed connection test once it is re-rendered", async () => {
    const welcome = initWelcome(els, state, deps);
    localStorage.setItem("vid2grid-chat-connection-test", "passed");
    welcome.render();
    await vi.waitFor(() => expect(doneSteps()).toEqual(["test"]));
  });

  it("stays hidden when any chat already has messages", async () => {
    await store.putChat(chat("b"));
    await store.putMessage("b", { id: "m", createdAt: 1, role: "user", text: "hi", images: [] });
    setChats(state, [chat("a"), chat("b")]);
    const listMessages = vi.spyOn(store, "listMessages");
    initWelcome(els, state, deps);
    expect(els.welcome.el.hidden).toBe(true);
    await vi.waitFor(() => expect(listMessages).toHaveBeenCalledWith("b"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(els.welcome.el.hidden).toBe(true);
  });

  it("hides once every step is done", () => {
    setSettings(state, { ...state.settings, baseUrl: VENICE_BASE_URL, apiKey: "key" });
    setModels(state, [model("listed")]);
    localStorage.setItem("vid2grid-chat-connection-test", "passed");
    addPending(state, "a", {
      kind: "image",
      ref: { id: "img", source: { kind: "upload", name: "a.jpg" }, pinned: false },
    });
    initWelcome(els, state, deps);
    expect(els.welcome.el.hidden).toBe(true);
  });

  it("remembers being dismissed", () => {
    initWelcome(els, state, deps);
    expect(els.welcome.el.hidden).toBe(false);
    els.welcome.dismiss.click();
    expect(els.welcome.el.hidden).toBe(true);
    els = mountPage();
    initWelcome(els, state, deps);
    expect(els.welcome.el.hidden).toBe(true);
  });

  it("opens settings for the key and model steps and runs the test for the test step", () => {
    initWelcome(els, state, deps);
    stepAction("key").click();
    stepAction("model").click();
    expect(onOpenSettings).toHaveBeenCalledTimes(2);
    stepAction("test").click();
    expect(onTestConnection).toHaveBeenCalledTimes(1);
  });
});

describe("welcome key step", () => {
  it("is labelled from the chosen API", () => {
    initWelcome(els, state, deps);
    const label = els.welcome.steps.querySelector('[data-step="key"] .welcome-label');
    expect(label?.textContent).toBe("Choose an API");
  });
});
