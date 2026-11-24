import { modelVisionProfile } from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/http";
import {
  inTimeOrder,
  lookAt,
  lookBatches,
  LOOKING_SYSTEM_PROMPT,
  MAX_ANSWER_CHARS,
  type LookRequest,
} from "../src/chat/looking";
import type { ChatRequest, ImageRef, StreamChat } from "../src/types";
import { model, upload } from "./support/factories";
import {
  answered,
  described,
  imageStore,
  looker,
  LOOKING_API,
  sentImageIds,
  textsOf,
  timedSheet,
} from "./support/looking";
import { waitForAbort } from "./support/streams";

function request(extra: Partial<LookRequest> = {}): LookRequest {
  return {
    kind: "described",
    images: [timedSheet("a", 0), upload("b")],
    question: "Who is there?",
    signal: new AbortController().signal,
    ...extra,
  };
}

describe("lookAt", () => {
  it("sends the pictures with their labels, what to pay attention to, and asks for usage", async () => {
    const requests: ChatRequest[] = [];
    const note = await lookAt(looker(["A dog."], requests), request());
    expect(note).toEqual(described(["a", "b"], "A dog.", { question: "Who is there?" }));
    expect(requests[0]).toMatchObject({
      model: "eyes",
      stream_options: { include_usage: true },
      messages: [{ role: "system", content: LOOKING_SYSTEM_PROMPT }, { role: "user" }],
    });
    expect(requests[0]).not.toHaveProperty("tools");
    expect(sentImageIds(requests[0])).toEqual(["a", "b"]);
    expect(textsOf(requests[0])).toEqual([
      "grid_a from overview: 0:00 to 0:10, 4 frames",
      "image b.png",
      "Describe these 2 pictures. Pay attention to what this asks: Who is there?",
    ]);
  });

  it("keeps what the server says was used", async () => {
    const usage = { promptTokens: 900, completionTokens: 40 };
    const streamChat: StreamChat = async function* () {
      await Promise.resolve();
      yield { type: "text", delta: "A dog." };
      yield { type: "usage", usage };
    };
    expect(await lookAt(looker([], [], { streamChat }), request())).toMatchObject({ usage });
  });

  it("leaves out what it thought and leaves the question out when there is none", async () => {
    const requests: ChatRequest[] = [];
    const note = await lookAt(
      looker(["<think>Hm.</think>A dog."], requests),
      request({ question: " ", images: [upload("b")] }),
    );
    expect(note).toEqual(described(["b"], "A dog."));
    expect(textsOf(requests[0])).toEqual(["image b.png", "Describe this picture."]);
  });

  it("sends only earlier questions about the same pictures, the newest that fit", async () => {
    const requests: ChatRequest[] = [];
    const earlier = [
      answered(["z"], "About another picture", { question: "Elsewhere?" }),
      described(["a"], "x".repeat(7000)),
      described(["a", "b"], "A dog and a cat."),
      ...Array.from({ length: 6 }, (_, n) => answered(["b"], `Answer ${n}`, { question: `Q${n}` })),
    ];
    await lookAt(looker(["Two."], requests), request({ kind: "answered", earlier }));
    const [context = "", task] = textsOf(requests[0]).slice(2);
    expect(task).toBe("Answer this from the pictures: Who is there?");
    expect(context).toContain("Asked: Q0\nAnswered: Answer 0");
    expect(context.indexOf("Answer 0")).toBeLessThan(context.indexOf("Answer 5"));
    expect(context).not.toContain("another picture");
    expect(context.length).toBeLessThan(6200);
    const fewer = earlier.slice(0, 4);
    await lookAt(looker(["Two."], requests), request({ earlier: fewer }));
    expect(textsOf(requests[1])[2]).toContain(
      "Asked: Describe the pictures.\nAnswered: A dog and a cat.",
    );
    expect(textsOf(requests[1])[2]).not.toContain("xxx");
  });
});

describe("lookAt failures", () => {
  const FAILED = "The looking model Eyes at localhost:5001 could not look at the pictures: ";

  it("names the model and its server, without the key", async () => {
    const looking = looker([new ApiError(500, "out of memory")]);
    const failure = await lookAt(looking, request()).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: `${FAILED}out of memory` });
    expect(String(failure)).not.toContain(LOOKING_API.apiKey);
  });

  it("counts an empty answer as a failure", async () => {
    await expect(lookAt(looker(["<think>Hm.</think> "]), request())).rejects.toThrow(
      `${FAILED}its answer was empty.`,
    );
  });

  it("fails when a picture is gone", async () => {
    const looking = looker(["x"], [], { store: imageStore(["a"]) });
    await expect(lookAt(looking, request())).rejects.toThrow("is no longer stored");
  });

  it("clips a long error", async () => {
    const failing = lookAt(looker([new Error("x".repeat(5000))]), request());
    const error = await failing.catch((problem: unknown) => problem);
    if (!(error instanceof Error)) throw new Error("Expected an error");
    expect(error.message).toBe(`${FAILED}${"x".repeat(500)}…`);
  });

  it("leaves a stop as it is", async () => {
    const controller = new AbortController();
    const streamChat: StreamChat = (_api, _request, signal) => waitForAbort(signal);
    const looked = lookAt(
      looker([], [], { streamChat }),
      request({ signal: controller.signal }),
    ).catch((error: unknown) => error);
    controller.abort();
    expect(await looked).toMatchObject({ name: "AbortError" });
  });
});

describe("what is sent and kept", () => {
  it("clips a long question, keeping it whole on the note", async () => {
    const requests: ChatRequest[] = [];
    const question = "why ".repeat(1000);
    const note = await lookAt(looker(["A dog."], requests), request({ question }));
    expect(textsOf(requests[0]).at(-1)?.length).toBeLessThan(1700);
    expect(note.question).toBe(question);
    const earlier = [answered(["a"], "Yes.", { question })];
    await lookAt(looker(["A dog."], requests), request({ earlier }));
    expect(textsOf(requests[1])[2]?.length).toBeLessThan(500);
  });

  it("stops reading an answer that never ends, and keeps the start of it", async () => {
    let read = 0;
    const streamChat: StreamChat = async function* () {
      await Promise.resolve();
      for (;;) {
        read += 1;
        yield { type: "text", delta: "a dog and a cat and " };
      }
    };
    const note = await lookAt(looker([], [], { streamChat }), request());
    expect(read).toBeLessThan(1000);
    expect(note.text.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS + 1);
    expect(note.text.endsWith("…")).toBe(true);
  });

  it("gives up on thinking that goes in circles", async () => {
    const streamChat: StreamChat = async function* () {
      await Promise.resolve();
      for (;;) yield { type: "reasoning", delta: "Let me look at this picture once more. " };
    };
    await expect(lookAt(looker([], [], { streamChat }), request())).rejects.toThrow(
      "it kept thinking without answering",
    );
  });
});

describe("lookBatches", () => {
  const known = "qwen3-6-27b";
  const tokens = (side: number) => modelVisionProfile(known).imageTokens?.(side) ?? 0;
  const sized = (id: string, resolution: number): ImageRef => {
    const image = timedSheet(id, 0);
    if (image.source.kind !== "sheet") throw new Error("Expected a sheet");
    return { ...image, source: { ...image.source, resolution } };
  };
  const ids = (images: ImageRef[], contextTokens?: number, maxImages = 4) => {
    const extra = contextTokens === undefined ? {} : { contextTokens };
    const eyes = { model: model(known, { maxImages, ...extra }), resolution: 1024 };
    return lookBatches(eyes, images).map((batch) => batch.map((image) => image.id));
  };
  const small = ["a", "b", "c", "d", "e"].map((id) => sized(id, 512));

  it("holds as many images as the model takes", () => {
    expect(ids(small)).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(ids(small.slice(0, 2), undefined, 0)).toEqual([["a"], ["b"]]);
    expect(ids([])).toEqual([]);
  });

  it("counts each image at its own size, whatever the chat renders now", () => {
    const context = 2 * 4 * tokens(512);
    expect(ids(small, context)).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(tokens(2048)).toBeGreaterThan(3 * tokens(512));
    expect(ids([sized("big", 2048), ...small.slice(0, 2)], context)).toEqual([["big"], ["a", "b"]]);
    expect(ids([upload("u"), sized("a", 512)], 2 * tokens(1024))).toEqual([["u"], ["a"]]);
  });

  it("still sends an image too large for its share", () => {
    expect(ids(small.slice(0, 2), 10)).toEqual([["a"], ["b"]]);
  });
});

describe("inTimeOrder", () => {
  it("puts pictures with a time in order and the rest after them", () => {
    const images = [upload("u1"), timedSheet("late", 20), upload("u2"), timedSheet("early", 0)];
    expect(inTimeOrder(images).map(({ id }) => id)).toEqual(["early", "late", "u1", "u2"]);
  });
});
