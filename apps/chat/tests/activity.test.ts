import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, ToolCall, ToolMessage, ZoomTarget } from "../src/types";
import {
  activitySummary,
  answerOf,
  hasActivity,
  prefacesOf,
  renderActivityBody,
  STALL_SECONDS,
  toolSummary,
  updateStreamingReasoning,
  waitingStatus,
} from "../src/ui/conversation/activity";

function assistant(
  id: string,
  calls: ToolCall[],
  extra: Partial<AssistantMessage> = {},
): AssistantMessage {
  return { id, createdAt: 0, role: "assistant", text: "", toolCalls: calls, ...extra };
}

function call(id: string, name: string, args: object): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

function reply(text: string): ToolMessage {
  return { id: "t", createdAt: 0, role: "tool", toolCallId: "c", text, images: [] };
}

describe("activitySummary", () => {
  it("counts looks, frames from both frame and frames calls, and notes", () => {
    const steps = [
      assistant("a1", [call("1", "look", {}), call("2", "frames", { times: [1, 2, 3] })], {
        reasoning: "Hmm",
      }),
      assistant("a2", [call("3", "frame", { t: 4 }), call("4", "look", {}), call("5", "note", {})]),
    ];
    expect(activitySummary(steps)).toBe("Thought · 2 looks · 4 frames · 1 note");
  });

  it("counts zooms apart from looks and frames", () => {
    const steps = [
      assistant("a1", [call("1", "zoom", {}), call("2", "zoom", {}), call("3", "frame", { t: 4 })]),
    ];
    expect(activitySummary(steps)).toBe("1 frame · 2 zooms");
  });

  it("leaves out parts that did not happen", () => {
    expect(activitySummary([assistant("a", [call("1", "look", {})])])).toBe("1 look");
  });
});

describe("answerOf and hasActivity", () => {
  it("treats the last assistant message without tool calls as the answer", () => {
    const final = assistant("a2", [], { text: "Done" });
    expect(answerOf([assistant("a1", [call("1", "look", {})]), final])).toBe(final);
    expect(answerOf([assistant("a1", [call("1", "look", {})])])).toBeUndefined();
    expect(hasActivity([final])).toBe(false);
    expect(hasActivity([{ ...final, reasoning: "Why" }])).toBe(true);
  });

  it("counts every other assistant text as a preface, and none of it as activity", () => {
    const looking = assistant("a1", [call("1", "look", {})], { text: "Let me look." });
    const final = assistant("a2", [], { text: "Done" });
    expect(prefacesOf([looking, final])).toEqual([looking]);
    expect(prefacesOf([{ ...looking, text: "" }, final])).toEqual([]);
    expect(hasActivity([{ ...looking, toolCalls: [] }, final])).toBe(false);
  });
});

describe("toolSummary", () => {
  it("drops the round counter and labels frames", () => {
    const suffix = " (Round 3 of 8. Batch several calls into one round when you can.)";
    expect(toolSummary(reply(`Noted at 1:42.${suffix}`), undefined)).toBe("Noted at 1:42");
    expect(toolSummary(reply("ok"), call("c", "frames", { times: [102, 105.5] }))).toBe(
      "Frames at 1:42, 1:45",
    );
  });
});

describe("waitingStatus", () => {
  const first = { type: "requestStart", round: 1, images: 4, estimatedTokens: 38_200 } as const;

  it("names the images and estimated tokens on the first round", () => {
    expect(waitingStatus(first, 18)).toBe(
      "Sent 4 images (≈38k tokens) · waiting for the model · 18s",
    );
    expect(waitingStatus({ ...first, images: 1 }, 0)).toBe(
      "Sent 1 image (≈38k tokens) · waiting for the model · 0s",
    );
  });

  it("leaves out the images when none were sent", () => {
    expect(waitingStatus({ ...first, images: 0, estimatedTokens: 2400 }, 3)).toBe(
      "Sent (≈2.4k tokens) · waiting for the model · 3s",
    );
  });

  it("is shorter on later rounds", () => {
    expect(waitingStatus({ ...first, round: 2 }, 6)).toBe("Round 2 · waiting · 6s");
  });

  it("suggests Stop and Retry once the wait reaches the stall limit", () => {
    expect(waitingStatus(first, STALL_SECONDS - 1)).not.toContain("unusually long");
    expect(waitingStatus({ ...first, round: 3 }, STALL_SECONDS)).toBe(
      "Round 3 · waiting · 90s · this is taking unusually long; you can Stop and Retry",
    );
  });
});

describe("zoom in the activity row", () => {
  const render = {
    live: true,
    thumbnail: () => document.createElement("span"),
    seek: vi.fn(),
  };
  const zoomed = (target: ZoomTarget, name: string): ToolMessage => ({
    id: "t1",
    createdAt: 0,
    role: "tool",
    toolCallId: "c1",
    text: "One image follows.",
    images: [
      {
        id: "z1",
        pinned: false,
        source: {
          kind: "zoom",
          name,
          target,
          area: { left: 100, top: 200, right: 400, bottom: 500 },
          width: 600,
          height: 450,
        },
      },
    ],
  });
  const zoomCall = call("c1", "zoom", { t: 62.5, left: 100, top: 200, right: 400, bottom: 500 });

  function labelOf(steps: (AssistantMessage | ToolMessage)[]): HTMLElement {
    const body = document.createElement("div");
    renderActivityBody(body, steps, render);
    const label = body.querySelector<HTMLElement>(".activity-call-label");
    if (!label) throw new Error("No label");
    return label;
  }

  it("says it is zooming in while the call is pending", () => {
    expect(labelOf([assistant("a1", [zoomCall])]).textContent).toBe("Zooming in…");
  });

  it("links the time of a zoom of a moment to the video", () => {
    const moment = zoomed({ kind: "moment", seconds: 62.5, fileKey: "k" }, "zoom(1:02.5, 1)");
    const label = labelOf([assistant("a1", [zoomCall]), moment]);
    expect(label.textContent).toBe("Zoomed in at 1:02.5");
    label.querySelector<HTMLButtonElement>(".timestamp")?.click();
    expect(render.seek).toHaveBeenCalledWith(62.5);
  });

  it("names the image a zoom looked into, and is not a look", () => {
    const image = zoomed({ kind: "image", id: "i1", name: "beach.jpg" }, "zoom(beach.jpg, 1)");
    expect(labelOf([assistant("a1", [zoomCall]), image]).textContent).toBe(
      "Zoomed in on beach.jpg",
    );
    expect(toolSummary(image, zoomCall)).toBe("Zoomed in on beach.jpg");
  });

  it("shows a failure's first line", () => {
    const failed = reply("Error: That area is empty.\nTry again.");
    expect(
      labelOf([assistant("a1", [zoomCall]), { ...failed, toolCallId: "c1" }]).textContent,
    ).toBe("Error: That area is empty");
  });
});

describe("recall in the activity row", () => {
  const render = {
    live: true,
    thumbnail: () => document.createElement("span"),
    seek: () => undefined,
  };

  it("labels a recall by how many images it re-opens, then by their names with thumbnails", () => {
    const names = ["grid_0002 from look(60, 90)", "beach.jpg"];
    const recall = call("c1", "recall", { names });
    const pending = document.createElement("div");
    renderActivityBody(pending, [assistant("a1", [recall])], render);
    expect(pending.querySelector(".activity-call-label")?.textContent).toBe(
      "Re-opening 2 earlier images…",
    );
    const recalled: ToolMessage = {
      id: "t1",
      createdAt: 0,
      role: "tool",
      toolCallId: "c1",
      text: ["grid_0002 from look(60, 90)", "beach.jpg", "2 images follow."].join("\n"),
      images: [
        {
          id: "i1",
          pinned: false,
          source: {
            kind: "sheet",
            call: "look(60, 90)",
            name: "grid_0002",
            startSeconds: 60,
            endSeconds: 90,
            frameCount: 4,
          },
        },
        { id: "i2", pinned: false, source: { kind: "upload", name: "beach.jpg" } },
      ],
    };
    const done = document.createElement("div");
    renderActivityBody(done, [assistant("a1", [recall]), recalled], render);
    expect(done.querySelector(".activity-call-label")?.textContent).toBe(
      "recall · grid_0002, beach.jpg",
    );
    expect(done.querySelectorAll(".activity-thumbs > *")).toHaveLength(2);
  });
});

describe("renderActivityBody", () => {
  const render = {
    live: true,
    thumbnail: () => document.createElement("span"),
    seek: () => undefined,
  };

  it("shows reasoning as a plain block inside the row, with no fold of its own", () => {
    const body = document.createElement("div");
    const steps = [
      assistant("a1", [call("c1", "look", { start: 0, end: 5 })], { reasoning: "Hmm." }),
    ];
    renderActivityBody(body, steps, render);
    const block = body.querySelector(".activity-thinking");
    expect(block?.tagName).toBe("DIV");
    expect(block?.textContent).toBe("Hmm.");
    expect(body.querySelector("details")).toBeNull();
  });

  it("leaves text out of the row, since the reply shows it", () => {
    const body = document.createElement("div");
    const steps = [
      assistant("a1", [call("c1", "look", { start: 0, end: 5 })], { text: "Looking." }),
    ];
    renderActivityBody(body, steps, render);
    expect(body.textContent).not.toContain("Looking.");
  });

  it("grows streaming reasoning in place, and says so only when its block exists", () => {
    const body = document.createElement("div");
    const step = assistant("a1", [], { reasoning: "Hm" });
    expect(updateStreamingReasoning(body, step)).toBe(false);
    renderActivityBody(body, [step, assistant("a2", [])], render);
    const block = body.querySelector(".activity-thinking");
    expect(updateStreamingReasoning(body, { ...step, reasoning: "Hmm, the dog." })).toBe(true);
    expect(body.querySelector(".activity-thinking")).toBe(block);
    expect(block?.textContent).toBe("Hmm, the dog.");
  });
});
