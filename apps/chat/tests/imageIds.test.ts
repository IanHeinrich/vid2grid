import { describe, expect, it } from "vitest";
import { checkedImageIds, checkedVideoKeys, imageIdsIn } from "../src/imageIds";
import type { Chat, ChatMessage, ImageRef } from "../src/types";
import { assistant, sheet, tool, user } from "./support/factories";
import { uploadRef, zoomRef } from "./support/images";

const REFUSED = "so nothing is deleted";
const as = (value: unknown) => value as ChatMessage;
const asRef = (value: unknown) => value as ImageRef;

describe.each([
  ["imageIdsIn", imageIdsIn],
  ["checkedImageIds", checkedImageIds],
])("%s", (_name, idsIn) => {
  it("gathers every image messages and refs refer to, once each", () => {
    const alternates = [
      { messages: [assistant("a", "old"), tool("t1", "c1", [zoomRef("z1", "o1")])], createdAt: 1 },
      { messages: [tool("t2", "c2", [uploadRef("p2")])], createdAt: 2 },
    ];
    const messages = [
      user("u", "hi", { images: [uploadRef("p1", "big")], alternates }),
      assistant("b", "shown"),
      tool("t3", "c3", [sheet("s1", 0, 1), uploadRef("p1")]),
    ];
    const refs = [zoomRef("z2", "p3")];
    const all = ["big", "o1", "p1", "p2", "p3", "s1", "z1", "z2"];
    expect([...idsIn({ messages, refs })].sort()).toEqual(all);
  });

  it("reads images and swipes wherever they are, assistant messages included", () => {
    const alternates = [{ messages: [tool("t", "c", [sheet("s2", 0, 1)])], createdAt: 1 }];
    const odd = as({ ...assistant("a", "hi"), images: [uploadRef("p", "big")], alternates });
    const nested = user("u", "hi", { alternates: [{ messages: [odd as never], createdAt: 1 }] });
    expect([...idsIn({ messages: [nested] })].sort()).toEqual(["big", "p", "s2"]);
  });
});

const withSource = (source: unknown) => asRef({ id: "odd", pinned: false, source });
const unknownRefs: [string, ImageRef][] = [
  ["an unknown source kind", withSource({ kind: "clip", name: "c", frameId: "f" })],
  ["no source", asRef({ id: "odd", pinned: false })],
  ["no id", asRef({ pinned: false, source: { kind: "upload", name: "n" } })],
  ["an unknown zoom target", withSource({ kind: "zoom", target: { kind: "clip", id: "f" } })],
  ["a zoom target without an id", withSource({ kind: "zoom", target: { kind: "image" } })],
  ["no zoom target", withSource({ kind: "zoom" })],
  ["an original that is not an id", withSource({ kind: "upload", name: "n", originalId: 3 })],
  ["only a string", asRef("odd")],
  ["nothing at all", asRef(undefined)],
];
const unknownMessages: [string, ChatMessage][] = [
  ["an unknown role", as({ ...user("u", "hi"), role: "system" })],
  ["no role", as({ id: "u", createdAt: 1, text: "hi", images: [] })],
  ["images that are not a list", as({ ...user("u", "hi"), images: { a: uploadRef("odd") } })],
  ["no images, from a user", as({ id: "u", createdAt: 1, role: "user", text: "hi" })],
  ["swipes that are not a list", as({ ...user("u", "hi"), alternates: { messages: [] } })],
  ["a swipe without messages", as({ ...user("u", "hi"), alternates: [{ createdAt: 1 }] })],
  ["an unknown swipe", as({ ...user("u", "hi"), alternates: [{ messages: [{ role: "x" }] }] })],
  ["nothing at all", as(undefined)],
];

describe("records of a kind this version does not know", () => {
  it.each(unknownRefs)("an image with %s stops a deletion but not a reading", (_what, ref) => {
    const messages = [tool("t", "c", [ref, sheet("s", 0, 1)])];
    expect(() => checkedImageIds({ refs: [ref] })).toThrow(REFUSED);
    expect(() => checkedImageIds({ messages })).toThrow(REFUSED);
    expect([...imageIdsIn({ messages })]).toContain("s");
  });

  it.each(unknownMessages)("a message with %s stops a deletion but not a reading", (_what, odd) => {
    const messages = [odd, tool("t", "c", [sheet("s", 0, 1)])];
    expect(() => checkedImageIds({ messages })).toThrow(REFUSED);
    expect([...imageIdsIn({ messages })]).toContain("s");
  });

  it("does not take a zoom into a moment for one", () => {
    const target = { kind: "moment", seconds: 1, fileKey: "v" };
    expect([...checkedImageIds({ refs: [withSource({ kind: "zoom", target })] })]).toEqual(["odd"]);
  });
});

describe("checkedVideoKeys", () => {
  const video = (fileKey: unknown) => ({ name: "v", fileKey });
  const chats = (value: unknown) => [{ id: "c", video: value }] as unknown as Chat[];

  it("gathers the videos of chats and of any message", () => {
    const messages = [
      as({ ...user("u", "hi"), video: video("b") }),
      as({ role: "x", video: video("d") }),
    ];
    expect([...checkedVideoKeys(chats(video("a")), messages)]).toEqual(["a", "b", "d"]);
    expect([...checkedVideoKeys(chats(undefined), [])]).toEqual([]);
  });

  it.each([[video(3)], [{}], ["a"], [null]])("refuses the video %j", (value) => {
    const messages = [as({ ...user("u", "hi"), video: value })];
    expect(() => checkedVideoKeys(chats(value), [])).toThrow(REFUSED);
    expect(() => checkedVideoKeys([], messages)).toThrow(REFUSED);
  });
});
