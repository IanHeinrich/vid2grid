import type { ModelCallDeps } from "../api/modelCall";
import { isVenice, normaliseBaseUrl } from "../api/venice";
import { serverName } from "../chat/looking";
import { chatModelId, resolveModel } from "../chat/models";
import { lookingModelId } from "../chat/seen";
import { keyFor, type GlobalSettings } from "../settings";
import type { AppState } from "../state";
import type { ApiSettings, Chat, ModelInfo, StreamChat } from "../types";
import { modelCallDeps } from "./modelCallDeps";

type KnownModels = Pick<AppState, "settings" | "models" | "lookingModels">;

export interface LookingConnection {
  model: ModelInfo;
  api: ApiSettings;
  veniceParameters: boolean;
}

export function lookingHasOwnServer({
  baseUrl,
  lookingBaseUrl,
}: Pick<GlobalSettings, "baseUrl" | "lookingBaseUrl">): boolean {
  const own = normaliseBaseUrl(lookingBaseUrl);
  return own !== "" && own !== normaliseBaseUrl(baseUrl);
}

export function lookingApi(settings: GlobalSettings): ApiSettings {
  const { baseUrl, apiKey, apiKeys, lookingBaseUrl } = settings;
  if (!lookingHasOwnServer(settings)) return { baseUrl, apiKey };
  return { baseUrl: lookingBaseUrl, apiKey: keyFor(apiKeys, lookingBaseUrl) };
}

// What is stored with a model picked now, the chat's own server included: that one can change too.
export function pickedLookingServer(
  settings: Pick<GlobalSettings, "baseUrl" | "lookingBaseUrl">,
): string {
  const { baseUrl, lookingBaseUrl } = settings;
  return normaliseBaseUrl(lookingHasOwnServer(settings) ? lookingBaseUrl : baseUrl);
}

// The models a looking model can be picked from: those of the server it is asked on.
export function lookingModels(state: KnownModels): readonly ModelInfo[] {
  return lookingHasOwnServer(state.settings) ? state.lookingModels : state.models;
}

type LookingServer = "chat" | "own" | "gone";

function lookingServer({ settings }: KnownModels, chat: Chat): LookingServer {
  const picked = normaliseBaseUrl(chat.settings.lookingBaseUrl ?? "");
  if (picked === normaliseBaseUrl(settings.baseUrl)) return "chat";
  return picked !== "" && picked === normaliseBaseUrl(settings.lookingBaseUrl) ? "own" : "gone";
}

// Why a chat's pictures have nowhere to go: they are never sent to another server instead.
export function lookingProblem(state: KnownModels, chat: Chat | null): string | undefined {
  if (!chat || lookingModelId(chat) === undefined) return undefined;
  if (lookingServer(state, chat) !== "gone") return undefined;
  const server = lookingHost(chat);
  return `This chat's looking model was picked on ${server}, which is no longer set up in Settings. Choose the looking model again in Chat settings.`;
}

// The models of the server a chat's pictures go to.
export function lookingServerModels(state: KnownModels, chat: Chat): readonly ModelInfo[] {
  const lists = { chat: state.models, own: state.lookingModels, gone: [] };
  return lists[lookingServer(state, chat)];
}

function resolveLooking(state: KnownModels, chat: Chat, modelId: string): ModelInfo {
  const models = lookingServerModels(state, chat);
  return resolveModel({ models, settings: state.settings }, modelId);
}

export function lookingConnection(
  state: KnownModels,
  chat: Chat | null,
): LookingConnection | undefined {
  const modelId = lookingModelId(chat);
  if (!chat || modelId === undefined) return undefined;
  const problem = lookingProblem(state, chat);
  if (problem !== undefined) throw new Error(problem);
  const { settings } = state;
  const api: ApiSettings =
    lookingServer(state, chat) === "own"
      ? lookingApi(settings)
      : { baseUrl: settings.baseUrl, apiKey: settings.apiKey };
  return {
    model: resolveLooking(state, chat, modelId),
    api,
    veniceParameters: isVenice(api.baseUrl),
  };
}

// The model a chat's pictures go to: its looking model if it has one, or else the model given.
export function pictureModel(state: KnownModels, chat: Chat, model: ModelInfo): ModelInfo {
  const modelId = lookingModelId(chat);
  return modelId === undefined ? model : resolveLooking(state, chat, modelId);
}

// Where a chat's pictures go, for the user to read.
export function lookingHost(chat: Chat): string {
  return serverName(chat.settings.lookingBaseUrl ?? "");
}

// The same, only where it is another server than the one the chat itself is sent to.
export function otherLookingHost(state: KnownModels, chat: Chat): string | undefined {
  const own = lookingModelId(chat) !== undefined && lookingServer(state, chat) === "own";
  return own ? lookingHost(chat) : undefined;
}

// For a model something was done with earlier, on either server.
export function knownModel(
  { models, lookingModels, settings }: KnownModels,
  modelId: string,
): ModelInfo {
  return resolveModel({ models: [...models, ...lookingModels], settings }, modelId);
}

// The model to go on studying with, when a study's own is not one the user picked for the server
// its pictures would go to now.
export function studyModel(state: KnownModels, chat: Chat | null, modelId: string): ModelInfo {
  const looking = lookingModelId(chat);
  if (chat && looking !== undefined) return resolveLooking(state, chat, looking);
  const listed = state.models.find((model) => model.id === modelId);
  return listed ?? resolveModel(state, chat ? chatModelId(state, chat) : modelId);
}

// One picked by the user from the list its server offers.
export function pickedStudyModel(
  state: KnownModels,
  chat: Chat | null,
  modelId: string,
): ModelInfo {
  const looking = chat && lookingModelId(chat) !== undefined;
  return looking ? resolveLooking(state, chat, modelId) : resolveModel(state, modelId);
}

// For a call that sends pictures: modelId is one of the models of the server they go to.
export function pictureCallDeps(
  state: AppState,
  chat: Chat,
  streamChat: StreamChat,
  modelId: string,
  signal: AbortSignal,
): ModelCallDeps {
  const deps = modelCallDeps(state, streamChat, modelId, signal);
  const looking = lookingConnection(state, chat);
  if (!looking) return deps;
  return { ...deps, api: looking.api, veniceParameters: looking.veniceParameters };
}

export function lookingName(state: KnownModels, modelId: string): string {
  return knownModel(state, modelId).name;
}

export function lookingPricing(state: KnownModels, modelId: string): ModelInfo["pricing"] {
  const current = lookingModels(state).find((model) => model.id === modelId);
  return (current ?? knownModel(state, modelId)).pricing;
}
