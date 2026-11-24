import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { VENICE_BASE_URL } from "../src/api/venice";
import type { AppElements } from "../src/dom";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createAppState, setSettings, type AppState } from "../src/state";
import type { ApiSettings, ModelInfo } from "../src/types";
import type { ConnectionResult } from "../src/ui/settings/connectionBlock";
import {
  connectionResult,
  initConnectionTest,
  lastTestPassed,
  NO_API_TEXT,
  testConnection,
  type ConnectionProbes,
} from "../src/ui/settings/connectionTest";
import { KEY_NOT_CHECKED } from "../src/ui/settings/keyCheck";
import { model as baseModel } from "./support/factories";
import { mountPage } from "./support/page";

const VENICE = { baseUrl: VENICE_BASE_URL, apiKey: "key" };
const LOCAL = { baseUrl: "http://localhost:11434/v1", apiKey: "" };

function model(id: string, vision: boolean): ModelInfo {
  return baseModel(id, { vision });
}

const MODELS = [model("a", true), model("b", false), model("c", true)];

function probes(overrides: Partial<ConnectionProbes> = {}): ConnectionProbes {
  return {
    listModels: () => Promise.resolve(MODELS),
    getBalance: () => Promise.resolve({ unavailable: "needsAdminKey" }),
    ...overrides,
  };
}

// Lists its models only to a key it accepts, as a server that can tell keys apart does.
function keyed(models: ModelInfo[]) {
  return (api: ApiSettings) =>
    api.apiKey === "" ? Promise.reject(new ApiError(401, "no key")) : Promise.resolve(models);
}

async function resultOf(
  api: ApiSettings,
  overrides: Partial<ConnectionProbes> = {},
  looking = false,
): Promise<ConnectionResult> {
  return connectionResult(api, await testConnection(api, probes(overrides), looking));
}

const fails = (error: Error) => ({ listModels: () => Promise.reject(error) });

describe("connectionResult", () => {
  it("names the host, the models and an inference key", async () => {
    expect(await resultOf(VENICE, { listModels: keyed(MODELS) })).toEqual({
      kind: "success",
      heading: "Connected",
      lines: [
        "api.venice.ai",
        "3 models, 2 of them can see images.",
        "Inference key: chat works, but reading the balance needs an admin key.",
      ],
    });
  });

  it("reports an admin key when the balance can be read", async () => {
    const { lines } = await resultOf(VENICE, {
      getBalance: () => Promise.resolve({ canConsume: true, consumptionCurrency: "USD" }),
    });
    expect(lines).toContain("Admin key: the balance can be read.");
  });

  it("says why the balance could not be read", async () => {
    const { lines } = await resultOf(VENICE, {
      getBalance: () => Promise.resolve({ unavailable: "error", message: "Timed out" }),
    });
    expect(lines).toContain("Could not read the balance: Timed out");
  });

  it("skips the key check on a server that is not Venice", async () => {
    const { lines } = await resultOf(LOCAL, {
      listModels: () => Promise.resolve([model("llava", true)]),
      getBalance: () => Promise.resolve({ unavailable: "notVenice" }),
    });
    expect(lines).toEqual([
      "localhost:11434",
      "1 model. The server does not say which can see images.",
      "This server does not report a balance.",
    ]);
  });

  it("says when the server lists no models", async () => {
    const { lines } = await resultOf(LOCAL, { listModels: () => Promise.resolve([]) });
    expect(lines).toContain("The server lists no models.");
  });

  it("says the others can write, when a looking model is chosen", async () => {
    const { lines } = await resultOf(VENICE, {}, true);
    expect(lines[1]).toBe(
      "3 models, 2 of them can see images; the others can write with the looking model.",
    );
  });
});

describe("a key the model list cannot check", () => {
  it("is said to be unchecked when the server lists its models to anyone", async () => {
    const local = { ...LOCAL, apiKey: "typed" };
    const getBalance = () => Promise.resolve({ unavailable: "notVenice" as const });
    expect((await resultOf(local, { getBalance })).lines).toContain(KEY_NOT_CHECKED);
    const { lines } = await resultOf(local, { getBalance, listModels: keyed(MODELS) });
    expect(lines).not.toContain(KEY_NOT_CHECKED);
    expect((await resultOf(LOCAL, { getBalance })).lines).not.toContain(KEY_NOT_CHECKED);
  });

  it("is not called an inference key, but a read balance does check it", async () => {
    expect((await resultOf(VENICE)).lines.slice(2)).toEqual([
      KEY_NOT_CHECKED,
      "Reading the balance needs an admin key.",
    ]);
    const { lines } = await resultOf(VENICE, {
      getBalance: () => Promise.resolve({ canConsume: true, consumptionCurrency: "USD" }),
    });
    expect(lines.slice(2)).toEqual(["Admin key: the balance can be read."]);
  });
});

describe("connectionResult failures", () => {
  it("gives the reason plainly, what to try, and what the server said", async () => {
    const api = { ...VENICE, apiKey: "sk-secret" };
    expect(await resultOf(api, fails(new ApiError(401, "Invalid API key")))).toEqual({
      kind: "error",
      heading: "Could not connect",
      lines: ["api.venice.ai", "The server refused the API key."],
      advice: "Check the key for this server.",
      detail: "HTTP 401: Invalid API key",
    });
  });

  it("tells a missing key, a wrong address, a server error and no answer apart", async () => {
    const line = async (error: Error, api = LOCAL) => (await resultOf(api, fails(error))).lines[1];
    expect(await line(new ApiError(403, "no"))).toBe("The server needs an API key.");
    expect(await line(new ApiError(404, "no"))).toContain("no list of models at that address");
    expect(await line(new ApiError(500, "no"))).toBe("The server answered with an error.");
    expect(await line(new SyntaxError("<html>"))).toContain("not with a list of models");
    const unreachable = await resultOf(LOCAL, fails(new TypeError("Failed to fetch")));
    expect(unreachable.lines[1]).toBe("The server did not answer.");
    expect(unreachable.advice).toContain("CORS");
    expect(unreachable.detail).toBe("Failed to fetch");
  });

  it("never shows the key a server repeats", async () => {
    const api = { ...VENICE, apiKey: "sk-secret" };
    const { detail } = await resultOf(api, fails(new ApiError(401, "Bad key sk-secret given")));
    expect(detail).toBe("HTTP 401: Bad key … given");
  });
});

describe("initConnectionTest", () => {
  let els: AppElements;
  let state: AppState;

  beforeEach(() => {
    els = mountPage();
    state = createAppState(DEFAULT_SETTINGS);
    localStorage.clear();
    els.settingsDialog.baseUrlInput.value = LOCAL.baseUrl;
  });

  function block(): HTMLElement {
    const found = els.connectionTest.status.querySelector<HTMLElement>(".connection-result");
    if (!found) throw new Error("No result block");
    return found;
  }

  function reportText(): string[] {
    return [...block().querySelectorAll("li")].map((li) => li.textContent ?? "");
  }

  const heading = () => block().querySelector(".connection-result-heading")?.textContent;

  function held() {
    let finish: (models: ModelInfo[]) => void = () => {};
    const listModels = () => new Promise<ModelInfo[]>((resolve) => (finish = resolve));
    return { probes: probes({ listModels }), finish: () => finish(MODELS) };
  }

  it("asks for an API without calling anything while no base URL is typed", async () => {
    setSettings(state, { ...state.settings, baseUrl: VENICE_BASE_URL });
    const listModels = vi.fn(() => Promise.resolve(MODELS));
    const test = initConnectionTest(els, state, { probes: probes({ listModels }) });
    els.settingsDialog.baseUrlInput.value = " ";
    await test.run();
    expect(listModels).not.toHaveBeenCalled();
    expect(reportText()).toEqual([NO_API_TEXT]);
    expect(block().classList.contains("is-error")).toBe(true);
  });

  it("tests the key and base URL typed in the dialog and remembers a pass", async () => {
    setSettings(state, { ...state.settings, baseUrl: "http://localhost:1234/v1" });
    const listModels = vi.fn(() => Promise.resolve(MODELS));
    const onTested = vi.fn();
    const onListed = vi.fn();
    const test = initConnectionTest(els, state, {
      probes: probes({ listModels }),
      storage: localStorage,
      onTested,
      onListed,
    });
    els.settingsDialog.apiKeyInput.value = " typed-key ";
    els.settingsDialog.baseUrlInput.value = ` ${VENICE_BASE_URL} `;
    await test.run();
    const api = { apiKey: "typed-key", baseUrl: VENICE_BASE_URL };
    expect(listModels).toHaveBeenCalledWith(api);
    expect(heading()).toBe("Connected");
    expect(block().classList.contains("is-success")).toBe(true);
    expect(block().querySelector(".connection-result-icon svg")).not.toBeNull();
    expect(els.connectionTest.status.getAttribute("role")).toBe("status");
    expect(lastTestPassed(localStorage)).toBe(true);
    expect(onTested).toHaveBeenCalledWith(true);
    expect(onListed).toHaveBeenCalledWith(api, MODELS);
  });

  it("marks a failed test, lists nothing and forgets an earlier pass", async () => {
    localStorage.setItem("vid2grid-chat-connection-test", "passed");
    const onListed = vi.fn();
    initConnectionTest(els, state, {
      probes: probes(fails(new Error("Failed to fetch"))),
      storage: localStorage,
      onListed,
    });
    els.connectionTest.button.click();
    await vi.waitFor(() => expect(heading()).toBe("Could not connect"));
    expect(block().classList.contains("is-error")).toBe(true);
    expect(block().querySelector(".connection-result-detail")?.textContent).toBe("Failed to fetch");
    expect(onListed).not.toHaveBeenCalled();
    expect(lastTestPassed(localStorage)).toBe(false);
    expect(els.connectionTest.button.disabled).toBe(false);
  });

  it("is busy while testing, in place of the last result", async () => {
    const slow = held();
    const test = initConnectionTest(els, state, { probes: slow.probes });
    const running = test.run();
    const { button } = els.connectionTest;
    expect([button.disabled, button.getAttribute("aria-busy")]).toEqual([true, "true"]);
    expect([heading(), reportText()]).toEqual(["Testing…", []]);
    slow.finish();
    await running;
    expect([button.disabled, button.getAttribute("aria-busy")]).toEqual([false, "false"]);
    expect(heading()).toBe("Connected");
  });

  it.each([
    ["the URL is edited", () => els.settingsDialog.baseUrlInput.dispatchEvent(new Event("input"))],
    ["the key is edited", () => els.settingsDialog.apiKeyInput.dispatchEvent(new Event("input"))],
    [
      "a quick fill is used",
      () => els.settingsDialog.form.querySelector<HTMLElement>("[data-base-url]")?.click(),
    ],
    ["the dialog closes", () => els.settingsDialog.dialog.dispatchEvent(new Event("close"))],
  ])("drops a shown and a late result once %s", async (_what, change) => {
    const onListed = vi.fn();
    const onTested = vi.fn();
    const slow = held();
    const test = initConnectionTest(els, state, { probes: slow.probes, onListed, onTested });
    const running = test.run();
    change();
    expect(block().hidden).toBe(true);
    expect(els.connectionTest.button.disabled).toBe(false);
    slow.finish();
    await running;
    expect(block().hidden).toBe(true);
    expect([onListed.mock.calls, onTested.mock.calls]).toEqual([[], []]);
    test.clear();
  });
});
