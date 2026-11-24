import { describe, expect, it } from "vitest";
import { VENICE_BASE_URL } from "../src/api/venice";
import {
  knownModel,
  lookingApi,
  lookingConnection,
  lookingHasOwnServer,
  lookingModels,
  lookingPricing,
  pictureCallDeps,
  lookingHost,
  lookingProblem,
  pickedLookingServer,
  pickedStudyModel,
  pictureModel,
  studyModel,
} from "../src/app/lookingConnection";
import { blankChat } from "../src/chat/chats";
import { DEFAULT_SETTINGS, type GlobalSettings } from "../src/settings";
import { createAppState, setLookingModels, setModels } from "../src/state";
import { model } from "./support/factories";
import { replyWith } from "./support/streams";

const LOCAL = "http://localhost:5001/v1";
const SHARED: GlobalSettings = {
  ...DEFAULT_SETTINGS,
  baseUrl: LOCAL,
  apiKey: "local-key",
  apiKeys: { [LOCAL]: "local-key", [VENICE_BASE_URL]: "venice-key" },
};
const OWN: GlobalSettings = { ...SHARED, lookingBaseUrl: `${VENICE_BASE_URL}/` };
const PRICING = { inputPerMTok: 1, outputPerMTok: 2 };
const signal = new AbortController().signal;

function stateWith(settings: GlobalSettings) {
  const state = createAppState(settings);
  setModels(state, [model("writer"), model("eyes", { maxImages: 3 })]);
  setLookingModels(state, [model("eyes", { maxImages: 7, pricing: PRICING }), model("other")]);
  return state;
}

const shared = blankChat("writer", "chat", 1, "eyes", LOCAL);
const chat = blankChat("writer", "chat", 1, "eyes", VENICE_BASE_URL);
const plain = blankChat("writer", "chat", 1);

describe("lookingApi", () => {
  it("is the chat's own connection without one of its own", () => {
    expect(lookingApi(SHARED)).toEqual({ baseUrl: LOCAL, apiKey: "local-key" });
    expect(lookingHasOwnServer({ ...SHARED, lookingBaseUrl: `${LOCAL}/` })).toBe(false);
  });

  it("takes the key saved for its own server, never the chat's", () => {
    expect(lookingApi(OWN)).toEqual({ baseUrl: `${VENICE_BASE_URL}/`, apiKey: "venice-key" });
    expect(lookingApi({ ...OWN, apiKeys: { [LOCAL]: "local-key" } }).apiKey).toBe("");
  });
});

describe("lookingConnection", () => {
  it("is off for a chat without a looking model", () => {
    expect(lookingConnection(stateWith(OWN), plain)).toBeUndefined();
    expect(lookingConnection(stateWith(OWN), null)).toBeUndefined();
    const blank = { ...plain, settings: { ...plain.settings, lookingModelId: "" } };
    expect(lookingConnection(stateWith(OWN), blank)).toBeUndefined();
  });

  it("finds the model in the list of the server it is asked on", () => {
    expect(lookingConnection(stateWith(SHARED), shared)).toMatchObject({
      model: { maxImages: 3 },
      api: { baseUrl: LOCAL },
      veniceParameters: false,
    });
    expect(lookingConnection(stateWith(OWN), chat)).toMatchObject({
      model: { maxImages: 7 },
      api: { apiKey: "venice-key" },
      veniceParameters: true,
    });
    expect(lookingConnection(stateWith(OWN), shared)).toMatchObject({ api: { baseUrl: LOCAL } });
    expect(lookingModels(stateWith(SHARED)).map(({ id }) => id)).toEqual(["writer", "eyes"]);
  });

  it("falls back to an unknown model when the list does not hold it", () => {
    const gone = blankChat("writer", "chat", 1, "gone", VENICE_BASE_URL);
    const found = lookingConnection(stateWith(OWN), gone);
    expect(found?.model).toMatchObject({ id: "gone", vision: true, maxImages: 10 });
  });
});

describe("what sends pictures", () => {
  it("uses the looking model and its connection when the chat has one", () => {
    const state = stateWith(OWN);
    const writer = model("writer");
    expect(pictureModel(state, chat, writer).id).toBe("eyes");
    expect(pictureModel(state, plain, writer)).toBe(writer);
    const streamChat = replyWith("ok");
    expect(pictureCallDeps(state, chat, streamChat, "eyes", signal)).toEqual({
      api: { baseUrl: `${VENICE_BASE_URL}/`, apiKey: "venice-key" },
      streamChat,
      modelId: "eyes",
      veniceParameters: true,
      signal,
    });
    expect(pictureCallDeps(state, plain, streamChat, "writer", signal)).toMatchObject({
      api: { baseUrl: LOCAL, apiKey: "local-key" },
      modelId: "writer",
      veniceParameters: false,
    });
  });

  it("studies on with the looking model, unless another was picked for its server", () => {
    const state = stateWith(OWN);
    expect(studyModel(state, chat, "other").id).toBe("eyes");
    expect(pickedStudyModel(state, chat, "other").id).toBe("other");
    expect(studyModel(stateWith(SHARED), shared, "writer").id).toBe("eyes");
  });

  it("never studies on the chat's server with a model that is not there", () => {
    const state = stateWith(OWN);
    expect(studyModel(state, plain, "writer").id).toBe("writer");
    expect(studyModel(state, plain, "other").id).toBe("writer");
    expect(pickedStudyModel(state, plain, "eyes").id).toBe("eyes");
  });

  it("prices a note by its model, on whichever server lists it", () => {
    const state = stateWith(OWN);
    expect(lookingPricing(state, "eyes")).toEqual(PRICING);
    expect(lookingPricing(state, "gone")).toBeUndefined();
    expect(knownModel(state, "writer").id).toBe("writer");
  });
});

describe("a looking model whose server is no longer set up", () => {
  const changed: GlobalSettings = { ...OWN, lookingBaseUrl: "https://openrouter.ai/api/v1" };

  it.each([
    ["cleared", { ...OWN, lookingBaseUrl: "" }],
    ["changed", changed],
  ])("is refused when its server was %s, never asked on another", (_how, settings) => {
    const state = stateWith(settings);
    const problem = lookingProblem(state, chat) ?? "";
    expect(problem).toContain("picked on api.venice.ai");
    expect(problem).toContain("Choose the looking model again in Chat settings.");
    expect(() => lookingConnection(state, chat)).toThrow(problem);
    expect(() => pictureCallDeps(state, chat, replyWith("ok"), "eyes", signal)).toThrow(problem);
    expect(pictureModel(state, chat, model("writer")).id).toBe("eyes");
    expect(lookingHost(chat)).toBe("api.venice.ai");
  });

  it("goes on when its server becomes the chat's own", () => {
    const own = { ...SHARED, baseUrl: VENICE_BASE_URL, apiKey: "venice-key" };
    expect(lookingProblem(stateWith(own), chat)).toBeUndefined();
    expect(lookingConnection(stateWith(own), chat)?.api.apiKey).toBe("venice-key");
  });

  it("is refused when the chat's own server, where it was picked, is another now", () => {
    const moved = { ...SHARED, baseUrl: VENICE_BASE_URL, apiKey: "venice-key" };
    expect(lookingProblem(stateWith(moved), shared)).toContain("picked on localhost:5001");
    expect(lookingProblem(stateWith({ ...moved, lookingBaseUrl: LOCAL }), shared)).toBeUndefined();
    const unnamed = blankChat("writer", "chat", 1, "eyes");
    expect(lookingProblem(stateWith(SHARED), unnamed)).toBeDefined();
  });

  it("says nothing of a chat on its own server or with no looking model", () => {
    expect(lookingProblem(stateWith(changed), shared)).toBeUndefined();
    expect(lookingProblem(stateWith(changed), plain)).toBeUndefined();
    expect(lookingProblem(stateWith(changed), null)).toBeUndefined();
  });

  it("is kept with the server it is picked on, the chat's own included", () => {
    expect(pickedLookingServer(OWN)).toBe(VENICE_BASE_URL);
    expect(pickedLookingServer(SHARED)).toBe(LOCAL);
  });
});
