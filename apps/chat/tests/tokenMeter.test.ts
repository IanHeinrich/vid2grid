import { beforeEach, describe, expect, it } from "vitest";
import { blankChat } from "../src/chat/chats";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setCurrentChat, setModels, type AppState } from "../src/state";
import type { ModelInfo } from "../src/types";
import { initUsageMeter } from "../src/ui/shell/tokenMeter";
import { model as baseModel } from "./support/factories";
import { mountPage } from "./support/page";
import { MESSAGES } from "./support/usageFixtures";

let els: AppElements;
let state: AppState;

function model(extra: Partial<ModelInfo> = {}): ModelInfo {
  return baseModel("m", { name: "M", contextTokens: 256_000, ...extra });
}

beforeEach(() => {
  els = mountPage();
  state = createAppState({ ...DEFAULT_SETTINGS, apiKey: "key" });
});

describe("initUsageMeter", () => {
  function meterFor(info: ModelInfo): void {
    setModels(state, [info]);
    setCurrentChat(state, blankChat("m", "chat", 1), MESSAGES);
    initUsageMeter(els, state, { timeline: () => undefined, toolsAvailable: () => false });
  }

  it("shows the context estimate against the window and the chat totals", () => {
    meterFor(model());
    expect(els.header.usageContext.textContent).toMatch(/^Context ≈ \S+ \/ 256k$/);
    expect(els.header.usageTotals.textContent).toBe(" · 412k in · 18k out");
    expect(els.header.usageLine.title).toContain("This chat: 412k input (2k cached), 18k output");
  });

  it("adds the cost only when the model has pricing", () => {
    meterFor(model({ pricing: { inputPerMTok: 0.5, outputPerMTok: 2 } }));
    expect(els.header.usageTotals.textContent).toBe(" · 412k in · 18k out · ≈ $0.24");
  });

  it("colours a nearly full context and suggests making room", () => {
    meterFor(model({ contextTokens: 2 }));
    expect(els.header.usageContext.classList.contains("is-danger")).toBe(true);
    expect(els.header.usageLine.title).toContain("Unpin images");
  });
});
