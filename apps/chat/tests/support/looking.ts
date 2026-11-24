import type { Looker } from "../../src/chat/looking";
import type {
  ChatRequest,
  ContentPart,
  ImageRef,
  ImageStore,
  SeenNote,
  StreamChat,
  WireMessage,
} from "../../src/types";
import { model } from "./factories";
import { scriptedReplies } from "./streams";

export const LOOKING_API = { baseUrl: "http://localhost:5001/v1", apiKey: "looking-key" };

export function described(imageIds: string[], text: string, extra: Partial<SeenNote> = {}) {
  return { kind: "described" as const, imageIds, modelId: "eyes", text, ...extra };
}

export function answered(imageIds: string[], text: string, extra: Partial<SeenNote> = {}) {
  return { kind: "answered" as const, imageIds, modelId: "eyes", text, ...extra };
}

// Every image is stored but those named as gone; each one's bytes are its own id.
export function imageStore(gone: readonly string[] = []): ImageStore {
  return {
    putImage: () => Promise.resolve("unused"),
    getImage: (id) =>
      Promise.resolve(gone.includes(id) ? undefined : new Blob([id], { type: "image/jpeg" })),
  };
}

export function looker(
  replies: (string | Error)[] = [],
  requests: ChatRequest[] = [],
  overrides: Partial<Looker> = {},
): Looker {
  return {
    model: model("eyes", { name: "Eyes", maxImages: 4 }),
    api: LOOKING_API,
    veniceParameters: false,
    streamChat: scriptedReplies(replies, requests),
    store: imageStore(),
    resolution: 1024,
    ...overrides,
  };
}

// Answers each model's requests from its own script, in order.
export function perModel(scripts: Record<string, StreamChat>): StreamChat {
  return (api, request, signal) => {
    const script = scripts[request.model];
    if (!script) throw new Error(`Nothing scripted for ${request.model}`);
    return script(api, request, signal);
  };
}

export function partsOf(message: WireMessage | undefined): ContentPart[] {
  return message?.role === "user" && Array.isArray(message.content) ? message.content : [];
}

export function textsOf(request: ChatRequest | undefined): string[] {
  const parts = (request?.messages ?? []).flatMap(partsOf);
  return parts.flatMap((part) => (part.type === "text" ? [part.text] : []));
}

export function sentImageIds(request: ChatRequest | undefined): string[] {
  const parts = (request?.messages ?? []).flatMap(partsOf);
  return parts.flatMap((part) =>
    part.type === "image_url" ? [atob(part.image_url.url.split(",")[1] ?? "")] : [],
  );
}

export function timedSheet(id: string, startSeconds: number, call = "overview"): ImageRef {
  const source = {
    kind: "sheet" as const,
    call,
    name: `grid_${id}`,
    startSeconds,
    endSeconds: startSeconds + 10,
    frameCount: 4,
  };
  return { id, pinned: false, source };
}
