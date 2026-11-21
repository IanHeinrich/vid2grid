import { describe, expect, it } from "vitest";
import { currentTurn, pinsExceedCap, selectImages } from "../src/chat/imageSelection";
import { buildRequest } from "../src/chat/request";
import { keptImages } from "../src/chat/story";
import { imageStub } from "../src/imageRefs";
import type { ChatMessage } from "../src/types";
import {
  sheet,
  overviewSheet,
  upload,
  user,
  assistant,
  tool,
  baseChat,
  input,
} from "./support/requestFixtures";

describe("selectImages", () => {
  const history: ChatMessage[] = [
    user("u1", "first", [upload("a"), upload("b", true)]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", [sheet("c"), sheet("d")]),
    user("u2", "again", [upload("e")]),
  ];

  it("keeps pins plus the newest images across user and tool messages up to the cap", () => {
    expect(selectImages(history, 3, "send")).toEqual(new Set(["b", "e", "d"]));
  });

  it("keeps every pin even past the cap", () => {
    const pinned = [user("u", "", [upload("x", true), upload("y", true), upload("z")])];
    expect(selectImages(pinned, 1)).toEqual(new Set(["x", "y"]));
    expect(pinsExceedCap(pinned, 1)).toBe(true);
    expect(pinsExceedCap(pinned, 2)).toBe(false);
  });

  it("counts a reused image once", () => {
    const reused = [
      user("u", "", [upload("old")]),
      tool("t1", "c1", [sheet("s")]),
      tool("t2", "c2", [sheet("s")]),
    ];
    expect(selectImages(reused, 2)).toEqual(new Set(["s", "old"]));
  });
});

describe("selectImages overview", () => {
  const looks = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => sheet(`${prefix}${index}`));
  const history: ChatMessage[] = [
    user("u0", "", [overviewSheet("old-o1")]),
    user("u1", "watch", [overviewSheet("o1"), overviewSheet("o2"), overviewSheet("o3")]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", looks("l", 6)),
  ];

  it("keeps the latest overview in up to half the free slots before the newest images", () => {
    expect(selectImages(history, 4, "send")).toEqual(new Set(["o1", "o2", "l5", "l4"]));
    expect(selectImages(history, 10, "send")).toEqual(
      new Set(["o1", "o2", "o3", "l0", "l1", "l2", "l3", "l4", "l5", "old-o1"]),
    );
  });

  it("counts the free slots after pins", () => {
    const pinned = [user("p", "", [upload("pin", true)]), ...history];
    expect(selectImages(pinned, 5)).toEqual(new Set(["pin", "o1", "o2", "l5", "l4"]));
  });

  it("changes nothing when only one image fits", () => {
    expect(selectImages(history, 1)).toEqual(new Set(["l5"]));
  });

  it("leaves an overview from before the newest user message behind when describing", () => {
    expect(selectImages(history, 10)).toEqual(
      new Set(["o1", "o2", "o3", "l0", "l1", "l2", "l3", "l4", "l5"]),
    );
  });
});

describe("selectImages across Keep going", () => {
  const investigation: ChatMessage[] = [
    user("u0", "before", [upload("older")]),
    user("u1", "watch", [overviewSheet("ov")]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", [sheet("look")]),
    assistant("a2", "Partly seen."),
    { ...user("k1", "Keep going."), continuation: true },
    assistant("a3", "", ["c2"]),
    tool("t2", "c2", [sheet("more")]),
  ];

  it("keeps the investigation a continuation carries on as the current turn", () => {
    expect(currentTurn(investigation).map((message) => message.id)[0]).toBe("u1");
    expect(selectImages(investigation, 10)).toEqual(new Set(["ov", "look", "more"]));
  });

  it("sends the continued investigation's images and stubs only what came before it", () => {
    const ids = ["older", "ov", "look", "more"];
    const dataUrls = new Map(ids.map((id) => [id, `data:${id}`]));
    const kept = keptImages(baseChat, investigation, 10);
    const sent = JSON.stringify(buildRequest(input({ messages: investigation, kept, dataUrls })));
    expect(sent).toContain("data:ov");
    expect(sent).toContain("data:look");
    expect(sent).not.toContain("data:older");
  });
});

describe("selectImages describing earlier images", () => {
  const history: ChatMessage[] = [
    user("u1", "first", [upload("a"), upload("pin", true)]),
    assistant("a1", "", ["c1"]),
    tool("t1", "c1", [sheet("old")]),
    assistant("a2", "Seen."),
    user("u2", "again", [upload("new")]),
    assistant("a3", "", ["c2"]),
    tool("t2", "c2", [sheet("turn")]),
  ];

  it("keeps pins, the newest user message's images and this turn's images only", () => {
    expect(selectImages(history, 10)).toEqual(new Set(["pin", "new", "turn"]));
    expect(selectImages(history, 10, "send")).toEqual(new Set(["pin", "a", "old", "new", "turn"]));
  });

  it("still caps the current turn at the image limit, newest first", () => {
    expect(selectImages(history, 2)).toEqual(new Set(["pin", "turn"]));
  });

  it("starts the current turn at the newest user message", () => {
    expect(currentTurn(history).map((message) => message.id)).toEqual(["u2", "a3", "t2"]);
    expect(currentTurn([])).toEqual([]);
  });

  it("follows the chat's setting, describing by default", () => {
    expect(keptImages(baseChat, history, 10)).toEqual(new Set(["pin", "new", "turn"]));
    const sending = {
      ...baseChat,
      settings: { ...baseChat.settings, earlierImages: "send" as const },
    };
    expect(keptImages(sending, history, 10)).toEqual(new Set(["pin", "a", "old", "new", "turn"]));
  });

  it("stubs earlier images with a recall hint and sends the current turn's", () => {
    const ids = ["pin", "a", "old", "new", "turn"];
    const dataUrls = new Map(ids.map((id) => [id, `data:${id}`]));
    const request = buildRequest(
      input({ messages: history, kept: keptImages(baseChat, history, 10), dataUrls }),
    );
    const sent = JSON.stringify(request.messages);
    expect(sent).toContain(JSON.stringify(imageStub(upload("a"), "earlier")));
    expect(sent).toContain(JSON.stringify(imageStub(sheet("old"), "earlier")));
    expect(sent).toContain("data:pin");
    expect(sent).toContain("data:new");
    expect(sent).toContain("data:turn");
    expect(sent).not.toContain("data:old");
  });
});
