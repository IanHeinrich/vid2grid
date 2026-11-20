import { describe, expect, it } from "vitest";
import {
  VERIFY_SYSTEM_PROMPT,
  extractTimedClaims,
  parseVerdicts,
  verifyClaims,
  type TimedClaim,
  type VerifyDeps,
} from "../src/chat/verify";
import type { ChatRequest, ContentPart, ImageRef, StreamChat } from "../src/types";

function scriptedStream(replies: (string | Error)[], requests: ChatRequest[]): StreamChat {
  const queue = [...replies];
  return async function* (_settings, request) {
    await Promise.resolve();
    requests.push(request);
    const reply = queue.shift() ?? "";
    if (reply instanceof Error) throw reply;
    yield { type: "text", delta: reply };
    yield { type: "done", finishReason: "stop" };
  };
}

function frameRef(id: string): ImageRef {
  return {
    id,
    pinned: false,
    source: {
      kind: "sheet",
      call: "frames(0:05)",
      name: id,
      startSeconds: 5,
      endSeconds: 5,
      frameCount: 1,
    },
  };
}

function setup(replies: (string | Error)[] = [""]) {
  const requests: ChatRequest[] = [];
  const rendered: number[][] = [];
  const deps: VerifyDeps = {
    api: { baseUrl: "https://api.example", apiKey: "key" },
    streamChat: scriptedStream(replies, requests),
    modelId: "model",
    veniceParameters: true,
    signal: new AbortController().signal,
    renderFrames: (times) => {
      rendered.push(times);
      return Promise.resolve([frameRef("sheet-a")]);
    },
    loadImage: (ref) => Promise.resolve(`data:image/jpeg;base64,${ref.id}`),
  };
  return { deps, requests, rendered };
}

describe("extractTimedClaims", () => {
  it("keeps sentences with timestamps", () => {
    const text =
      "Let me look. At [0:05] she opens the door! Nothing else.\nThe dog barks at [1:02.5] and again at [1:10].";
    expect(extractTimedClaims(text)).toEqual([
      { claim: "At [0:05] she opens the door!", seconds: [5] },
      { claim: "The dog barks at [1:02.5] and again at [1:10].", seconds: [62.5, 70] },
    ]);
  });

  it("returns at most eight claims", () => {
    const text = Array.from({ length: 10 }, (_, index) => `Moment [0:0${index}] happens.`).join(
      " ",
    );
    expect(extractTimedClaims(text)).toHaveLength(8);
  });

  it("skips claims that would take the distinct times past nine", () => {
    const first = "[0:01] [0:02] [0:03] [0:04] [0:05] [0:06] [0:07] [0:08] all happen.";
    const text = `${first} Two more at [0:10] and [0:11]. Again [0:01]. One more [0:12].`;
    const claims = extractTimedClaims(text);
    expect(claims.map((claim) => claim.claim)).toEqual([
      first,
      "Again [0:01].",
      "One more [0:12].",
    ]);
    expect(new Set(claims.flatMap((claim) => claim.seconds)).size).toBe(9);
  });

  it("checks only bracketed or parenthesised times, not clock times in prose", () => {
    expect(extractTimedClaims("At 5:30 the next morning she left. The door opens (0:05).")).toEqual(
      [{ claim: "The door opens (0:05).", seconds: [5] }],
    );
  });

  it("counts a repeated time in one sentence once", () => {
    expect(extractTimedClaims("At [0:05] and [0:05] again.")).toEqual([
      { claim: "At [0:05] and [0:05] again.", seconds: [5] },
    ]);
  });
});

describe("verifyClaims", () => {
  const claims: TimedClaim[] = [
    { claim: "At [1:00] she waves.", seconds: [60] },
    { claim: "At [0:05] the door opens.", seconds: [5, 60] },
    { claim: "At [0:30] a car passes.", seconds: [30] },
  ];

  it("renders the claimed times once and asks about every claim", async () => {
    const { deps, requests, rendered } = setup([
      "1: confirmed: she waves\n2: CONTRADICTED - the door stays shut",
    ]);
    const checks = await verifyClaims(deps, claims);
    expect(rendered).toEqual([[5, 30, 60]]);
    const request = requests[0];
    expect(request?.tools).toBeUndefined();
    expect(request?.venice_parameters).toEqual({ include_venice_system_prompt: false });
    expect(request?.messages[0]).toEqual({ role: "system", content: VERIFY_SYSTEM_PROMPT });
    const user = request?.messages[1];
    const parts: ContentPart[] =
      user?.role === "user" && Array.isArray(user.content) ? user.content : [];
    expect(parts).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,sheet-a" },
    });
    expect(parts.at(-1)).toEqual({
      type: "text",
      text: "Claims:\n1. At [1:00] she waves.\n2. At [0:05] the door opens.\n3. At [0:30] a car passes.",
    });
    expect(checks).toEqual([
      { claim: "At [1:00] she waves.", seconds: [60], verdict: "confirmed", reason: "she waves" },
      {
        claim: "At [0:05] the door opens.",
        seconds: [5, 60],
        verdict: "contradicted",
        reason: "the door stays shut",
      },
      {
        claim: "At [0:30] a car passes.",
        seconds: [30],
        verdict: "unclear",
        reason: "The check gave no verdict for this claim.",
      },
    ]);
  });

  it("makes no request without claims", async () => {
    const { deps, requests, rendered } = setup();
    expect(await verifyClaims(deps, [])).toEqual([]);
    expect(requests).toHaveLength(0);
    expect(rendered).toHaveLength(0);
  });

  it("surfaces API errors", async () => {
    const { deps } = setup([new Error("500 Server Error")]);
    await expect(verifyClaims(deps, claims)).rejects.toThrow("500 Server Error");
  });
});

describe("parseVerdicts", () => {
  it("tolerates bullets, bold and other separators, keeping the first verdict per claim", () => {
    const claims: TimedClaim[] = [
      { claim: "a", seconds: [1] },
      { claim: "b", seconds: [2] },
    ];
    const reply = "- **1.** Unclear: too dark\n2) confirmed\n2: contradicted: second answer";
    expect(parseVerdicts(reply, claims)).toEqual([
      { claim: "a", seconds: [1], verdict: "unclear", reason: "too dark" },
      { claim: "b", seconds: [2], verdict: "confirmed", reason: "" },
    ]);
  });
});
