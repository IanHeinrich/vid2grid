import { describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import { OPTION_SPECS, type OptionName, type OptionSpec } from "@vid2grid/core";
import { queryElements } from "../src/dom";
import { createAppState } from "../src/state";
import { initFramePlanPanel } from "../src/ui/framePlanPanel";
import { initStatus } from "../src/ui/status";

vi.mock("@vid2grid/browser", () => ({}));

const INPUT_IDS: Partial<Record<OptionName, string>> = {
  startSeconds: "startTime",
  endSeconds: "endTime",
  targetFps: "targetFps",
  framesPerGrid: "framesPerGrid",
  outputResolution: "outputResolution",
  jpegQuality: "jpegQuality",
  keyframeSampling: "keyframeMode",
  transcript: "transcriptMode",
};

function input(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return element;
}

function markupInput(id: string): HTMLInputElement {
  document.body.innerHTML = indexHtml;
  return input(id);
}

// The frame plan panel overwrites the markup's resolution with the first model preset.
function startedInput(id: string): HTMLInputElement {
  document.body.innerHTML = indexHtml;
  const els = queryElements();
  initFramePlanPanel(els, createAppState(), { status: initStatus(els) });
  return input(id);
}

function optionalNumber(text: string | null): number | undefined {
  return text === null ? undefined : Number(text);
}

const specsWithInputs = OPTION_SPECS.flatMap(
  (spec): { name: string; id: string; spec: OptionSpec }[] => {
    const id = INPUT_IDS[spec.name];
    return id === undefined ? [] : [{ name: spec.name, id, spec }];
  },
);

// The app's form and a CLI built on OPTION_SPECS must start from the same request.
describe("index.html's inputs match OPTION_SPECS", () => {
  it.each(specsWithInputs)(
    "$name is #$id, in the markup and once the app starts",
    ({ id, spec }) => {
      const markup = markupInput(id);
      const started = startedInput(id);
      if (spec.type === "number" || spec.type === "integer") {
        // endTime is filled in from the video's duration once one loads.
        if (spec.default !== undefined) {
          expect(Number(markup.getAttribute("value"))).toBe(spec.default);
          expect(Number(started.value)).toBe(spec.default);
        }
      } else if (spec.type === "boolean") {
        expect(markup.hasAttribute("checked")).toBe(spec.default);
        expect(started.checked).toBe(spec.default);
      } else {
        expect(markup.hasAttribute("checked")).toBe(spec.default !== "none");
        expect(started.checked).toBe(spec.default !== "none");
      }
    },
  );

  // The form may be stricter than the planner, never looser.
  it.each(specsWithInputs)("$name's input bounds sit inside the spec's", ({ id, spec }) => {
    if (spec.type !== "number" && spec.type !== "integer") return;
    const element = markupInput(id);
    const min = optionalNumber(element.getAttribute("min"));
    const max = optionalNumber(element.getAttribute("max"));
    if (spec.min !== undefined) expect(min).toBeGreaterThanOrEqual(spec.min);
    if (spec.exclusiveMin !== undefined) expect(min).toBeGreaterThan(spec.exclusiveMin);
    if (spec.max !== undefined) expect(max).toBeLessThanOrEqual(spec.max);
  });
});
