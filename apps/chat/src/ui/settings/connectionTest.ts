import {
  getBalance as fetchBalance,
  listModels as fetchModels,
  type AccountBalance,
  type BalanceUnavailable,
} from "../../api/client";
import { isVenice } from "../../api/venice";
import { serverName } from "../../chat/looking";
import type { AppElements } from "../../dom";
import type { AppState } from "../../state";
import { plural } from "../../text";
import type { ApiSettings, ModelInfo } from "../../types";
import { initConnectionBlock, type ConnectionResult } from "./connectionBlock";
import { connectionFailure } from "./connectionFailure";
import { KEY_NOT_CHECKED, listingChecksKey } from "./keyCheck";

const RESULT_KEY = "vid2grid-chat-connection-test";
export const NO_API_TEXT = "Choose an API first: pick one above or enter its base URL.";

export type KeyKind = "admin" | "inference" | "unknown";

export type ConnectionReport =
  | { reachable: false; error: unknown }
  | {
      reachable: true;
      venice: boolean;
      models: readonly ModelInfo[];
      // A looking model is chosen for new chats, so the others can write too.
      looking: boolean;
      key: KeyKind;
      // False when the server lists its models to anyone, whatever the key.
      keyChecked: boolean;
      balanceError?: string;
    };

type Reached = Extract<ConnectionReport, { reachable: true }>;

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
  looking = false,
): Promise<ConnectionReport> {
  let models: readonly ModelInfo[];
  try {
    models = await probes.listModels(api);
  } catch (error) {
    return { reachable: false, error };
  }
  return {
    reachable: true,
    venice: isVenice(api.baseUrl),
    models,
    looking,
    keyChecked: await listingChecksKey(api, (server) => probes.listModels(server)),
    ...keyOf(await probes.getBalance(api)),
  };
}

function modelsLine(models: readonly ModelInfo[], venice: boolean, looking: boolean): string {
  if (models.length === 0) return "The server lists no models.";
  if (!venice) {
    return `${plural(models.length, "model")}. The server does not say which can see images.`;
  }
  const seeing = models.filter((model) => model.vision).length;
  const text = `${plural(models.length, "model")}, ${seeing} of them can see images`;
  return looking && seeing < models.length
    ? `${text}; the others can write with the looking model.`
    : `${text}.`;
}

function keyLines({ venice, key, keyChecked, balanceError }: Reached): string[] {
  const unchecked = keyChecked ? [] : [KEY_NOT_CHECKED];
  if (!venice) return [...unchecked, "This server does not report a balance."];
  switch (key) {
    case "admin":
      return ["Admin key: the balance can be read."];
    case "inference":
      return keyChecked
        ? ["Inference key: chat works, but reading the balance needs an admin key."]
        : [...unchecked, "Reading the balance needs an admin key."];
    case "unknown":
      return [...unchecked, `Could not read the balance: ${balanceError ?? "no reason given"}`];
  }
}

export function connectionResult(api: ApiSettings, report: ConnectionReport): ConnectionResult {
  const host = serverName(api.baseUrl);
  if (!report.reachable) return connectionFailure(api, host, report.error);
  const { models, venice, looking } = report;
  return {
    kind: "success",
    heading: "Connected",
    lines: [host, modelsLine(models, venice, looking), ...keyLines(report)],
  };
}

export function lastTestPassed(storage: Storage = localStorage): boolean {
  return storage.getItem(RESULT_KEY) === "passed";
}

export interface ConnectionTest {
  run(): Promise<void>;
  clear(): void;
}

export interface ConnectionTestDeps {
  probes?: ConnectionProbes;
  storage?: Storage;
  onTested?: (passed: boolean) => void;
  // Whether the dialog's looking section names a model for new chats.
  looking?: () => boolean;
  // What the server tested lists, once it answered for the fields as they still are.
  onListed?: (api: ApiSettings, models: readonly ModelInfo[]) => void;
}

// Tests what is typed in the dialog, so a key can be checked before it is saved.
function formSettings(dlg: AppElements["settingsDialog"]): ApiSettings {
  return { apiKey: dlg.apiKeyInput.value.trim(), baseUrl: dlg.baseUrlInput.value.trim() };
}

export const NO_API: ConnectionResult = {
  kind: "error",
  heading: "Nothing to test yet",
  lines: [NO_API_TEXT],
};

export function initConnectionTest(
  els: Pick<AppElements, "connectionTest" | "settingsDialog">,
  state: AppState,
  deps: ConnectionTestDeps = {},
): ConnectionTest {
  const { button, status } = els.connectionTest;
  const { dialog, form, baseUrlInput, apiKeyInput } = els.settingsDialog;
  const block = initConnectionBlock({ button, status });
  const clear = () => block.clear();
  const probes = deps.probes ?? {
    listModels: (api) => fetchModels(api, { fallbackMaxImages: state.settings.fallbackMaxImages }),
    getBalance: (api) => fetchBalance(api),
  };
  const run = async () => {
    if (button.disabled) return;
    const api = formSettings(els.settingsDialog);
    if (api.baseUrl === "") {
      block.show(NO_API);
      return;
    }
    let report: ConnectionReport | undefined;
    const shown = await block.run(async () => {
      report = await testConnection(api, probes, deps.looking?.());
      return connectionResult(api, report);
    });
    if (!shown || !report) return;
    (deps.storage ?? localStorage).setItem(RESULT_KEY, report.reachable ? "passed" : "failed");
    deps.onTested?.(report.reachable);
    if (report.reachable) deps.onListed?.(api, report.models);
  };
  button.addEventListener("click", () => void run());
  for (const input of [baseUrlInput, apiKeyInput]) input.addEventListener("input", clear);
  form.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-base-url]")) clear();
  });
  dialog.addEventListener("close", clear);
  return { run, clear };
}
