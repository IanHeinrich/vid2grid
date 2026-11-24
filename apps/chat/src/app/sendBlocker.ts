import { isVenice } from "../api/venice";
import { currentModel } from "../chat/models";
import { lookingModelId } from "../chat/seen";
import { imagesOf } from "../imageRefs";
import { currentPending, pendingImages, pendingVideo, type AppState } from "../state";
import { lookingConnection, lookingProblem } from "./lookingConnection";

export const CANNOT_SEE =
  "This chat's model cannot see images. Choose a looking model in Chat settings, or another model, to send pictures.";

// Known to be so: a model of a server that does not say is taken to see.
export function cannotSee(state: AppState): boolean {
  return lookingModelId(state.currentChat) === undefined && currentModel(state)?.vision === false;
}

function hasPictures(state: AppState): boolean {
  const pending = currentPending(state);
  return (
    pendingImages(pending).length > 0 ||
    pendingVideo(pending) !== undefined ||
    state.messages.some((message) => imagesOf(message).length > 0)
  );
}

export function sendBlocker(state: AppState): string | null {
  if (state.currentChat === null) return "Start a new chat from the sidebar.";
  const { baseUrl, apiKey } = state.settings;
  if (baseUrl.trim() === "") return "Choose an API in Settings to start chatting.";
  if (isVenice(baseUrl) && apiKey.trim() === "") {
    return "Add your API key in Settings to start chatting.";
  }
  if (currentModel(state) === null) return "Choose a model in Chat settings.";
  if (cannotSee(state) && hasPictures(state)) return CANNOT_SEE;
  const problem = lookingProblem(state, state.currentChat);
  if (problem !== undefined) return problem;
  const looking = lookingConnection(state, state.currentChat)?.api;
  if (looking && isVenice(looking.baseUrl) && looking.apiKey.trim() === "") {
    return "Add the looking model's API key in Settings to start chatting.";
  }
  return null;
}
