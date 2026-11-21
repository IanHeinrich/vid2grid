import { unknownModel } from "../api/modelCatalog";
import type { GlobalSettings } from "../settings";
import type { Chat, ModelInfo } from "../types";

export interface ModelCatalogue {
  readonly models: readonly ModelInfo[];
  readonly settings: Pick<GlobalSettings, "privateOnly" | "defaultModelId" | "fallbackMaxImages">;
}

// Only Venice reports privacy, so elsewhere the private-only setting would hide every model.
export function reportsPrivacy(models: readonly ModelInfo[]): boolean {
  return models.some((model) => model.privacy !== "unknown");
}

export function visionModels(models: readonly ModelInfo[], privateOnly: boolean): ModelInfo[] {
  const onlyPrivate = privateOnly && reportsPrivacy(models);
  return models.filter((model) => model.vision && (!onlyPrivate || model.privacy === "private"));
}

export function effectiveDefaultModelId(
  models: readonly ModelInfo[],
  privateOnly: boolean,
  defaultModelId: string,
): string {
  const visible = visionModels(models, privateOnly);
  const first = visible[0];
  if (first === undefined || visible.some((model) => model.id === defaultModelId)) {
    return defaultModelId;
  }
  return first.id;
}

export function defaultModelId({ models, settings }: ModelCatalogue): string {
  return effectiveDefaultModelId(models, settings.privateOnly, settings.defaultModelId);
}

export function resolveModel({ models, settings }: ModelCatalogue, modelId: string): ModelInfo {
  return (
    models.find((model) => model.id === modelId) ??
    unknownModel(modelId, settings.fallbackMaxImages)
  );
}

// A chat made before the models loaded has no model of its own and follows the default.
export function chatModelId(catalogue: ModelCatalogue, chat: Chat): string {
  return chat.settings.modelId || defaultModelId(catalogue);
}

export function currentModel(
  catalogue: ModelCatalogue & { readonly currentChat: Chat | null },
): ModelInfo | null {
  const modelId = catalogue.currentChat ? chatModelId(catalogue, catalogue.currentChat) : "";
  return modelId === "" ? null : resolveModel(catalogue, modelId);
}
