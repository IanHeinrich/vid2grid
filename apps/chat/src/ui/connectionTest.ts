import {
  getBalance as fetchBalance,
  isVenice,
  listModels as fetchModels,
  type AccountBalance,
  type BalanceUnavailable,
} from "../api/client";
import type { AppElements } from "../dom";
import type { AppState } from "../state";
import { errorText, plural } from "../text";
import type { ApiSettings, ModelInfo } from "../types";

const RESULT_KEY = "vid2grid-chat-connection-test";

export type KeyKind = "admin" | "inference" | "unknown";

export type ConnectionReport =
  | { reachable: false; venice: boolean; error: string }
  | {
      reachable: true;
      venice: boolean;
      models: number;
      visionModels: number;
      key: KeyKind;
      balanceError?: string;
    };

export interface ConnectionProbes {
  listModels(api: ApiSettings): Promise<readonly ModelInfo[]>;
  getBalance(api: ApiSettings): Promise<AccountBalance | BalanceUnavailable>;
}

function keyOf(balance: AccountBalance | BalanceUnavailable): {
  key: KeyKind;
  balanceError?: string;
} {
  if (!("unavailable" in balance)) return { key: "admin" };
  switch (balance.unavailable) {
    case "needsAdminKey":
      return { key: "inference" };
    case "error":
      return { key: "unknown", balanceError: balance.message ?? "no reason given" };
    case "notVenice":
      return { key: "unknown" };
  }
}

export async function testConnection(
  api: ApiSettings,
  probes: ConnectionProbes,
): Promise<ConnectionReport> {
  const venice = isVenice(api.baseUrl);
  let models: readonly ModelInfo[];
  try {
    models = await probes.listModels(api);
  } catch (error) {
    return { reachable: false, venice, error: errorText(error) };
  }
  return {
    reachable: true,
    venice,
    models: models.length,
    visionModels: models.filter((model) => model.vision).length,
    ...keyOf(await probes.getBalance(api)),
  };
}

function keyLine(key: KeyKind, balanceError: string | undefined): string {
  switch (key) {
    case "admin":
      return "Admin key: the balance can be read.";
    case "inference":
      return "Inference key: chat works, but reading the balance needs an admin key.";
    case "unknown":
      return `Could not read the balance: ${balanceError ?? "no reason given"}`;
  }
}

export function reportLines(report: ConnectionReport): string[] {
  if (!report.reachable) return [`Not reachable: ${report.error}`];
  const lines = [
    "Reachable: the server answered.",
    report.models === 0
      ? "The server lists no models."
      : `${plural(report.models, "model")}, ${report.visionModels} of them can see images.`,
  ];
  if (!report.venice) {
    lines.push("The server is not Venice, so there is no balance to read.");
    return lines;
  }
  lines.push("The server is Venice.", keyLine(report.key, report.balanceError));
  return lines;
}

export function lastTestPassed(storage: Storage = localStorage): boolean {
  return storage.getItem(RESULT_KEY) === "passed";
}

export interface ConnectionTest {
  run(): Promise<void>;
}

export interface ConnectionTestDeps {
  probes?: ConnectionProbes;
  storage?: Storage;
  onTested?: (passed: boolean) => void;
}

// Tests what is typed in the dialog, so a key can be checked before it is saved.
function formSettings(dlg: AppElements["settingsDialog"], state: AppState): ApiSettings {
  return {
    apiKey: dlg.apiKeyInput.value.trim(),
    baseUrl: dlg.baseUrlInput.value.trim() || state.settings.baseUrl,
  };
}

function renderLines(list: HTMLUListElement, lines: readonly string[], failed: boolean): void {
  list.replaceChildren(
    ...lines.map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }),
  );
  list.classList.toggle("is-failed", failed);
  list.hidden = false;
}

export function initConnectionTest(
  els: Pick<AppElements, "connectionTest" | "settingsDialog">,
  state: AppState,
  deps: ConnectionTestDeps = {},
): ConnectionTest {
  const { button, report } = els.connectionTest;
  const probes = deps.probes ?? {
    listModels: (api) => fetchModels(api, { fallbackMaxImages: state.settings.fallbackMaxImages }),
    getBalance: (api) => fetchBalance(api),
  };
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    button.disabled = true;
    renderLines(report, ["Testing the connection…"], false);
    try {
      const result = await testConnection(formSettings(els.settingsDialog, state), probes);
      renderLines(report, reportLines(result), !result.reachable);
      (deps.storage ?? localStorage).setItem(RESULT_KEY, result.reachable ? "passed" : "failed");
      deps.onTested?.(result.reachable);
    } finally {
      running = false;
      button.disabled = false;
    }
  };
  button.addEventListener("click", () => void run());
  return { run };
}
