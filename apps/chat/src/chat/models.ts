import { unknownModel } from "../api/modelCatalog";
import type { GlobalSettings } from "../settings";
import type { Chat, ModelInfo } from "../types";
import { lookingModelId } from "./seen";

export interface ModelCatalogue {
  readonly models: readonly ModelInfo[];
  readonly settings: Pick<
    GlobalSettings,
    "privateOnly" | "defaultModelId" | "defaultLookingModelId" | "fallbackMaxImages"
  >;
}

// Only Venice reports privacy, so elsewhere the private-only setting would hide every model.
export function reportsPrivacy(models: readonly ModelInfo[]): boolean {
  return models.some((model) => model.privacy !== "unknown");
}

// With a looking model, one that cannot see images can write too.
export function offeredModels(
  models: readonly ModelInfo[],
  privateOnly: boolean,
  looking = false,
): ModelInfo[] {
  const onlyPrivate = privateOnly && reportsPrivacy(models);
  return models.filter(
    (model) => (looking || model.vision) && (!onlyPrivate || model.privacy === "private"),
  );
}

export function effectiveDefaultModelId(
  models: readonly ModelInfo[],
  privateOnly: boolean,
  defaultModelId: string,
  looking = false,
): string {
  const visible = offeredModels(models, privateOnly, looking);
  const first = visible[0];
  if (first === undefined || visible.some((model) => model.id === defaultModelId)) {
    return defaultModelId;
  }
  return first.id;
}

// For a chat with a looking model, or for a new chat, which takes the default one.
export function defaultModelId(
  { models, settings }: ModelCatalogue,
  looking: boolean = settings.defaultLookingModelId !== "",
): string {
  const { privateOnly } = settings;
  return effectiveDefaultModelId(models, privateOnly, settings.defaultModelId, looking);
}

export function resolveModel({ models, settings }: ModelCatalogue, modelId: string): ModelInfo {
  return (
    models.find((model) => model.id === modelId) ??
    unknownModel(modelId, settings.fallbackMaxImages)
  );
}

// A chat made before the models loaded has no model of its own and follows the default.
export function chatModelId(catalogue: ModelCatalogue, chat: Chat): string {
  return chat.settings.modelId || defaultModelId(catalogue, lookingModelId(chat) !== undefined);
}

export function currentModel(
  catalogue: ModelCatalogue & { readonly currentChat: Chat | null },
): ModelInfo | null {
  const modelId = catalogue.currentChat ? chatModelId(catalogue, catalogue.currentChat) : "";
  return modelId === "" ? null : resolveModel(catalogue, modelId);
}
