import { describe, expect, it } from "vitest";
import { runAsk, type AskContext } from "../src/video/askTool";
import type { ChatMessage, ChatRequest, StreamChat } from "../src/types";
import { tool, upload, user } from "./support/factories";
import {
  answered,
  described,
  imageStore,
  looker,
  sentImageIds,
  textsOf,
  timedSheet,
} from "./support/looking";
import { waitForAbort } from "./support/streams";

const a = timedSheet("a", 0);
const b = { ...upload("b"), pinned: true };
const MESSAGES: ChatMessage[] = [
  user("u", "Look.", { images: [a, b], seen: [described(["a", "b"], "A dog.")] }),
  { ...tool("t", "c", [a]), seen: [answered(["a"], "Brown.", { question: "What colour?" })] },
];

function setup(replies: (string | Error)[], overrides: Parameters<typeof looker>[2] = {}) {
  const requests: ChatRequest[] = [];
  const controller = new AbortController();
  const ctx: AskContext = {
    looker: looker(replies, requests, overrides),
    messages: () => MESSAGES,
    signal: controller.signal,
  };
  return { ctx, requests, controller };
}

describe("ask", () => {
  it("asks about stored pictures from any turn, with what was asked of them before", async () => {
    const { ctx, requests } = setup(["A collie."]);
    const result = await runAsk(ctx, {
      question: " Which breed? ",
      pictures: ["b.png", "GRID_A from overview"],
    });
    expect(sentImageIds(requests[0])).toEqual(["a", "b"]);
    const texts = textsOf(requests[0]);
    expect(texts.at(-1)).toBe("Answer this from the pictures: Which breed?");
    expect(texts.at(-2)).toContain("Asked: What colour?\nAnswered: Brown.");
    expect(result).toEqual({
      text: "About grid_a from overview, b.png:\nA collie.",
      images: [a, { ...b, pinned: false }],
      seen: [answered(["a", "b"], "A collie.", { question: "Which breed?" })],
    });
  });

  it("answers about the pictures it can find and says what it cannot", async () => {
    const { ctx } = setup(["A collie."], { store: imageStore(["b"]) });
    const result = await runAsk(ctx, {
      question: "Which breed?",
      pictures: ["grid_a from overview", "b.png", "nothing.png"],
    });
    expect(result.images).toEqual([a]);
    expect(result.text).toMatch(/^About grid_a from overview:\nA collie\./);
    expect(result.text).toContain("b.png is no longer stored.");
    expect(result.text).toContain('No earlier image is named "nothing.png"');
  });

  it("keeps to what the looking model takes at once", async () => {
    const one = looker().model;
    const { ctx, requests } = setup(["A collie."], { model: { ...one, maxImages: 1 } });
    const result = await runAsk(ctx, { question: "Breed?", pictures: ["b.png", "grid_a"] });
    expect(sentImageIds(requests[0])).toEqual(["b"]);
    expect(result.text).toContain("Only 1 picture fit in one question");
  });

  it("refuses missing arguments and unknown pictures without asking", async () => {
    const { ctx, requests } = setup([]);
    const errors = await Promise.all([
      runAsk(ctx, { pictures: ["b.png"] }),
      runAsk(ctx, { question: "Breed?" }),
      runAsk(ctx, { question: "Breed?", pictures: ["nothing.png"] }),
    ]);
    for (const { text, images } of errors) {
      expect(text).toMatch(/^Error: /);
      expect(images).toEqual([]);
    }
    expect(requests).toEqual([]);
  });

  it("says when asking failed, so the turn goes on", async () => {
    const { ctx } = setup([new Error("offline")]);
    const result = await runAsk(ctx, { question: "Breed?", pictures: ["b.png"] });
    expect(result).toEqual({
      text: "Error: The looking model Eyes at localhost:5001 could not look at the pictures: offline",
      images: [],
    });
    const empty = await runAsk(setup([""]).ctx, { question: "Breed?", pictures: ["b.png"] });
    expect(empty.text).toContain("its answer was empty");
  });

  it("ends with a stop", async () => {
    const streamChat: StreamChat = (_api, _request, signal) => waitForAbort(signal);
    const { ctx, controller } = setup([], { streamChat });
    const asking = runAsk(ctx, { question: "Breed?", pictures: ["b.png"] });
    controller.abort();
    expect((await asking).text).toBe("Error: The question was stopped.");
  });
});
