import { describe, expect, it } from "vitest";
import {
  everyNote,
  seenText,
  unseenImages,
  withCurrentSeen,
  withoutDescription,
  withSeen,
  withSeenNotes,
} from "../src/chat/seen";
import type { ImageRef, ToolMessage } from "../src/types";
import { assistant, tool, upload, user } from "./support/factories";
import { answered, described, timedSheet } from "./support/looking";

const a = timedSheet("a", 0);
const b = upload("b");
const images = new Map<string, ImageRef>([
  ["a", a],
  ["b", b],
]);
const context = { images, canAsk: true };

describe("seenText", () => {
  it("puts what was seen in place of the pictures, with their names", () => {
    const message = user("u", "Look.", { images: [a, b], seen: [described(["a", "b"], "A dog.")] });
    expect(seenText(message, context)).toBe(
      [
        "Look.",
        "[Note from the app, not written by the user: what the looking model saw in the pictures named here.]\n[grid_a from overview: 0:00 to 0:10, 4 frames]\n[image b.png]\nA dog.\n[End of the app's note.]",
      ].join("\n\n"),
    );
  });

  it("says which pictures nobody has looked at, and how to ask about them", () => {
    const message = user("u", "", { images: [a, b], seen: [described(["a"], "A dog.")] });
    expect(seenText(message, context)).toContain(
      '[image b.png. Not looked at yet; call ask with "b.png" among its pictures to find out what it shows.]',
    );
    expect(seenText(message, { images, canAsk: false })).toContain(
      "[image b.png. Not looked at yet.]",
    );
  });

  it("adds an answer about earlier pictures as a note, unless the message was edited since", () => {
    const seen = [answered(["a", "b"], "Red.", { question: "What colour?" })];
    expect(seenText(user("u", "What colour?", { seen }), context)).toBe(
      "What colour?\n\n[Note from the app, not written by the user: the looking model was asked the message above about grid_a from overview, b.png, and answered this.]\nRed.\n[End of the app's note.]",
    );
    expect(seenText(user("u", "What shape?", { seen }), context)).toBe("What shape?");
  });

  it("leaves an ask reply as it is, its pictures already answered about", () => {
    const reply = { ...tool("t", "c", [a], "About grid_a: red."), seen: [answered(["a"], "Red.")] };
    expect(seenText(reply, context)).toBe("About grid_a: red.");
  });

  it("drops a description whose pictures have left the message", () => {
    const message = user("u", "Look.", { seen: [described(["a"], "A dog.")] });
    expect(seenText(message, context)).toBe("Look.");
  });
});

describe("unseenImages", () => {
  it("leaves out what a note covers and repeats", () => {
    const message = user("u", "", { images: [a, b, b], seen: [described(["a"], "A dog.")] });
    expect(unseenImages(message)).toEqual([b]);
  });
});

describe("an answer about a message's own pictures", () => {
  const seen = [answered(["a"], "Red.", { question: "What colour?" })];

  it("describes none of a user's, but an ask's are done with", () => {
    expect(unseenImages(user("u", "What colour?", { images: [a], seen }))).toEqual([a]);
    expect(unseenImages({ ...tool("t", "c", [a]), seen })).toEqual([]);
  });

  it("keeps a message that is to be looked at again marked", () => {
    const marked = user("u", "What colour?", { images: [a], seen, lookAgain: true });
    expect(withSeen(marked, seen)).toHaveProperty("lookAgain", true);
    expect(withSeen(marked, seen, new Set(["a"]))).not.toHaveProperty("lookAgain");
  });
});

describe("everyNote", () => {
  it("reads the replies kept as swipes", () => {
    const swiped = { ...tool("t", "c", [a]), seen: [described(["a"], "Old.")] };
    const alternates = [{ messages: [assistant("x", ""), swiped], createdAt: 1 }];
    const messages = [user("u", "hi", { alternates, seen: [described(["b"], "New.")] })];
    expect(everyNote(messages).map(({ text }) => text)).toEqual(["Old.", "New."]);
  });
});

describe("withSeenNotes", () => {
  it("carries the descriptions of images kept past a summary", () => {
    const carried = user("story", "Kept:", { images: [a] });
    const earlier = [user("u", "hi", { images: [a, b], seen: [described(["a", "b"], "A dog.")] })];
    expect(withSeenNotes(carried, earlier).seen).toEqual([described(["a", "b"], "A dog.")]);
    expect(withSeenNotes(carried, [])).toBe(carried);
  });
});

describe("withCurrentSeen", () => {
  const saved = user("u", "Old.", { images: [a], seen: [described(["a"], "A dog.")] });

  it("takes what was seen from the saved message, whatever an older copy holds", () => {
    const edited = user("u", "New.", { images: [a] });
    expect(withCurrentSeen(edited, [saved])).toEqual({ ...saved, text: "New." });
    expect(withCurrentSeen({ ...saved, text: "New." }, [edited])).toEqual(edited);
    expect(withCurrentSeen(edited, [])).toBe(edited);
  });

  it("takes its swipes from there too, so a mark that was cleared stays so", () => {
    const swipe = (reply: ToolMessage) => [{ messages: [reply], createdAt: 1 }];
    const current = user("u", "Hi.", { images: [a], alternates: swipe(tool("t", "c", [a])) });
    const marked = swipe({ ...tool("t", "c", [a]), lookAgain: true });
    const pinned = [{ ...a, pinned: true }];
    const stale = user("u", "Hi.", { images: pinned, alternates: marked });
    expect(withCurrentSeen(stale, [current])).toEqual({ ...current, images: pinned });
  });
});

describe("looking again", () => {
  const note = described(["a"], "A dog.");
  const message = user("u", "Look.", { images: [a, b], seen: [note, described(["b"], "A cat.")] });

  it("drops one description and marks the message", () => {
    const dropped = withoutDescription(message, { ...note });
    expect(dropped.seen).toEqual([described(["b"], "A cat.")]);
    expect(dropped.lookAgain).toBe(true);
  });

  it("is over once every picture has words again", () => {
    const dropped = withoutDescription(message, note);
    const part = withSeen(dropped, [described(["b"], "A cat.")]);
    expect(part).toHaveProperty("lookAgain", true);
    expect(withSeen(dropped, message.seen ?? [])).toEqual(message);
  });
});
