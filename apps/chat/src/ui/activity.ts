import type { TurnEvent } from "../chat/agentLoop";
import { plural } from "../text";
import { formatSpan, formatTimestamp } from "../time";
import type { AssistantMessage, ImageRef, ToolCall, ToolMessage } from "../types";
import { seekButton } from "./buttons";
import { formatTokens } from "./tokenMeter";

const MAX_LISTED_MOMENTS = 4;
export const STALL_SECONDS = 90;

export type RequestStart = Extract<TurnEvent, { type: "requestStart" }>;

export function waitingStatus(request: RequestStart, seconds: number): string {
  const images = request.images === 0 ? "" : `${counted(request.images, "image")} `;
  const sent =
    request.round > 1
      ? `Round ${request.round} · waiting`
      : `Sent ${images}(≈${formatTokens(request.estimatedTokens)} tokens) · waiting for the model`;
  const stalled =
    seconds >= STALL_SECONDS ? " · this is taking unusually long; you can Stop and Retry" : "";
  return `${sent} · ${seconds}s${stalled}`;
}

export type TurnStep = AssistantMessage | ToolMessage;

export interface ActivityRender {
  // False once the turn has ended, so calls that never got a reply read as stopped.
  live: boolean;
  thumbnail(ref: ImageRef, messageId: string, index: number): HTMLElement;
  seek(seconds: number): void;
}

// The reply shown as the turn's answer: its last assistant message, once it asks for no more tools.
export function answerOf(steps: readonly TurnStep[]): AssistantMessage | undefined {
  const last = steps[steps.length - 1];
  return last?.role === "assistant" && last.toolCalls.length === 0 ? last : undefined;
}

function assistants(steps: readonly TurnStep[]): AssistantMessage[] {
  return steps.filter((step): step is AssistantMessage => step.role === "assistant");
}

// Text the model wrote on its way to the answer, shown above it as written before looking.
export function prefacesOf(steps: readonly TurnStep[]): AssistantMessage[] {
  const answer = answerOf(steps);
  return assistants(steps).filter((step) => step !== answer && step.text !== "");
}

export function hasActivity(steps: readonly TurnStep[]): boolean {
  return steps.some(
    (step) => step.role === "tool" || (step.reasoning ?? "") !== "" || step.toolCalls.length > 0,
  );
}

function parseArgs(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function momentsOf(call: ToolCall): number[] {
  const args = parseArgs(call.arguments);
  const times = args["times"];
  if (Array.isArray(times)) return times.filter((t): t is number => typeof t === "number");
  const t = args["t"];
  return typeof t === "number" ? [t] : [];
}

function namesOf(call: ToolCall): string[] {
  const names = parseArgs(call.arguments)["names"];
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === "string")
    : [];
}

function frameCount(call: ToolCall): number {
  if (call.name === "frame") return 1;
  return call.name === "frames" ? Math.max(1, momentsOf(call).length) : 0;
}

function counted(count: number, noun: string): string {
  return count === 0 ? "" : plural(count, noun);
}

export function activitySummary(steps: readonly TurnStep[]): string {
  const calls = assistants(steps).flatMap((step) => step.toolCalls);
  const thought = assistants(steps).some((step) => (step.reasoning ?? "") !== "");
  const parts = [
    thought ? "Thought" : "",
    counted(calls.filter((call) => call.name === "look").length, "look"),
    counted(
      calls.reduce((sum, call) => sum + frameCount(call), 0),
      "frame",
    ),
    counted(calls.filter((call) => call.name === "note").length, "note"),
  ].filter((part) => part !== "");
  return parts.length > 0 ? parts.join(" · ") : "Worked on it";
}

function listMoments(moments: readonly number[]): string {
  const listed = moments
    .slice(0, MAX_LISTED_MOMENTS)
    .map((moment) => formatTimestamp(moment))
    .join(", ");
  return moments.length > MAX_LISTED_MOMENTS ? `${listed}, …` : listed;
}

export function describeCall(call: ToolCall): string {
  const args = parseArgs(call.arguments);
  const start = args["start"];
  const end = args["end"];
  if (call.name === "look" && typeof start === "number" && typeof end === "number") {
    return `Looking at ${formatSpan(start, end)}…`;
  }
  const moments = momentsOf(call);
  if ((call.name === "frame" || call.name === "frames") && moments.length > 0) {
    return `Getting ${moments.length === 1 ? "the frame" : "frames"} at ${listMoments(moments)}…`;
  }
  if (call.name === "note") return "Taking a note…";
  if (call.name === "recall") {
    return `Re-opening ${plural(Math.max(1, namesOf(call).length), "earlier image")}…`;
  }
  return `Running ${call.name}…`;
}

export function toolSummary(message: ToolMessage, call: ToolCall | undefined): string {
  if (message.text.startsWith("Error:")) return firstLine(message.text);
  const moments = call ? momentsOf(call) : [];
  if (call?.name === "frames" && moments.length > 0) {
    return `${moments.length === 1 ? "Frame" : "Frames"} at ${listMoments(moments)}`;
  }
  const sheets = message.images.flatMap((ref) => (ref.source.kind === "sheet" ? [ref.source] : []));
  const first = sheets[0];
  if (first?.call.startsWith("frames(")) return `Frames at ${first.call.slice(7, -1)}`;
  if (first !== undefined && (call?.name === "frame" || first.call.startsWith("frame("))) {
    return `Frame at ${formatTimestamp(first.startSeconds)}`;
  }
  if (first !== undefined) {
    const start = Math.min(...sheets.map((sheet) => sheet.startSeconds));
    const end = Math.max(...sheets.map((sheet) => sheet.endSeconds));
    return `Looked at ${formatSpan(start, end)}`;
  }
  return firstLine(message.text);
}

// Tool replies end with a round counter meant for the model, not for the reader.
const ROUND_SUFFIX = /\s*\(Round \d+ of \d+\.[^)]*\)\s*$/;

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").replace(ROUND_SUFFIX, "").replace(/\.$/, "");
}

function thinkingBlock(messageId: string, reasoning: string): HTMLElement {
  const block = document.createElement("div");
  block.className = "activity-thinking";
  block.dataset["messageId"] = messageId;
  block.textContent = reasoning;
  return block;
}

function lookDensity(reply: ToolMessage): string | undefined {
  const sheets = reply.images.flatMap((ref) => (ref.source.kind === "sheet" ? [ref.source] : []));
  const first = sheets[0];
  if (first === undefined) return undefined;
  const start = Math.min(...sheets.map((sheet) => sheet.startSeconds));
  const end = Math.max(...sheets.map((sheet) => sheet.endSeconds));
  const frames = sheets.reduce((sum, sheet) => sum + sheet.frameCount, 0);
  return [
    `look ${formatSpan(start, end)}`,
    counted(frames, "frame"),
    `${first.frameCount} per sheet`,
    counted(sheets.length, "sheet"),
  ].join(" · ");
}

// What a finished call did, with every moment it names as a link that seeks the video.
function replyLabel(call: ToolCall, reply: ToolMessage, render: ActivityRender): (Node | string)[] {
  const fallback = [toolSummary(reply, call)];
  if (reply.text.startsWith("Error:")) return fallback;
  if (call.name === "look") return [lookDensity(reply) ?? fallback[0] ?? ""];
  if (call.name === "frame" || call.name === "frames") {
    const moments = momentsOf(call);
    if (moments.length === 0) return fallback;
    const links = moments.flatMap((moment, index) => [
      ...(index > 0 ? [", "] : []),
      seekButton(moment, (at) => render.seek(at)),
    ]);
    return [`${call.name} `, ...links];
  }
  if (call.name === "recall") {
    const names = reply.images.map((ref) => ref.source.name);
    return [`recall · ${(names.length > 0 ? names : namesOf(call)).join(", ")}`];
  }
  if (call.name === "note") {
    const args = parseArgs(call.arguments);
    const t = args["t"];
    const text = args["text"];
    if (typeof t !== "number" || typeof text !== "string") return fallback;
    return ["note ", seekButton(t, (at) => render.seek(at)), ` · ${text.trim()}`];
  }
  return fallback;
}

function pendingLabel(call: ToolCall, live: boolean): string {
  return live ? describeCall(call) : `${describeCall(call).replace(/…$/, "")} (stopped)`;
}

function callLine(
  call: ToolCall,
  reply: ToolMessage | undefined,
  render: ActivityRender,
): HTMLElement {
  const line = document.createElement("div");
  line.className = "activity-call";
  line.classList.toggle("is-pending", reply === undefined);
  const label = document.createElement("span");
  label.className = "activity-call-label";
  if (reply) label.append(...replyLabel(call, reply, render));
  else label.textContent = pendingLabel(call, render.live);
  line.append(label);
  if (reply && reply.images.length > 0) {
    const strip = document.createElement("div");
    strip.className = "activity-thumbs";
    strip.append(...reply.images.map((ref, index) => render.thumbnail(ref, reply.id, index)));
    line.append(strip);
  }
  return line;
}

export function renderActivityBody(
  container: HTMLElement,
  steps: readonly TurnStep[],
  render: ActivityRender,
): void {
  const replies = new Map(
    steps.flatMap((step) => (step.role === "tool" ? [[step.toolCallId, step] as const] : [])),
  );
  const called = new Set(assistants(steps).flatMap((step) => step.toolCalls.map((c) => c.id)));
  const nodes: HTMLElement[] = [];
  for (const step of steps) {
    if (step.role === "tool") {
      if (!called.has(step.toolCallId)) nodes.push(callLine(orphanCall(step), step, render));
      continue;
    }
    if ((step.reasoning ?? "") !== "") nodes.push(thinkingBlock(step.id, step.reasoning ?? ""));
    for (const call of step.toolCalls) nodes.push(callLine(call, replies.get(call.id), render));
  }
  container.replaceChildren(...nodes);
}

// What a streaming step shows in the body apart from its reasoning, which grows in place.
export function streamingBodyKey(step: AssistantMessage): string {
  const calls = step.toolCalls.map((call) => [call.id, call.name, call.arguments]);
  return JSON.stringify([(step.reasoning ?? "") !== "", calls]);
}

function orphanCall(reply: ToolMessage): ToolCall {
  return { id: reply.toolCallId, name: "", arguments: "" };
}

// Streaming reasoning only grows one block's text, so it is updated in place when that block exists.
export function updateStreamingReasoning(container: HTMLElement, step: AssistantMessage): boolean {
  const block = [...container.querySelectorAll<HTMLElement>(".activity-thinking")].find(
    (el) => el.dataset["messageId"] === step.id,
  );
  if (!block) return false;
  block.textContent = step.reasoning ?? "";
  return true;
}
