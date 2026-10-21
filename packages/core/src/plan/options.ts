import { Vid2GridError } from "../errors";
import { MODEL_RESOLUTION_PRESETS } from "../grid/modelProfiles";
import type { VideoInfo } from "../probe/videoInfo";
import { TRANSCRIPT_SCOPES, type CollagePlanRequest, type TranscriptScope } from "./request";

export type TranscriptOption = "none" | TranscriptScope;

export type HostCapability = "transcription";

export interface PlanOptionValues {
  startSeconds: number;
  endSeconds: number;
  targetFps: number;
  framesPerGrid: number;
  outputResolution: number;
  jpegQuality: number;
  keyframeSampling: boolean;
  maxKeyframes: number;
  frameCount: number;
  transcript: TranscriptOption;
}

export type OptionName = keyof PlanOptionValues;

// Undefined allowed so a CLI can pass its parsed flags straight through.
export type PlanOptionInput = { [Name in OptionName]?: PlanOptionValues[Name] | undefined };

interface OptionSpecBase {
  name: OptionName;
  flag: string;
  help: string;
  // A host without this capability leaves the option out.
  requires?: HostCapability;
}

// An option with no default is left out of the request, except endSeconds, which
// falls back to the video's duration. The bounds, in JSON Schema's naming, are exactly
// what collagePlanRequestProblem enforces on the field alone.
export interface NumberOptionSpec extends OptionSpecBase {
  type: "number" | "integer";
  default?: number;
  min?: number;
  max?: number;
  exclusiveMin?: number;
}

export interface BooleanOptionSpec extends OptionSpecBase {
  type: "boolean";
  default: boolean;
}

export interface EnumOptionSpec extends OptionSpecBase {
  type: "enum";
  values: readonly TranscriptOption[];
  default: TranscriptOption;
}

export type OptionSpec = NumberOptionSpec | BooleanOptionSpec | EnumOptionSpec;

// The web app starts on the first preset.
function firstModelResolution(): number {
  const [resolution] = Object.values(MODEL_RESOLUTION_PRESETS);
  if (resolution === undefined) throw new Error("MODEL_RESOLUTION_PRESETS is empty");
  return resolution;
}

const DEFAULTS = {
  startSeconds: 0,
  targetFps: 1,
  framesPerGrid: 9,
  outputResolution: firstModelResolution(),
  jpegQuality: 80,
  keyframeSampling: false,
  transcript: "none",
} as const satisfies Partial<PlanOptionValues>;

export const OPTION_SPECS: readonly OptionSpec[] = [
  {
    name: "startSeconds",
    flag: "start",
    type: "number",
    default: DEFAULTS.startSeconds,
    help: "start time in seconds",
  },
  {
    name: "endSeconds",
    flag: "end",
    type: "number",
    help: "end time in seconds, the video's duration when omitted",
  },
  {
    name: "targetFps",
    flag: "fps",
    type: "number",
    default: DEFAULTS.targetFps,
    exclusiveMin: 0,
    help: "frames sampled per second",
  },
  {
    name: "framesPerGrid",
    flag: "frames-per-grid",
    type: "integer",
    default: DEFAULTS.framesPerGrid,
    exclusiveMin: 0,
    help: "frames on each sheet",
  },
  {
    name: "outputResolution",
    flag: "resolution",
    type: "integer",
    default: DEFAULTS.outputResolution,
    exclusiveMin: 0,
    help: "sheet side in pixels",
  },
  {
    name: "jpegQuality",
    flag: "quality",
    type: "integer",
    default: DEFAULTS.jpegQuality,
    min: 1,
    max: 100,
    help: "JPEG quality, 1 to 100",
  },
  {
    name: "keyframeSampling",
    flag: "keyframes",
    type: "boolean",
    default: DEFAULTS.keyframeSampling,
    help: "capture the video's keyframes instead of sampling by fps",
  },
  {
    name: "maxKeyframes",
    flag: "max-keyframes",
    type: "integer",
    exclusiveMin: 0,
    help: "with keyframe sampling, thin the keyframes evenly to at most this many",
  },
  {
    name: "frameCount",
    flag: "frame-count",
    type: "integer",
    exclusiveMin: 0,
    help: "exactly this many evenly spaced frames, in place of the fps",
  },
  {
    name: "transcript",
    flag: "transcript",
    type: "enum",
    values: ["none", ...TRANSCRIPT_SCOPES],
    default: DEFAULTS.transcript,
    requires: "transcription",
    help: "transcript files: none, one per sheet, or one combined",
  },
];

export function optionSpecsFor(capabilities: readonly HostCapability[] = []): OptionSpec[] {
  return OPTION_SPECS.filter(
    (spec) => spec.requires === undefined || capabilities.includes(spec.requires),
  );
}

export function requestFromOptions(
  values: PlanOptionInput,
  info: Pick<VideoInfo, "durationSeconds">,
  capabilities: readonly HostCapability[] = [],
): CollagePlanRequest {
  const problem = optionInputProblem(values, optionSpecsFor(capabilities));
  if (problem !== undefined) throw new Vid2GridError("invalid_request", problem);
  const { frameCount, maxKeyframes } = values;
  const transcript = values.transcript ?? DEFAULTS.transcript;
  return {
    startSeconds: values.startSeconds ?? DEFAULTS.startSeconds,
    endSeconds: values.endSeconds ?? info.durationSeconds,
    targetFps: values.targetFps ?? DEFAULTS.targetFps,
    keyframeSampling: values.keyframeSampling ?? DEFAULTS.keyframeSampling,
    framesPerGrid: values.framesPerGrid ?? DEFAULTS.framesPerGrid,
    outputResolution: values.outputResolution ?? DEFAULTS.outputResolution,
    jpegQuality: values.jpegQuality ?? DEFAULTS.jpegQuality,
    ...(frameCount !== undefined && { frameCount }),
    ...(maxKeyframes !== undefined && { maxKeyframes }),
    ...(transcript !== "none" && { transcript: { scope: transcript } }),
  };
}

function optionInputProblem(
  values: Readonly<Record<string, unknown>>,
  specs: readonly OptionSpec[],
): string | undefined {
  for (const [name, value] of Object.entries(values)) {
    const spec = specs.find((offered) => offered.name === name);
    if (spec === undefined) return `unknown option "${name}"`;
    if (value === undefined) continue;
    const problem = optionValueProblem(spec, value);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

function optionValueProblem(spec: OptionSpec, value: unknown): string | undefined {
  switch (spec.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : `${spec.name} must be a number`;
    case "integer":
      return Number.isInteger(value) ? undefined : `${spec.name} must be an integer`;
    case "boolean":
      return typeof value === "boolean" ? undefined : `${spec.name} must be true or false`;
    case "enum":
      return spec.values.some((allowed) => allowed === value)
        ? undefined
        : `${spec.name} must be one of ${spec.values.join(", ")}`;
  }
}
