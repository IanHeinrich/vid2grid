import { imageLabel, imagesOf, imageStub } from "../imageRefs";
import type {
  AssistantMessage,
  AudioCoverage,
  Chat,
  ChatMessage,
  ChatRequest,
  ContentPart,
  ModelInfo,
  Thoroughness,
  ToolMessage,
  ToolSchema,
  UserMessage,
  VideoCast,
  VideoTimeline,
  WireMessage,
} from "../types";
import { earlierMessageIds, newestUserMessage } from "./imageSelection";
import {
  ANSWER_NOW_NOTE,
  buildContext,
  buildSystemPrompt,
  CONTEXT_HEADING,
  FINAL_ROUND_NOTE,
} from "./prompts";
import { sentView, type SentView } from "./story";
import { effortFor, lowestEffort } from "./thoroughness";

export interface BuildRequestInput {
  chat: Chat;
  messages: readonly ChatMessage[];
  model: ModelInfo;
  kept: ReadonlySet<string>;
  dataUrls: ReadonlyMap<string, string>;
  tools: readonly ToolSchema[];
  toolGuidance: string;
  veniceParameters: boolean;
  allowTools: boolean;
  finalRound: boolean;
  thoroughness?: Thoroughness;
  // Retry a round that thought too long: answer at once, with the lowest reasoning effort.
  answerNow?: boolean;
  audioCoverage?: AudioCoverage;
  timeline?: VideoTimeline;
  cast?: VideoCast;
}

interface Turn {
  assistant: AssistantMessage;
  replies: ToolMessage[];
}

type Block = UserMessage | Turn;

// Interrupted turns leave tool calls without replies, which the API rejects, so both sides are trimmed.
function sanitise(messages: readonly ChatMessage[]): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    index += 1;
    if (message === undefined || message.role === "tool") continue;
    if (message.role === "user") {
      blocks.push(message);
      continue;
    }
    const callIds = new Set(message.toolCalls.map((call) => call.id));
    const replies: ToolMessage[] = [];
    for (let next = messages[index]; next?.role === "tool"; next = messages[index]) {
      index += 1;
      if (callIds.delete(next.toolCallId)) replies.push(next);
    }
    const answered = new Set(replies.map((reply) => reply.toolCallId));
    const toolCalls = message.toolCalls.filter((call) => answered.has(call.id));
    if (message.text.length > 0 || toolCalls.length > 0) {
      blocks.push({ assistant: { ...message, toolCalls }, replies });
    }
  }
  return blocks;
}

function latestHolders(messages: readonly ChatMessage[]): Map<string, ChatMessage> {
  const holders = new Map<string, ChatMessage>();
  for (const message of messages) {
    for (const image of imagesOf(message)) holders.set(image.id, message);
  }
  return holders;
}

interface ImagePlacement {
  holders: ReadonlyMap<string, ChatMessage>;
  // Messages before the current turn, whose images describe mode leaves as stubs.
  earlier: ReadonlySet<string>;
}

function imageParts(
  message: UserMessage | ToolMessage,
  input: BuildRequestInput,
  placement: ImagePlacement,
): ContentPart[] {
  const reason = placement.earlier.has(message.id) ? "earlier" : "imageLimit";
  return message.images.flatMap((image): ContentPart[] => {
    if (!input.model.vision) return [{ type: "text", text: imageStub(image, "noVision") }];
    const url = input.dataUrls.get(image.id);
    // A sheet reused from the cache can appear twice; only its latest appearance carries pixels.
    const sendable = input.kept.has(image.id) && placement.holders.get(image.id) === message;
    if (!sendable || url === undefined) return [{ type: "text", text: imageStub(image, reason) }];
    return [
      { type: "text", text: imageLabel(image) },
      { type: "image_url", image_url: { url } },
    ];
  });
}

function userWire(
  message: UserMessage,
  input: BuildRequestInput,
  placement: ImagePlacement,
): WireMessage {
  if (message.images.length === 0) return { role: "user", content: message.text };
  const textParts: ContentPart[] =
    message.text.length > 0 ? [{ type: "text", text: message.text }] : [];
  return { role: "user", content: [...textParts, ...imageParts(message, input, placement)] };
}

function turnWire(
  { assistant, replies }: Turn,
  input: BuildRequestInput,
  placement: ImagePlacement,
): WireMessage[] {
  const wire: WireMessage[] = [
    {
      role: "assistant",
      content: assistant.text.length > 0 ? assistant.text : null,
      ...(assistant.toolCalls.length > 0
        ? {
            tool_calls: assistant.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    },
    ...replies.map((reply): WireMessage => ({
      role: "tool",
      tool_call_id: reply.toolCallId,
      content: reply.text,
    })),
  ];
  const parts = replies.flatMap((reply) => imageParts(reply, input, placement));
  if (parts.length > 0) wire.push({ role: "user", content: parts });
  return wire;
}

interface WireHistory {
  messages: WireMessage[];
  contextAt: number | undefined;
}

function wireHistory(view: SentView, input: BuildRequestInput): WireHistory {
  const earlierImages = input.chat.settings.earlierImages ?? "describe";
  const placement: ImagePlacement = {
    holders: latestHolders(view.sent),
    earlier: earlierMessageIds(view.sent, earlierImages),
  };
  const system = buildSystemPrompt(input.chat, input.toolGuidance);
  const messages: WireMessage[] = system.length > 0 ? [{ role: "system", content: system }] : [];
  // Right after the system prompt: it changes only when the cut moves, so the cache holds.
  if (view.carried) messages.push(userWire(view.carried, input, placement));
  let contextAt: number | undefined;
  for (const block of sanitise(view.visible)) {
    if ("role" in block) {
      contextAt = messages.length;
      messages.push(userWire(block, input, placement));
    } else {
      messages.push(...turnWire(block, input, placement));
    }
  }
  return { messages, contextAt };
}

function requestEffort(input: BuildRequestInput): string | undefined {
  const { chat, model } = input;
  if (input.answerNow) return lowestEffort(model);
  const newest = newestUserMessage(input.messages);
  const tier = input.thoroughness ?? "normal";
  return effortFor(tier, model, chat.settings.reasoningEffort, newest?.reasoningEffort);
}

function requestOptions(input: BuildRequestInput): Omit<ChatRequest, "model" | "messages"> {
  const { chat, model, tools } = input;
  const { temperature } = chat.settings;
  const reasoningEffort = requestEffort(input);
  const listTools = input.allowTools && model.tools && tools.length > 0;
  const noTools = input.finalRound || input.answerNow === true;
  return {
    // Tools stay listed on the final round so history with tool calls still matches the template.
    ...(listTools ? { tools: [...tools] } : {}),
    ...(listTools && noTools ? { tool_choice: "none" as const } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
    stream: true,
    stream_options: { include_usage: true },
    ...(input.veniceParameters
      ? {
          venice_parameters: { include_venice_system_prompt: false },
          // Venice routes requests with the same key to the same prompt cache.
          prompt_cache_key: chat.id,
        }
      : {}),
  };
}

export function buildRequest(input: BuildRequestInput): ChatRequest {
  const { chat } = input;
  const view = sentView(chat, input.messages);
  const { messages, contextAt } = wireHistory(view, input);
  const context = buildContext(chat, {
    timeline: input.timeline,
    cast: input.cast,
    thoroughness: input.thoroughness,
    audioCoverage: input.audioCoverage,
    story: view.story,
  });
  if (context.length > 0) {
    // After the stable history, so a new note only misses the prompt cache from here on.
    const wire: WireMessage = { role: "user", content: `${CONTEXT_HEADING}\n\n${context}` };
    messages.splice(contextAt ?? messages.length, 0, wire);
  }
  if (input.answerNow) messages.push({ role: "user", content: ANSWER_NOW_NOTE });
  else if (input.finalRound) messages.push({ role: "user", content: FINAL_ROUND_NOTE });
  return { model: input.model.id, messages, ...requestOptions(input) };
}
