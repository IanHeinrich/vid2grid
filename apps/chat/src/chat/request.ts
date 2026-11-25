import { veniceOptions } from "../api/venice";
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
import {
  transcriptTexts,
  transcriptTokenCap,
  type HeardSpeech,
  type TranscriptTexts,
} from "./transcript";

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
  // Rebuilds the transcript the turn's message carries; absent when audio is off.
  speech?: HeardSpeech;
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

function textParts(text: string): ContentPart[] {
  return text.length > 0 ? [{ type: "text", text }] : [];
}

function userWire(
  message: UserMessage,
  input: BuildRequestInput,
  placement: ImagePlacement,
  transcript = "",
): WireMessage {
  if (message.images.length === 0) {
    const texts = [message.text, transcript].filter((text) => text.length > 0);
    return { role: "user", content: texts.join("\n\n") };
  }
  return {
    role: "user",
    content: [
      ...textParts(message.text),
      ...imageParts(message, input, placement),
      ...textParts(transcript),
    ],
  };
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

function listsTools({ allowTools, model, tools }: BuildRequestInput): boolean {
  return allowTools && model.tools && tools.length > 0;
}

function offersListen(input: BuildRequestInput): boolean {
  return listsTools(input) && input.audioCoverage?.canListen === true;
}

function sentTranscripts(view: SentView, input: BuildRequestInput): TranscriptTexts {
  return transcriptTexts(view.sent, {
    speech: input.speech,
    video: input.chat.video,
    capTokens: transcriptTokenCap(input.model),
    listen: offersListen(input),
  });
}

function sentCoverage(
  input: BuildRequestInput,
  { sentInFull }: TranscriptTexts,
): AudioCoverage | undefined {
  const { audioCoverage } = input;
  if (audioCoverage === undefined) return undefined;
  const { text, besideTranscript = text } = audioCoverage;
  return { text: sentInFull ? besideTranscript : text, canListen: offersListen(input) };
}

function wireHistory(
  view: SentView,
  input: BuildRequestInput,
  transcripts: TranscriptTexts,
): WireHistory {
  const earlierImages = input.chat.settings.earlierImages ?? "describe";
  const placement: ImagePlacement = {
    holders: latestHolders(view.sent),
    earlier: earlierMessageIds(view.sent, earlierImages),
  };
  const system = buildSystemPrompt(input.chat, listsTools(input) ? input.toolGuidance : "");
  const messages: WireMessage[] = system.length > 0 ? [{ role: "system", content: system }] : [];
  // Right after the system prompt: it changes only when the cut moves, so the cache holds.
  if (view.carried) messages.push(userWire(view.carried, input, placement));
  let contextAt: number | undefined;
  for (const block of sanitise(view.visible)) {
    if ("role" in block) {
      contextAt = messages.length;
      const transcript = transcripts.byMessage.get(block.id);
      messages.push(userWire(block, input, placement, transcript));
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
  const { chat, tools } = input;
  const { temperature } = chat.settings;
  const reasoningEffort = requestEffort(input);
  const listTools = listsTools(input);
  const noTools = input.finalRound || input.answerNow === true;
  return {
    // Tools stay listed on the final round so history with tool calls still matches the template.
    ...(listTools ? { tools: [...tools] } : {}),
    ...(listTools && noTools ? { tool_choice: "none" as const } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
    stream: true,
    stream_options: { include_usage: true },
    ...veniceOptions(input.veniceParameters, chat.id),
  };
}

export function buildRequest(input: BuildRequestInput): ChatRequest {
  const { chat } = input;
  const view = sentView(chat, input.messages);
  const transcripts = sentTranscripts(view, input);
  const { messages, contextAt } = wireHistory(view, input, transcripts);
  const context = buildContext(chat, {
    timeline: input.timeline,
    cast: input.cast,
    thoroughness: input.thoroughness,
    audioCoverage: sentCoverage(input, transcripts),
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
