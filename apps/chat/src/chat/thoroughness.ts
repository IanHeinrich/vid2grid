import type { ChatSettings, ModelInfo, Thoroughness, UserMessage } from "../types";

export const DEFAULT_MAX_ROUNDS = 8;
export const THOROUGH_MAX_ROUNDS = 15;
export const DEEP_MAX_ROUNDS = 30;

// Known levels, lowest first, so an unsupported level can fall to its nearest neighbour.
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const TIER_EFFORT: Record<Thoroughness, string | undefined> = {
  normal: undefined,
  thorough: "medium",
  exhaustive: "high",
};

export function messageThoroughness(message: UserMessage): Thoroughness {
  return message.thoroughness ?? (message.deep ? "exhaustive" : "normal");
}

// A higher tier never gets fewer rounds than the chat allows a normal reply.
export function roundsFor(tier: Thoroughness, chatMaxRounds: number | undefined): number {
  const normal = chatMaxRounds ?? DEFAULT_MAX_ROUNDS;
  switch (tier) {
    case "normal":
      return normal;
    case "thorough":
      return Math.max(THOROUGH_MAX_ROUNDS, normal);
    case "exhaustive":
      return Math.max(DEEP_MAX_ROUNDS, normal);
  }
}

function rank(level: string): number {
  return EFFORT_ORDER.indexOf(level);
}

function clampEffort(wanted: string, options: readonly string[]): string | undefined {
  if (options.includes(wanted)) return wanted;
  const target = rank(wanted);
  if (target < 0) return undefined;
  const known = options.filter((level) => rank(level) >= 0).sort((a, b) => rank(a) - rank(b));
  const below = known.filter((level) => rank(level) <= target);
  return below[below.length - 1] ?? known[0];
}

export function effortFor(
  tier: Thoroughness,
  model: ModelInfo,
  chatEffort: string | undefined,
  messageEffort: string | undefined,
): string | undefined {
  if (model.reasoningEffortOptions.length === 0) return undefined;
  const wanted = messageEffort ?? chatEffort ?? TIER_EFFORT[tier];
  return wanted === undefined ? undefined : clampEffort(wanted, model.reasoningEffortOptions);
}

export function lowestEffort(model: ModelInfo): string | undefined {
  const options = model.reasoningEffortOptions;
  if (options.length === 0) return undefined;
  return clampEffort("none", options) ?? options[0];
}

export function withEffort(settings: ChatSettings, effort: string): ChatSettings {
  const next = { ...settings };
  if (effort === "") delete next.reasoningEffort;
  else next.reasoningEffort = effort;
  return next;
}
