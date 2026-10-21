import { Vid2GridError, type Vid2GridErrorCode } from "./errors";
import { buildRenderPlan } from "./plan/buildRenderPlan";
import { resolveKeyframeSampling } from "./plan/keyframeFallback";
import { RENDER_PLAN_VERSION } from "./plan/renderPlan";
import { collagePlanRequestProblem, validateCollagePlanRequest } from "./plan/request";
import { displaySize, normalizeRotationClockwise } from "./probe/displaySize";
import { sheetDrawOps } from "./render/drawOps";

export interface EmbeddedCore {
  call(name: string, argsJson: string): string;
}

type Envelope =
  { ok: true; value: unknown } | { ok: false; code: Vid2GridErrorCode; message: string };

// Arguments arrive as parsed JSON, so each function trusts its caller for their shape.
const FUNCTIONS = new Map<string, (...args: never[]) => unknown>([
  ["buildRenderPlan", buildRenderPlan],
  ["collagePlanRequestProblem", collagePlanRequestProblem],
  ["validateCollagePlanRequest", validateCollagePlanRequest],
  ["sheetDrawOps", sheetDrawOps],
  ["resolveKeyframeSampling", resolveKeyframeSampling],
  ["displaySize", displaySize],
  ["normalizeRotationClockwise", normalizeRotationClockwise],
  ["version", () => RENDER_PLAN_VERSION],
]);

function invoke(name: string, argsJson: string): unknown {
  const fn = FUNCTIONS.get(name);
  if (fn === undefined) throw new Vid2GridError("internal", `unknown function "${name}"`);
  const args: unknown = JSON.parse(argsJson);
  if (!Array.isArray(args)) {
    throw new Vid2GridError("internal", "argsJson must be a JSON array of positional arguments");
  }
  return fn(...(args as never[]));
}

function failure(err: unknown): Envelope {
  if (err instanceof Vid2GridError) return { ok: false, code: err.code, message: err.message };
  return { ok: false, code: "internal", message: err instanceof Error ? err.message : String(err) };
}

function call(name: string, argsJson: string): string {
  try {
    const success: Envelope = { ok: true, value: invoke(name, argsJson) ?? null };
    return JSON.stringify(success);
  } catch (err) {
    return JSON.stringify(failure(err));
  }
}

const core: EmbeddedCore = { call };
Object.assign(globalThis, { vid2gridCore: core });
