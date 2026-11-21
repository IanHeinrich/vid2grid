import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, TurnReceipt } from "../src/types";
import { durationText, receiptParts, renderReceipt } from "../src/ui/conversation/receipt";

const receipt: TurnReceipt = { rounds: 1, imagesSent: 0, durationMs: 15400, unseenCitations: [] };

function reply(usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number }) {
  const message: ChatMessage = {
    id: "a1",
    createdAt: 1,
    role: "assistant",
    text: "Done",
    toolCalls: [],
    ...(usage ? { usage } : {}),
  };
  return [message];
}

describe("receiptParts", () => {
  it("leaves out tokens and cost when the server reported no usage", () => {
    expect(receiptParts(receipt, reply(), undefined)).toEqual(["1 round", "0 images", "15 s"]);
  });

  it("prices the tokens when the model has a price", () => {
    const parts = receiptParts(receipt, reply({ promptTokens: 20_000, completionTokens: 1000 }), {
      inputPerMTok: 1,
      outputPerMTok: 10,
    });
    expect(parts).toEqual(["1 round", "0 images", "20k in / 1k out", "≈ $0.03", "15 s"]);
  });

  it("shows the cached share only when it is reported", () => {
    const parts = receiptParts(
      receipt,
      reply({ promptTokens: 4000, completionTokens: 10, cachedTokens: 1000 }),
      undefined,
    );
    expect(parts[2]).toBe("4k in (25% cached) / 10 out");
  });
});

describe("durationText", () => {
  it("keeps a tenth under ten seconds", () => {
    expect(durationText(4240)).toBe("4.2 s");
    expect(durationText(61_000)).toBe("61 s");
  });
});

describe("renderReceipt", () => {
  it("hides Check while a check runs and disables it while a turn runs", () => {
    const flagged = { ...receipt, unseenCitations: [5] };
    const checking = renderReceipt(flagged, reply(), undefined, {
      onSeek: vi.fn(),
      running: false,
    });
    expect(checking.querySelector(".unseen-check")).toBeNull();
    const onCheck = vi.fn();
    const running = renderReceipt(flagged, reply(), undefined, {
      onSeek: vi.fn(),
      onCheck,
      running: true,
    });
    expect(running.querySelector<HTMLButtonElement>(".unseen-check")?.disabled).toBe(true);
  });
});
