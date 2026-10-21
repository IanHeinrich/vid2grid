import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import {
  optionSpecsFor,
  Vid2GridError,
  type HostCapability,
  type OptionSpec,
  type PlanOptionInput,
} from "@vid2grid/core";

// No transcript port yet, so the transcript option is never offered.
export const NODE_CAPABILITIES: readonly HostCapability[] = [];

const SPECS = optionSpecsFor(NODE_CAPABILITIES);

export type CliCommand =
  | { kind: "help" }
  | { kind: "render"; videoPath: string; outDir: string; options: PlanOptionInput };

export const USAGE = [
  "Usage: vid2grid-node <video> -o <dir> [options]",
  "",
  usageLine("-o, --out <dir>", "directory the sheets are written to"),
  ...SPECS.map((spec) => usageLine(`--${spec.flag}${valueHint(spec)}`, specHelp(spec))),
  usageLine("-h, --help", "show this help"),
].join("\n");

const PARSE_OPTIONS: ParseArgsOptionsConfig = {
  out: { type: "string", short: "o" },
  help: { type: "boolean", short: "h" },
  ...Object.fromEntries(
    SPECS.map((spec) => [spec.flag, { type: spec.type === "boolean" ? "boolean" : "string" }]),
  ),
};

export function parseCliArgs(argv: readonly string[]): CliCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: PARSE_OPTIONS,
  });
  if (values.help === true) return { kind: "help" };

  const [videoPath, ...extra] = positionals;
  if (videoPath === undefined || extra.length > 0) throw invalid("expected exactly one video");
  const outDir = values.out;
  if (typeof outDir !== "string") throw invalid("-o <dir> is required");

  const entries = SPECS.flatMap((spec) => {
    const value = optionValue(spec, values[spec.flag]);
    return value === undefined ? [] : [[spec.name, value] as const];
  });
  // requestFromOptions checks each value against its spec, so the entries need no
  // narrower type here.
  const options = Object.fromEntries(entries) as PlanOptionInput;
  return { kind: "render", videoPath, outDir, options };
}

function optionValue(spec: OptionSpec, raw: unknown): number | boolean | string | undefined {
  if (spec.type === "boolean") return raw === true ? true : undefined;
  if (typeof raw !== "string") return undefined;
  if (spec.type === "enum") return raw;
  const text = raw;
  const value = Number(text);
  if (text.trim() === "" || !Number.isFinite(value)) {
    throw invalid(`--${spec.flag} expects a number, got "${text}"`);
  }
  return value;
}

function valueHint(spec: OptionSpec): string {
  if (spec.type === "boolean") return "";
  if (spec.type === "enum") return ` <${spec.values.join("|")}>`;
  return " <n>";
}

function specHelp(spec: OptionSpec): string {
  return spec.default === undefined || spec.type === "boolean"
    ? spec.help
    : `${spec.help} (default: ${spec.default})`;
}

function usageLine(flags: string, help: string): string {
  return `  ${flags.padEnd(26)} ${help}`;
}

function invalid(message: string): Vid2GridError {
  return new Vid2GridError("invalid_request", message);
}
