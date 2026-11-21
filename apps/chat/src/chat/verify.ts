import { streamReply, textRequest, type ModelCallDeps } from "../api/modelCall";
import { findTimestamps, formatTimestamp } from "../time";
import type { ClaimCheck, ClaimVerdict, ContentPart, ImageRef } from "../types";

const MAX_CLAIMS = 8;
// The frames tool renders at most nine moments.
const MAX_TIMES = 9;

export const VERIFY_SYSTEM_PROMPT = [
  "You check claims about a video against frames from it. Each frame has its timestamp printed on it.",
  "Judge each numbered claim only by what the frames show.",
  "Answer with one line per claim, in the form N: confirmed|contradicted|unclear: short reason, and nothing else.",
].join("\n");

export interface TimedClaim {
  claim: string;
  seconds: number[];
}

export function extractTimedClaims(text: string): TimedClaim[] {
  const claims: TimedClaim[] = [];
  const times = new Set<number>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const claim = sentence.trim();
    const found = findTimestamps(claim, { bare: false });
    const seconds = [...new Set(found.map((match) => match.seconds))];
    if (seconds.length === 0) continue;
    const added = seconds.filter((t) => !times.has(t));
    if (times.size + added.length > MAX_TIMES) continue;
    added.forEach((t) => times.add(t));
    claims.push({ claim, seconds });
    if (claims.length === MAX_CLAIMS) break;
  }
  return claims;
}

export interface VerifyDeps extends ModelCallDeps {
  renderFrames(times: number[]): Promise<ImageRef[]>;
  loadImage(ref: ImageRef): Promise<string>;
}

export async function verifyClaims(
  deps: VerifyDeps,
  claims: readonly TimedClaim[],
): Promise<ClaimCheck[]> {
  if (claims.length === 0) return [];
  const times = [...new Set(claims.flatMap((claim) => claim.seconds))].sort((a, b) => a - b);
  const refs = await deps.renderFrames(times);
  deps.signal.throwIfAborted();
  const images = await Promise.all(
    refs.map(async (ref): Promise<ContentPart> => ({
      type: "image_url",
      image_url: { url: await deps.loadImage(ref) },
    })),
  );
  const numbered = claims.map((claim, index) => `${index + 1}. ${claim.claim}`);
  const request = textRequest(deps, [
    { role: "system", content: VERIFY_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: `Frames at ${times.map((t) => formatTimestamp(t)).join(", ")}.` },
        ...images,
        { type: "text", text: `Claims:\n${numbered.join("\n")}` },
      ],
    },
  ]);
  return parseVerdicts(await streamReply(deps, request), claims);
}

const VERDICT_LINE =
  /^\s*(?:[-*•]\s*)?\**\s*(\d+)\s*[:.)]\s*\**\s*(confirmed|contradicted|unclear)\b\**\s*[:–—-]?\s*(.*)$/i;

const VERDICTS: readonly ClaimVerdict[] = ["confirmed", "contradicted", "unclear"];

export function parseVerdicts(reply: string, claims: readonly TimedClaim[]): ClaimCheck[] {
  const verdicts = new Map<number, { verdict: ClaimVerdict; reason: string }>();
  for (const line of reply.split(/\r?\n/)) {
    const match = VERDICT_LINE.exec(line);
    if (match === null) continue;
    const number = Number(match[1]);
    if (verdicts.has(number)) continue;
    const verdict = VERDICTS.find((name) => name === match[2]?.toLowerCase()) ?? "unclear";
    verdicts.set(number, { verdict, reason: (match[3] ?? "").trim() });
  }
  return claims.map((claim, index) => {
    const found = verdicts.get(index + 1);
    return {
      claim: claim.claim,
      seconds: claim.seconds,
      verdict: found?.verdict ?? "unclear",
      reason: found?.reason ?? "The check gave no verdict for this claim.",
    };
  });
}
