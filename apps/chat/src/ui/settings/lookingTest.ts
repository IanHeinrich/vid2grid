import { ApiError } from "../../api/http";
import { isVenice } from "../../api/venice";
import { serverName } from "../../chat/looking";
import type { ApiSettings, ModelInfo } from "../../types";
import type { ConnectionResult } from "./connectionBlock";
import { connectionFailure } from "./connectionFailure";
import { KEY_NOT_CHECKED, listingChecksKey } from "./keyCheck";

export interface LookingProbes {
  listModels(api: ApiSettings): Promise<readonly ModelInfo[]>;
  // Rejects when the model does not answer.
  askOnce(api: ApiSettings, modelId: string): Promise<void>;
}

export interface LookingReport {
  result: ConnectionResult;
  // Absent when the server did not list any.
  models?: readonly ModelInfo[];
}

interface Found {
  line: string;
  model: ModelInfo | undefined;
  usable: boolean;
}

function findModel(api: ApiSettings, models: readonly ModelInfo[], modelId: string): Found {
  if (modelId === "") {
    const line = "No looking model is chosen for new chats yet.";
    return { line, model: undefined, usable: true };
  }
  const model = models.find((entry) => entry.id === modelId);
  if (!model) return { line: `It does not list ${modelId}.`, model, usable: false };
  if (!model.vision) return { line: `${model.name} cannot see images.`, model, usable: false };
  const line = isVenice(api.baseUrl)
    ? `${model.name} is there and can see images.`
    : `${model.name} is there. The server does not say which models can see images.`;
  return { line, model, usable: true };
}

async function keyLine(
  api: ApiSettings,
  model: ModelInfo | undefined,
  probes: LookingProbes,
): Promise<string[]> {
  if (await listingChecksKey(api, (server) => probes.listModels(server))) return [];
  if (!model) return [KEY_NOT_CHECKED];
  await probes.askOnce(api, model.id);
  return [`The key works: ${model.name} answered.`];
}

function unanswered(api: ApiSettings, host: string, name: string, error: unknown) {
  const failure = connectionFailure(api, host, error);
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return failure;
  return {
    ...failure,
    heading: "Connected, but the model did not answer",
    lines: [host, `${name} did not answer a short text message.`],
    advice: "Try again, or choose another looking model above.",
  };
}

export async function testLookingModel(
  api: ApiSettings,
  modelId: string,
  probes: LookingProbes,
): Promise<LookingReport> {
  const host = serverName(api.baseUrl);
  let models: readonly ModelInfo[];
  try {
    models = await probes.listModels(api);
  } catch (error) {
    return { result: connectionFailure(api, host, error) };
  }
  const { line, model, usable } = findModel(api, models, modelId);
  if (!usable) {
    const heading = "Connected, but the model is not usable";
    const advice = "Choose another looking model above.";
    return { models, result: { kind: "error", heading, lines: [host, line], advice } };
  }
  try {
    const lines = [host, line, ...(await keyLine(api, model, probes))];
    return { models, result: { kind: "success", heading: "Connected", lines } };
  } catch (error) {
    return { models, result: unanswered(api, host, model?.name ?? modelId, error) };
  }
}
