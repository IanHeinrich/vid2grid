import { describe, expect, it } from "vitest";
import { MODEL_RESOLUTION_PRESETS } from "../src/grid/modelProfiles";
import {
  OPTION_SPECS,
  optionSpecsFor,
  requestFromOptions,
  type HostCapability,
  type NumberOptionSpec,
  type OptionSpec,
} from "../src/plan/options";
import { collagePlanRequestProblem, type CollagePlanRequest } from "../src/plan/request";

const INFO = { durationSeconds: 42 };
const TRANSCRIBING: readonly HostCapability[] = ["transcription"];
const [FIRST_PRESET_RESOLUTION] = Object.values(MODEL_RESOLUTION_PRESETS);

const EVERY_OPTION = {
  startSeconds: 5,
  endSeconds: 10,
  targetFps: 2,
  keyframeSampling: true,
  maxKeyframes: 6,
  frameCount: 12,
  framesPerGrid: 4,
  outputResolution: 512,
  jpegQuality: 90,
};

function spec(name: OptionSpec["name"]): OptionSpec | undefined {
  return OPTION_SPECS.find((option) => option.name === name);
}

const NUMBER_SPECS = OPTION_SPECS.filter(
  (option): option is NumberOptionSpec => option.type === "number" || option.type === "integer",
);

// Wide enough that endSeconds > startSeconds holds for every value tried on either.
const WIDE_REQUEST: CollagePlanRequest = {
  ...requestFromOptions({}, INFO),
  startSeconds: -1e9,
  endSeconds: 1e9,
};

function boundaryCases(option: NumberOptionSpec): [value: number, accepted: boolean][] {
  const step = option.type === "integer" ? 1 : 1e-6;
  const cases: [number, boolean][] = [];
  if (option.min !== undefined) cases.push([option.min, true], [option.min - step, false]);
  if (option.exclusiveMin !== undefined) {
    cases.push([option.exclusiveMin, false], [option.exclusiveMin + step, true]);
  }
  if (option.min === undefined && option.exclusiveMin === undefined) cases.push([-1e6, true]);
  if (option.max !== undefined) cases.push([option.max, true], [option.max + step, false]);
  else cases.push([1e6, true]);
  return cases;
}

function plannerAccepts(option: NumberOptionSpec, value: number): boolean {
  return collagePlanRequestProblem({ ...WIDE_REQUEST, [option.name]: value }) === undefined;
}

function rejection(values: Record<string, unknown>): unknown {
  try {
    requestFromOptions(values, INFO, TRANSCRIBING);
  } catch (err) {
    return err;
  }
  return undefined;
}

describe("OPTION_SPECS", () => {
  it("names each option and flag once, flags in kebab-case", () => {
    const names = OPTION_SPECS.map((option) => option.name);
    const flags = OPTION_SPECS.map((option) => option.flag);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(flags).size).toBe(flags.length);
    for (const flag of flags) expect(flag).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("covers every request field a CLI sets", () => {
    const requestFields: (keyof CollagePlanRequest)[] = [
      "startSeconds",
      "endSeconds",
      "targetFps",
      "frameCount",
      "keyframeSampling",
      "maxKeyframes",
      "framesPerGrid",
      "outputResolution",
      "jpegQuality",
      "transcript",
    ];
    expect(OPTION_SPECS.map((option) => option.name).sort()).toEqual([...requestFields].sort());
  });

  it("keeps each number's default inside its own bounds", () => {
    for (const option of OPTION_SPECS) {
      if (option.type !== "number" && option.type !== "integer") continue;
      if (option.default === undefined) continue;
      expect(option.default).toBeGreaterThanOrEqual(option.min ?? -Infinity);
      expect(option.default).toBeLessThanOrEqual(option.max ?? Infinity);
      if (option.exclusiveMin !== undefined) {
        expect(option.default).toBeGreaterThan(option.exclusiveMin);
      }
      if (option.type === "integer") expect(Number.isInteger(option.default)).toBe(true);
    }
  });

  it.each(NUMBER_SPECS.map((option) => ({ name: option.name, option })))(
    "bounds $name exactly where the planner does",
    ({ option }) => {
      const cases = boundaryCases(option);
      expect(cases.map(([value]) => [value, plannerAccepts(option, value)])).toEqual(cases);
    },
  );

  it("offers the transcript scopes plus none, defaulting to none", () => {
    expect(spec("transcript")).toMatchObject({
      type: "enum",
      values: ["none", "per-sheet", "combined"],
      default: "none",
    });
  });

  it("defaults the resolution to the first model preset, as the web app starts", () => {
    expect(spec("outputResolution")).toMatchObject({ default: FIRST_PRESET_RESOLUTION });
  });
});

describe("optionSpecsFor", () => {
  it("marks only the transcript as needing a transcription port", () => {
    const needsTranscription = OPTION_SPECS.filter(
      (option) => option.requires === "transcription",
    ).map((option) => option.name);
    expect(needsTranscription).toEqual(["transcript"]);
  });

  it("offers a host only the options its capabilities can honour", () => {
    expect(optionSpecsFor()).toEqual(OPTION_SPECS.filter((option) => option.name !== "transcript"));
    expect(optionSpecsFor(TRANSCRIBING)).toEqual(OPTION_SPECS);
  });
});

describe("requestFromOptions", () => {
  it("fills every default, ending at the video's duration", () => {
    expect(requestFromOptions({}, INFO)).toEqual({
      startSeconds: 0,
      endSeconds: 42,
      targetFps: 1,
      keyframeSampling: false,
      framesPerGrid: 9,
      outputResolution: FIRST_PRESET_RESOLUTION,
      jpegQuality: 80,
    });
  });

  it("uses the spec's own defaults", () => {
    const request = requestFromOptions({}, INFO) as unknown as Record<string, unknown>;
    for (const option of OPTION_SPECS) {
      if (option.default === undefined || option.type === "enum") continue;
      expect(request[option.name]).toBe(option.default);
    }
  });

  it("builds a request the planner accepts from the defaults alone", () => {
    expect(collagePlanRequestProblem(requestFromOptions({}, INFO))).toBeUndefined();
  });

  it("treats an undefined value as unset", () => {
    expect(
      requestFromOptions(
        { endSeconds: undefined, frameCount: undefined, transcript: undefined },
        INFO,
        TRANSCRIBING,
      ),
    ).toEqual(requestFromOptions({}, INFO));
  });

  it("passes every given value through", () => {
    expect(
      requestFromOptions({ ...EVERY_OPTION, transcript: "combined" }, INFO, TRANSCRIBING),
    ).toEqual({
      ...EVERY_OPTION,
      transcript: { scope: "combined" },
    });
  });

  it("asks for per-sheet transcripts", () => {
    expect(requestFromOptions({ transcript: "per-sheet" }, INFO, TRANSCRIBING).transcript).toEqual({
      scope: "per-sheet",
    });
  });

  it("leaves validation to the planner", () => {
    expect(collagePlanRequestProblem(requestFromOptions({ jpegQuality: 0 }, INFO))).toBe(
      "jpeg_quality must be between 1 and 100",
    );
  });
});

describe("requestFromOptions's input checks", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["an unknown option", { fps: 2 }, 'unknown option "fps"'],
    ["an unknown option left undefined", { fps: undefined }, 'unknown option "fps"'],
    ["a string for a number", { targetFps: "2" }, "targetFps must be a number"],
    ["a non-finite number", { endSeconds: Infinity }, "endSeconds must be a number"],
    ["a fraction for an integer", { framesPerGrid: 2.5 }, "framesPerGrid must be an integer"],
    [
      "a string for a boolean",
      { keyframeSampling: "yes" },
      "keyframeSampling must be true or false",
    ],
    [
      "a value outside the enum",
      { transcript: "both" },
      "transcript must be one of none, per-sheet, combined",
    ],
  ])("rejects %s with an invalid_request error", (_case, values, message) => {
    expect(rejection(values)).toMatchObject({ code: "invalid_request", message });
  });

  it("treats an option the host cannot honour as unknown", () => {
    expect(() => requestFromOptions({ transcript: "combined" }, INFO)).toThrow(
      'unknown option "transcript"',
    );
  });
});
