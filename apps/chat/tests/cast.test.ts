import { describe, expect, it } from "vitest";
import {
  CAST_SYSTEM_PROMPT,
  mergeCast,
  parseCast,
  suggestCast,
  type CastDeps,
} from "../src/chat/cast";
import type { CastCard, ChatRequest } from "../src/types";
import { replyWith } from "./support/streams";

function counter(): () => string {
  let next = 0;
  return () => `card-${++next}`;
}

function setup(reply: string) {
  const requests: ChatRequest[] = [];
  const deps: CastDeps = {
    api: { baseUrl: "https://api.example", apiKey: "key" },
    streamChat: replyWith(reply, requests),
    modelId: "model",
    veniceParameters: true,
    signal: new AbortController().signal,
    newId: counter(),
  };
  return { deps, requests };
}

function card(id: string, name: string, extra: Partial<CastCard> = {}): CastCard {
  return { id, name, description: `${name} described`, ...extra };
}

describe("suggestCast", () => {
  it("sends the overview sheets and the scene log, and parses the reply into cards", async () => {
    const { deps, requests } = setup(
      "Mara | tall woman in a red coat | first seen 0:12\nRex | brown terrier | 1:05",
    );
    const cards = await suggestCast(deps, {
      overview: ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"],
      sceneLog: [
        { timeSeconds: 65, text: "a dog runs in" },
        { timeSeconds: 12, text: "a woman enters" },
      ],
      durationSeconds: 125,
    });

    expect(cards).toEqual([
      { id: "card-1", name: "Mara", description: "tall woman in a red coat", firstSeenSeconds: 12 },
      { id: "card-2", name: "Rex", description: "brown terrier", firstSeenSeconds: 65 },
    ]);
    const request = requests[0];
    expect(request?.model).toBe("model");
    expect(request?.venice_parameters).toEqual({ include_venice_system_prompt: false });
    expect(request?.messages[0]).toEqual({ role: "system", content: CAST_SYSTEM_PROMPT });
    expect(request?.messages[1]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "The video is 2:05 long.\n\nScene log:\n[0:12] a woman enters\n[1:05] a dog runs in",
        },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBB" } },
      ],
    });
  });

  it("asks nothing when there is no overview and no scene log", async () => {
    const { deps, requests } = setup("Mara | woman | 0:01");
    const input = { overview: [], sceneLog: [], durationSeconds: 60 };
    expect(await suggestCast(deps, input)).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("surfaces an abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps } = setup("Mara | woman | 0:01");
    await expect(
      suggestCast(
        { ...deps, signal: controller.signal },
        {
          overview: ["data:x"],
          sceneLog: [],
          durationSeconds: 60,
        },
      ),
    ).rejects.toThrow();
  });
});

describe("parseCast", () => {
  it("tolerates bullets, bold names, tables and a missing time, clamping to the video", () => {
    const reply = [
      "Here is the cast:",
      "| Name | Description | First seen |",
      "|---|---|---|",
      "- **Mara** | red coat | first seen [0:12]",
      "2. Rex | terrier",
      "Ghost | pale figure | 9:59",
      "| Ana | girl in blue | 0:40 |",
      "mara | duplicate | 0:30",
    ].join("\n");
    expect(parseCast(reply, 120, counter())).toEqual([
      { id: "card-1", name: "Mara", description: "red coat", firstSeenSeconds: 12 },
      { id: "card-2", name: "Rex", description: "terrier" },
      { id: "card-3", name: "Ghost", description: "pale figure", firstSeenSeconds: 120 },
      { id: "card-4", name: "Ana", description: "girl in blue", firstSeenSeconds: 40 },
    ]);
  });

  it("reads hours", () => {
    expect(parseCast("Mara | coat | 1:02:03", 10_000, counter())[0]?.firstSeenSeconds).toBe(3723);
  });
});

describe("mergeCast", () => {
  it("keeps existing cards untouched and adds only new names, ignoring case", () => {
    const edited = card("a", "Mara", { description: "my own words" });
    const merged = mergeCast(
      [edited],
      [card("b", " mara "), card("c", "Rex"), card("d", "REX"), card("e", "  ")],
    );
    expect(merged).toEqual([edited, card("c", "Rex")]);
  });
});
