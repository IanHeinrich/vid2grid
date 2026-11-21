import { beforeEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { ApiError, VENICE_BASE_URL } from "../src/api/client";
import { queryElements, type AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setSettings, type AppState } from "../src/state";
import type { ModelInfo } from "../src/types";
import {
  initConnectionTest,
  lastTestPassed,
  NO_API_TEXT,
  reportLines,
  testConnection,
  type ConnectionProbes,
} from "../src/ui/connectionTest";

const VENICE = { baseUrl: VENICE_BASE_URL, apiKey: "key" };
const LOCAL = { baseUrl: "http://localhost:11434/v1", apiKey: "" };

function model(id: string, vision: boolean): ModelInfo {
  return {
    id,
    name: id,
    vision,
    tools: true,
    reasoning: false,
    reasoningEffortOptions: [],
    maxImages: 10,
    privacy: "private",
    traits: [],
    uncensored: false,
    recommended: false,
    beta: false,
    videoInput: false,
    audioInput: false,
    e2ee: false,
  };
}

const MODELS = [model("a", true), model("b", false), model("c", true)];

function probes(overrides: Partial<ConnectionProbes> = {}): ConnectionProbes {
  return {
    listModels: () => Promise.resolve(MODELS),
    getBalance: () => Promise.resolve({ unavailable: "needsAdminKey" }),
    ...overrides,
  };
}

describe("testConnection", () => {
  it("reports an inference key when the balance needs an admin key", async () => {
    const report = await testConnection(VENICE, probes());
    expect(reportLines(report)).toEqual([
      "Reachable: the server answered.",
      "3 models, 2 of them can see images.",
      "The server is Venice.",
      "Inference key: chat works, but reading the balance needs an admin key.",
    ]);
  });

  it("reports an admin key when the balance can be read", async () => {
    const report = await testConnection(
      VENICE,
      probes({
        getBalance: () => Promise.resolve({ canConsume: true, consumptionCurrency: "USD" }),
      }),
    );
    expect(report).toEqual(expect.objectContaining({ reachable: true, key: "admin" }));
    expect(reportLines(report)).toContain("Admin key: the balance can be read.");
  });

  it("says why the balance could not be read", async () => {
    const report = await testConnection(
      VENICE,
      probes({ getBalance: () => Promise.resolve({ unavailable: "error", message: "Timed out" }) }),
    );
    expect(reportLines(report)).toContain("Could not read the balance: Timed out");
  });

  it("reports an unreachable server with the error", async () => {
    const report = await testConnection(
      VENICE,
      probes({ listModels: () => Promise.reject(new ApiError(401, "Invalid API key")) }),
    );
    expect(report.reachable).toBe(false);
    expect(reportLines(report)).toEqual(["Not reachable: Invalid API key"]);
  });

  it("skips the key check on a server that is not Venice", async () => {
    const getBalance = vi.fn(() => Promise.resolve({ unavailable: "notVenice" as const }));
    const report = await testConnection(
      LOCAL,
      probes({ listModels: () => Promise.resolve([model("llava", true)]), getBalance }),
    );
    expect(reportLines(report)).toEqual([
      "Reachable: the server answered.",
      "1 model, 1 of them can see images.",
      "This server does not report a balance.",
    ]);
  });

  it("says when the server lists no models", async () => {
    const report = await testConnection(LOCAL, probes({ listModels: () => Promise.resolve([]) }));
    expect(reportLines(report)).toContain("The server lists no models.");
  });
});

describe("initConnectionTest", () => {
  let els: AppElements;
  let state: AppState;

  beforeEach(() => {
    document.body.innerHTML = indexHtml;
    els = queryElements();
    state = createAppState(DEFAULT_SETTINGS);
    localStorage.clear();
  });

  function reportText(): string[] {
    return [...els.connectionTest.report.querySelectorAll("li")].map((li) => li.textContent ?? "");
  }

  it("asks for an API without calling anything while no base URL is typed", async () => {
    setSettings(state, { ...state.settings, baseUrl: VENICE_BASE_URL });
    const listModels = vi.fn(() => Promise.resolve(MODELS));
    const test = initConnectionTest(els, state, { probes: probes({ listModels }) });
    els.settingsDialog.baseUrlInput.value = " ";
    await test.run();
    expect(listModels).not.toHaveBeenCalled();
    expect(reportText()).toEqual([NO_API_TEXT]);
    expect(els.connectionTest.report.classList.contains("is-failed")).toBe(true);
  });

  it("tests the key and base URL typed in the dialog and remembers a pass", async () => {
    setSettings(state, { ...state.settings, baseUrl: "http://localhost:1234/v1" });
    const listModels = vi.fn(() => Promise.resolve(MODELS));
    const onTested = vi.fn();
    const test = initConnectionTest(els, state, {
      probes: probes({ listModels }),
      storage: localStorage,
      onTested,
    });
    els.settingsDialog.apiKeyInput.value = " typed-key ";
    els.settingsDialog.baseUrlInput.value = ` ${VENICE_BASE_URL} `;
    await test.run();
    expect(listModels).toHaveBeenCalledWith({ apiKey: "typed-key", baseUrl: VENICE_BASE_URL });
    expect(reportText()[0]).toBe("Reachable: the server answered.");
    expect(els.connectionTest.report.hidden).toBe(false);
    expect(lastTestPassed(localStorage)).toBe(true);
    expect(onTested).toHaveBeenCalledWith(true);
  });

  it("marks a failed test and forgets an earlier pass", async () => {
    localStorage.setItem("vid2grid-chat-connection-test", "passed");
    els.settingsDialog.baseUrlInput.value = LOCAL.baseUrl;
    initConnectionTest(els, state, {
      probes: probes({ listModels: () => Promise.reject(new Error("Failed to fetch")) }),
      storage: localStorage,
    });
    els.connectionTest.button.click();
    await vi.waitFor(() => expect(reportText()).toEqual(["Not reachable: Failed to fetch"]));
    expect(els.connectionTest.report.classList.contains("is-failed")).toBe(true);
    expect(lastTestPassed(localStorage)).toBe(false);
    expect(els.connectionTest.button.disabled).toBe(false);
  });
});
