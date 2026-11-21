import { beforeEach, describe, expect, it, vi } from "vitest";
import type { listModels } from "../src/api/client";
import { VENICE_BASE_URL } from "../src/api/venice";
import { createModelList, shouldLoadModels, type ModelListDeps } from "../src/app/modelList";
import { blankChat } from "../src/chat/chats";
import { createMemoryStore } from "../src/chat/store";
import { DEFAULT_SETTINGS, type GlobalSettings } from "../src/settings";
import { createAppState, setChats, setCurrentChat, setModels, type AppState } from "../src/state";
import type { ModelInfo } from "../src/types";
import { model } from "./support/factories";

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
