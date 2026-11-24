import { beforeEach, describe, expect, it, vi } from "vitest";
import type { listModels } from "../src/api/client";
import { VENICE_BASE_URL } from "../src/api/venice";
import { createModelList, shouldLoadModels, type ModelListDeps } from "../src/app/modelList";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import { DEFAULT_SETTINGS, type GlobalSettings } from "../src/settings";
import {
  createAppState,
  setChats,
  setCurrentChat,
  setLookingModels,
  setModels,
  type AppState,
} from "../src/state";
import type { Chat, ChatMessage, ModelInfo } from "../src/types";
import { model, user } from "./support/factories";

const LOCAL: GlobalSettings = { ...DEFAULT_SETTINGS, baseUrl: "http://localhost:1234/v1" };

let state: AppState;
let deps: ModelListDeps;
let refresh: ReturnType<typeof vi.fn>;
let refreshBalance: ReturnType<typeof vi.fn>;
let show: ReturnType<typeof vi.fn>;

function withList(list: typeof listModels): void {
  deps.listModels = list;
}

function settle(): { promise: Promise<ModelInfo[]>; resolve(models: ModelInfo[]): void } {
  let resolve: (models: ModelInfo[]) => void = () => {};
  const promise = new Promise<ModelInfo[]>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  state = createAppState(LOCAL);
  refresh = vi.fn();
  refreshBalance = vi.fn();
  show = vi.fn();
  deps = {
    state,
    store: createMemoryStore(),
    status: { show },
    refresh,
    refreshBalance,
    listModels: () => Promise.resolve([model("vision")]),
  };
});

describe("shouldLoadModels", () => {
  it("needs a base URL, and a key only for Venice", () => {
    expect(shouldLoadModels(DEFAULT_SETTINGS)).toBe(false);
    expect(shouldLoadModels(LOCAL)).toBe(true);
    expect(shouldLoadModels({ ...DEFAULT_SETTINGS, baseUrl: VENICE_BASE_URL })).toBe(false);
    expect(shouldLoadModels({ ...DEFAULT_SETTINGS, baseUrl: VENICE_BASE_URL, apiKey: "k" })).toBe(
      true,
    );
  });
});

describe("createModelList", () => {
  it("stores the loaded models with the fallback image cap and refreshes", async () => {
    const list = vi.fn(() => Promise.resolve([model("vision")]));
    withList(list);
    const models = await createModelList(deps).load({ ...LOCAL, fallbackMaxImages: 7 });
    expect(models.map((entry) => entry.id)).toEqual(["vision"]);
    expect(state.models).toBe(models);
    expect(list).toHaveBeenCalledWith(expect.anything(), { fallbackMaxImages: 7 });
    expect(refresh).toHaveBeenCalled();
  });

  it("records a failed load and still refreshes", async () => {
    withList(() => Promise.reject(new Error("Failed to fetch")));
    await expect(createModelList(deps).load(LOCAL)).rejects.toThrow("Failed to fetch");
    expect(state.modelsError).toBe("Failed to fetch");
    expect(refresh).toHaveBeenCalled();
  });

  it("ignores an older load that settles after a newer one", async () => {
    const slow = settle();
    const lists = [() => slow.promise, () => Promise.resolve([model("newer")])];
    withList(() => lists.shift()?.() ?? Promise.resolve([]));
    const modelList = createModelList(deps);
    const older = modelList.load(LOCAL);
    await modelList.load(LOCAL);
    slow.resolve([model("older")]);
    expect((await older).map((entry) => entry.id)).toEqual(["newer"]);
    expect(state.models.map((entry) => entry.id)).toEqual(["newer"]);
  });

  it("ignores an older load that fails after a newer one", async () => {
    let fail: (error: Error) => void = () => {};
    const failing = new Promise<ModelInfo[]>((_resolve, reject) => {
      fail = reject;
    });
    const lists = [() => failing, () => Promise.resolve([model("newer")])];
    withList(() => lists.shift()?.() ?? Promise.resolve([]));
    const modelList = createModelList(deps);
    const older = modelList.load(LOCAL);
    await modelList.load(LOCAL);
    fail(new Error("timed out"));
    await expect(older).resolves.toEqual(state.models);
    expect(state.modelsError).toBeNull();
  });

  it("reports a background load that fails", async () => {
    withList(() => Promise.reject(new Error("offline")));
    createModelList(deps).loadInBackground();
    await vi.waitFor(() =>
      expect(show).toHaveBeenCalledWith("Could not load models: offline", "error"),
    );
  });

  it("gives the open chat the default model once models load", async () => {
    const chat = blankChat("", "chat", 1);
    await deps.store.putChat(chat);
    setChats(state, [chat]);
    setCurrentChat(state, chat, []);
    await createModelList(deps).load(LOCAL);
    await vi.waitFor(() => expect(state.currentChat?.settings.modelId).toBe("vision"));
  });
});

describe("onSettingsSaved", () => {
  it("reloads models and the balance when the API changes", async () => {
    const list = vi.fn(() => Promise.resolve([model("vision")]));
    withList(list);
    createModelList(deps).onSettingsSaved({ ...LOCAL, apiKey: "old" });
    expect(refreshBalance).toHaveBeenCalled();
    await vi.waitFor(() => expect(state.models.map((entry) => entry.id)).toEqual(["vision"]));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("only refreshes when nothing about the API changed", () => {
    const list = vi.fn(() => Promise.resolve([]));
    withList(list);
    createModelList(deps).onSettingsSaved(LOCAL);
    expect(list).not.toHaveBeenCalled();
    expect(refreshBalance).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("clears the models when the base URL is emptied", () => {
    const cleared = createAppState(DEFAULT_SETTINGS);
    setModels(cleared, [model("vision")]);
    deps.state = cleared;
    createModelList(deps).onSettingsSaved(LOCAL);
    expect(cleared.models).toEqual([]);
    expect(refreshBalance).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("the looking model's own list", () => {
  const OWN: GlobalSettings = {
    ...LOCAL,
    lookingBaseUrl: "http://localhost:5001/v1",
    apiKeys: { "http://localhost:5001/v1": "looking-key" },
    fallbackMaxImages: 3,
  };

  it("is loaded from its own server with its own key", async () => {
    deps.state = createAppState(OWN);
    const list = vi.fn(() => Promise.resolve([model("eyes")]));
    withList(list);
    createModelList(deps).loadLookingInBackground();
    await vi.waitFor(() => expect(deps.state.lookingModels.map(({ id }) => id)).toEqual(["eyes"]));
    expect(list).toHaveBeenCalledWith(
      { baseUrl: "http://localhost:5001/v1", apiKey: "looking-key" },
      { fallbackMaxImages: 3 },
    );
    expect(deps.state.models).toEqual([]);
  });

  it("is not loaded while it shares the chat's server", () => {
    const list = vi.fn(() => Promise.resolve([model("eyes")]));
    withList(list);
    createModelList(deps).loadLookingInBackground();
    expect(list).not.toHaveBeenCalled();
  });

  it("follows a change of its server or key, and empties when it has none", async () => {
    const list = vi.fn(() => Promise.resolve([model("eyes")]));
    withList(list);
    deps.state = createAppState(OWN);
    createModelList(deps).onSettingsSaved({ ...OWN, apiKeys: {} });
    await vi.waitFor(() => expect(deps.state.lookingModels).toHaveLength(1));
    createModelList(deps).onSettingsSaved(OWN);
    expect(list).toHaveBeenCalledTimes(1);
    const shared = createAppState(LOCAL);
    setLookingModels(shared, [model("eyes")]);
    deps.state = shared;
    createModelList(deps).onSettingsSaved(OWN);
    expect(shared.lookingModels).toEqual([]);
  });

  it("stays quiet about an older load that fails after a newer one", async () => {
    deps.state = createAppState(OWN);
    let fail: (error: Error) => void = () => {};
    const failing = new Promise<ModelInfo[]>((_resolve, reject) => (fail = reject));
    const lists = [() => failing, () => Promise.resolve([model("eyes")])];
    withList(() => lists.shift()?.() ?? Promise.resolve([]));
    const modelList = createModelList(deps);
    modelList.loadLookingInBackground();
    modelList.loadLookingInBackground();
    await vi.waitFor(() => expect(deps.state.lookingModels).toHaveLength(1));
    fail(new Error("timed out"));
    await failing.catch(() => undefined);
    await Promise.resolve();
    expect(show).not.toHaveBeenCalled();
  });

  it("reports a load that fails", async () => {
    deps.state = createAppState(OWN);
    withList(() => Promise.reject(new Error("offline")));
    createModelList(deps).loadLookingInBackground();
    await vi.waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        "Could not load the looking model's list: offline",
        "error",
      ),
    );
  });
});

describe("accept", () => {
  const own = "http://localhost:5001/v1";

  it("takes a list of the saved server, and of the saved looking server", () => {
    deps.state = createAppState({ ...LOCAL, apiKey: "k", lookingBaseUrl: own });
    const modelList = createModelList(deps);
    modelList.accept({ baseUrl: `${LOCAL.baseUrl}/`, apiKey: "k" }, [model("a")]);
    modelList.accept({ baseUrl: own, apiKey: "" }, [model("b")]);
    expect(deps.state.models.map(({ id }) => id)).toEqual(["a"]);
    expect(deps.state.lookingModels.map(({ id }) => id)).toEqual(["b"]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("leaves everything alone for another server or key", () => {
    const modelList = createModelList(deps);
    modelList.accept({ baseUrl: LOCAL.baseUrl, apiKey: "typed" }, [model("a")]);
    modelList.accept({ baseUrl: own, apiKey: "" }, [model("a")]);
    expect(state.models).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stands against an older load that settles late", async () => {
    const slow = settle();
    withList(() => slow.promise);
    const modelList = createModelList(deps);
    const loading = modelList.load(LOCAL);
    modelList.accept(LOCAL, [model("tested")]);
    slow.resolve([model("older")]);
    await loading;
    expect(state.models.map(({ id }) => id)).toEqual(["tested"]);
  });
});

describe("an empty chat and the defaults", () => {
  const blind = model("blind", { vision: false, privacy: "unknown" });
  const sees = model("sees", { privacy: "unknown" });
  const LOOKING: GlobalSettings = {
    ...LOCAL,
    defaultModelId: "blind",
    defaultLookingModelId: "eyes",
    defaultLookingBaseUrl: LOCAL.baseUrl,
  };

  async function filled(settings: GlobalSettings, chat: Chat, messages: ChatMessage[] = []) {
    deps.state = createAppState(settings);
    await deps.store.putChat(chat);
    setChats(deps.state, [chat]);
    setCurrentChat(deps.state, chat, messages);
    withList(() => Promise.resolve([blind, sees]));
    await createModelList(deps).load(settings);
    await vi.waitFor(() => expect(deps.state.currentChat?.settings.modelId).not.toBe(""));
    return deps.state.currentChat?.settings;
  }

  it("takes the default looking model and its server with the model", async () => {
    expect(await filled(LOOKING, blankChat("", "chat", 1))).toMatchObject({
      modelId: "blind",
      lookingModelId: "eyes",
      lookingBaseUrl: LOCAL.baseUrl,
    });
  });

  it("keeps a looking model the user chose, or chose against, with a model to match", async () => {
    const blank = blankChat("", "chat", 1);
    const none: Chat = { ...blank, settings: { ...blank.settings, lookingPicked: true } };
    const settings = await filled(LOOKING, none);
    expect(settings?.modelId).toBe("sees");
    expect(settings).not.toHaveProperty("lookingModelId");
  });

  it("gives a chat with messages a model that fits it, and no looking model", async () => {
    const settings = await filled(LOOKING, blankChat("", "chat", 1), [user("u", "hi")]);
    expect(settings?.modelId).toBe("sees");
    expect(settings).not.toHaveProperty("lookingModelId");
  });

  it("follows a default set while it is open", async () => {
    const chat = blankChat("sees", "chat", 1);
    deps.state = createAppState(LOOKING);
    await deps.store.putChat(chat);
    setChats(deps.state, [chat]);
    setCurrentChat(deps.state, chat, []);
    createModelList(deps).onSettingsSaved({ ...LOOKING, defaultLookingModelId: "" });
    await vi.waitFor(() =>
      expect(deps.state.currentChat?.settings).toMatchObject({ lookingModelId: "eyes" }),
    );
  });
});
