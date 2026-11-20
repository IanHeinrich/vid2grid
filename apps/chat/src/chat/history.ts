import { plural } from "../text";
import { formatSpan, formatTimestamp, sceneLogLines } from "../time";
import type {
  AssistantMessage,
  AudioCoverage,
  Chat,
  ChatMessage,
  ChatRequest,
  ChatSettings,
  ContentPart,
  EarlierImages,
  ImageRef,
  ModelInfo,
  StorySoFar,
  Thoroughness,
  ToolMessage,
  ToolSchema,
  UserMessage,
  VideoCast,
  VideoReferences,
  VideoTimeline,
  Voice,
  WireMessage,
} from "../types";
import { effortFor, lowestEffort } from "./thoroughness";

export function imagesOf(message: ChatMessage): readonly ImageRef[] {
  return message.role === "assistant" ? [] : message.images;
}

function pinnedIds(messages: readonly ChatMessage[]): Set<string> {
  const pinned = new Set<string>();
  for (const message of messages) {
    for (const image of imagesOf(message)) if (image.pinned) pinned.add(image.id);
  }
  return pinned;
}

export function latestOverview(messages: readonly ChatMessage[]): ImageRef[] {
  for (const message of [...messages].reverse()) {
    const overview = imagesOf(message).filter(
      (image) => image.source.kind === "sheet" && image.source.call === "overview",
    );
    if (overview.length > 0) return overview;
  }
  return [];
}

function newestUserIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

// Keep going continues the investigation it follows, so a continuation does not start a turn.
function turnStartIndex(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user" && message.continuation !== true) return index;
  }
  return newestUserIndex(messages);
}

// From the user message that started the investigation: what it asked and has produced so far.
export function currentTurn(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  return messages.slice(Math.max(0, turnStartIndex(messages)));
}

function earlierMessageIds(
  messages: readonly ChatMessage[],
  earlierImages: EarlierImages,
): Set<string> {
  if (earlierImages === "send") return new Set();
  const earlier = messages.slice(0, Math.max(0, turnStartIndex(messages)));
  return new Set(earlier.map((message) => message.id));
}

// Send mode: the overview keeps up to half the free slots, so the whole video stays in view.
// Describe mode: only pins and the current turn's images, overview included, are candidates;
// anything earlier, an earlier overview too, is a stub the model can recall.
export function selectImages(
  messages: readonly ChatMessage[],
  maxImages: number,
  earlierImages: EarlierImages = "describe",
): Set<string> {
  const kept = pinnedIds(messages);
  const candidates = earlierImages === "send" ? messages : currentTurn(messages);
  let overviewSlots = Math.floor(Math.max(0, maxImages - kept.size) / 2);
  for (const image of latestOverview(candidates)) {
    if (overviewSlots === 0) break;
    if (kept.has(image.id)) continue;
    kept.add(image.id);
    overviewSlots -= 1;
  }
  let slots = Math.max(0, maxImages - kept.size);
  for (const message of [...candidates].reverse()) {
    for (const image of [...imagesOf(message)].reverse()) {
      if (slots === 0) return kept;
      if (kept.has(image.id)) continue;
      kept.add(image.id);
      slots -= 1;
    }
  }
  return kept;
}

export function pinsExceedCap(messages: readonly ChatMessage[], maxImages: number): boolean {
  return pinnedIds(messages).size > maxImages;
}

function sheetTime(startSeconds: number, endSeconds: number): string {
  return endSeconds > startSeconds
    ? formatSpan(startSeconds, endSeconds)
    : formatTimestamp(startSeconds);
}

// Sheet names repeat across renders, so a sheet is recalled by its name and the call that made it.
export function recallName({ source }: ImageRef): string {
  return source.kind === "sheet" ? `${source.name} from ${source.call}` : source.name;
}

export function imageLabel(ref: ImageRef): string {
  const { source } = ref;
  switch (source.kind) {
    case "sheet":
      return `${recallName(ref)}: ${sheetTime(source.startSeconds, source.endSeconds)}, ${plural(source.frameCount, "frame")}`;
    case "upload":
      return `image ${source.name}`;
  }
}

export type StubReason = "earlier" | "imageLimit" | "noVision";

export function imageStub(ref: ImageRef, reason: StubReason = "imageLimit"): string {
  if (reason === "noVision") {
    return `[${imageLabel(ref)}. Not attached: this model cannot see images.]`;
  }
  const recall = `call recall("${recallName(ref)}") to see it again`;
  if (ref.source.kind === "upload") return `[${imageLabel(ref)}, sent earlier; ${recall}]`;
  return reason === "earlier"
    ? `[${imageLabel(ref)}. Sent earlier; ${recall}.]`
    : `[${imageLabel(ref)}. Not attached, to stay within the image limit; ${recall}.]`;
}

export const THOROUGH_GUIDANCE =
  "Thorough: look closer only where you are unsure, and record findings with note as you go. Stop and answer once you are confident.";

export const EXHAUSTIVE_GUIDANCE =
  "Exhaustive: investigate fully, across as many rounds as you need. Record findings with note as you go, since earlier images become stubs you can recall. Answer once you have seen enough.";

const TIER_GUIDANCE: Record<Thoroughness, string> = {
  normal: "",
  thorough: THOROUGH_GUIDANCE,
  exhaustive: EXHAUSTIVE_GUIDANCE,
};

export const AUDIO_GUIDANCE =
  'listen lines are in time order. Speech is [m:ss] "the words heard". A sound event is [m:ss-m:ss] label score, the score from 0 to 1 being how sure the sound model is, then its loudness relative to the surrounding few minutes of audio (quiet, moderate or loud, in dB) and, for a repeating sound, about how many times a minute it repeats. ' +
  "The audio is analysed on the user's machine, and speech can be misheard.";

export function audioNote({ text, canListen }: AudioCoverage): string {
  if (!canListen) return `Audio: ${text}.`;
  return `Audio: ${text}. Call listen(start, end) to read what is heard.\n${AUDIO_GUIDANCE}`;
}

export const FINAL_ROUND_NOTE =
  "No more tool calls for this message. Answer now from what you have already seen, in the voice set above, without mentioning this limit.";

export const ANSWER_NOW_NOTE =
  "Answer now, directly from what you have already seen, with no further deliberation and no tool calls, in the voice set above, without mentioning this.";

const VOICE_STYLES: Record<Voice, string> = {
  analyst: "",
  character:
    "Stay fully in character as the system prompt defines. Never mention tools, sheets, frames, grids or rounds.",
  narrator: "Narrate what happens in third-person prose.",
};

const REFERENCE_STYLES: Record<VideoReferences, string> = {
  free: "Cite moments as [m:ss]; you may refer to the video as a video.",
  few: "Use at most a few [m:ss] timestamps, only where they help the user find a moment.",
  none: "Write no timestamps.",
};

const NOT_A_RECORDING =
  "Never mention the video as a recording: what it shows is what happened in the scene.";

// What each voice asked for before references became a setting of their own.
const DEFAULT_REFERENCES: Record<Voice, VideoReferences> = {
  analyst: "free",
  character: "few",
  narrator: "few",
};

export function effectiveVideoReferences({
  voice,
  videoReferences,
}: Pick<ChatSettings, "voice" | "videoReferences">): VideoReferences {
  return videoReferences ?? DEFAULT_REFERENCES[voice ?? "analyst"];
}

export function answerStyle(
  voice: Voice = "analyst",
  references: VideoReferences = DEFAULT_REFERENCES[voice],
): string {
  const notARecording = references === "none" || (voice === "character" && references !== "free");
  const recording = notARecording ? [NOT_A_RECORDING] : [];
  return [VOICE_STYLES[voice], ...recording, REFERENCE_STYLES[references]]
    .filter((line) => line !== "")
    .join(" ");
}

const BEFORE_LOOKING_GUIDANCE =
  "If you write to the user before looking, keep it to one short line and claim nothing you have not seen yet.";

const CHAR_PLACEHOLDER = /\{\{char\}\}/gi;
const USER_PLACEHOLDER = /\{\{user\}\}/gi;

export function applyPersonaNames(
  prompt: string,
  { characterName, userName }: Pick<ChatSettings, "characterName" | "userName">,
): string {
  const named = (text: string, placeholder: RegExp, name: string | undefined) =>
    name === undefined || name.trim() === "" ? text : text.replace(placeholder, () => name.trim());
  return named(named(prompt, CHAR_PLACEHOLDER, characterName), USER_PLACEHOLDER, userName);
}

const CONTEXT_HEADING = "Context for this reply, from the app (not written by the user):";

function timelineSection(timeline: VideoTimeline): string {
  const entries = [...timeline.entries].sort((a, b) => a.startSeconds - b.startSeconds);
  const unclear = (timeline.unclear ?? []).filter((span) => span.zoomed !== true);
  const rows = [
    ...entries,
    ...unclear.map((span) => ({ ...span, text: `unclear: ${span.reason}` })),
  ].sort((a, b) => a.startSeconds - b.startSeconds);
  const lines = rows.map((row) => `[${formatSpan(row.startSeconds, row.endSeconds)}] ${row.text}`);
  if (timeline.nextWindow < timeline.windowCount) {
    const coveredTo = Math.max(...entries.map((entry) => entry.endSeconds));
    lines.push(`The study stopped early, so this only covers up to ${formatTimestamp(coveredTo)}.`);
  }
  if (unclear.length > 0) {
    lines.push("Look at the moments marked unclear yourself before describing them.");
  }
  return ["Video timeline (from a study pass):", ...lines].join("\n");
}

function castSection(cast: VideoCast): string {
  const lines = cast.cards.map((card) => {
    const description = card.description.trim();
    const seen =
      card.firstSeenSeconds === undefined
        ? ""
        : ` (first seen [${formatTimestamp(card.firstSeenSeconds)}])`;
    return `- ${card.name.trim()}${description === "" ? "" : `: ${description}`}${seen}`;
  });
  return ["Cast:", ...lines].join("\n");
}

// Kept identical across a chat's requests so the server's prompt cache can reuse it.
export function buildSystemPrompt(chat: Chat, toolGuidance: string): string {
  const { settings, video } = chat;
  const sections = [applyPersonaNames(settings.systemPrompt, settings).trim()];
  if (video) {
    const tools = toolGuidance.trim();
    sections.push(
      tools === "" ? "" : `${tools}\n${BEFORE_LOOKING_GUIDANCE}`,
      answerStyle(settings.voice, effectiveVideoReferences(settings)),
    );
    sections.push(
      `Attached video: ${video.name}, ${formatTimestamp(video.durationSeconds)} long, ${video.width}x${video.height}.`,
    );
  }
  return sections.filter((section) => section.length > 0).join("\n\n");
}

export interface ContextParts {
  timeline?: VideoTimeline | undefined;
  cast?: VideoCast | undefined;
  thoroughness?: Thoroughness | undefined;
  // Present only when audio is on for this message: what has been heard so far.
  audioCoverage?: AudioCoverage | undefined;
  story?: string | undefined;
}

export function buildContext(
  chat: Chat,
  { timeline, cast, thoroughness = "normal", audioCoverage, story }: ContextParts,
): string {
  const sections: string[] = [];
  if (story !== undefined && story.trim() !== "") sections.push(`Chat summary: ${story.trim()}`);
  if (cast && cast.cards.length > 0) sections.push(castSection(cast));
  if (timeline && timeline.entries.length > 0) sections.push(timelineSection(timeline));
  if (chat.sceneLog.length > 0) {
    sections.push(["Scene log:", ...sceneLogLines(chat.sceneLog)].join("\n"));
  }
  if (audioCoverage !== undefined) sections.push(audioNote(audioCoverage));
  if (thoroughness !== "normal") sections.push(TIER_GUIDANCE[thoroughness]);
  return sections.join("\n\n");
}

// How many leading messages the story stands in for, or undefined when it no longer applies.
export function storyCut(
  story: StorySoFar | undefined,
  messages: readonly ChatMessage[],
): number | undefined {
  if (!story) return undefined;
  const through = messages.findIndex((message) => message.id === story.throughMessageId);
  if (through >= 0) return through + 1;
  const { throughCreatedAt } = story;
  if (throughCreatedAt === undefined) return undefined;
  const after = messages.findIndex((message) => message.createdAt > throughCreatedAt);
  return after < 0 ? messages.length : after;
}

// A branch keeps the story only if everything it summarises was copied into the branch.
export function storyForBranch(
  story: StorySoFar | undefined,
  copied: readonly ChatMessage[],
): StorySoFar | undefined {
  if (!story) return undefined;
  if (copied.some((message) => message.id === story.throughMessageId)) return story;
  const { throughCreatedAt } = story;
  if (throughCreatedAt === undefined) return undefined;
  return copied.some((message) => message.createdAt >= throughCreatedAt) ? story : undefined;
}

interface StorySplit {
  earlier: readonly ChatMessage[];
  messages: readonly ChatMessage[];
  story?: string;
}

function splitStory(chat: Chat, messages: readonly ChatMessage[]): StorySplit {
  const { storySoFar } = chat;
  const cut = storyCut(storySoFar, messages);
  if (!storySoFar || cut === undefined) return { earlier: [], messages };
  return { earlier: messages.slice(0, cut), messages: messages.slice(cut), story: storySoFar.text };
}

// The messages a request still sends once the story so far stands in for the earlier ones.
export function visibleMessages(
  chat: Chat,
  messages: readonly ChatMessage[],
): readonly ChatMessage[] {
  return splitStory(chat, messages).messages;
}

const STORY_IMAGES_HEADING =
  "Images from earlier in the conversation, kept after the chat summary replaced it:";

// Pins outlive the story's cut, so they travel in a message of their own. So does the latest
// overview in send mode; describe mode would only stub it, so it is left behind.
function storyImagesMessage(
  earlier: readonly ChatMessage[],
  visible: readonly ChatMessage[],
  earlierImages: EarlierImages,
): UserMessage | undefined {
  const later = new Set(visible.flatMap((message) => imagesOf(message).map((image) => image.id)));
  const carryOverview = earlierImages === "send" && latestOverview(visible).length === 0;
  const overview = carryOverview ? latestOverview(earlier) : [];
  const overviewIds = new Set(overview.map((image) => image.id));
  const carried = new Map<string, ImageRef>();
  for (const image of earlier.flatMap(imagesOf)) {
    const wanted = image.pinned || overviewIds.has(image.id);
    if (wanted && !later.has(image.id) && !carried.has(image.id)) carried.set(image.id, image);
  }
  if (carried.size === 0) return undefined;
  const images = [...carried.values()];
  return { id: "story-images", createdAt: 0, role: "user", text: STORY_IMAGES_HEADING, images };
}

// What a request sends: the images carried past the story's cut, if any, then the visible messages.
export function sentMessages(chat: Chat, messages: readonly ChatMessage[]): readonly ChatMessage[] {
  const { earlier, messages: visible } = splitStory(chat, messages);
  const carried = storyImagesMessage(earlier, visible, chat.settings.earlierImages ?? "describe");
  return carried ? [carried, ...visible] : visible;
}

export function keptImages(
  chat: Chat,
  messages: readonly ChatMessage[],
  maxImages: number,
): Set<string> {
  return selectImages(sentMessages(chat, messages), maxImages, chat.settings.earlierImages);
}

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

function newestUserMessage(messages: readonly ChatMessage[]): UserMessage | undefined {
  const newest = messages[newestUserIndex(messages)];
  return newest?.role === "user" ? newest : undefined;
}

function requestEffort(input: BuildRequestInput): string | undefined {
  const { chat, model } = input;
  if (input.answerNow) return lowestEffort(model);
  const newest = newestUserMessage(input.messages);
  const tier = input.thoroughness ?? "normal";
  return effortFor(tier, model, chat.settings.reasoningEffort, newest?.reasoningEffort);
}

export function buildRequest(input: BuildRequestInput): ChatRequest {
  const { chat, model, tools } = input;
  const { earlier, messages: visible, story } = splitStory(chat, input.messages);
  const earlierImages = chat.settings.earlierImages ?? "describe";
  const carried = storyImagesMessage(earlier, visible, earlierImages);
  const sent = carried ? [carried, ...visible] : visible;
  const placement: ImagePlacement = {
    holders: latestHolders(sent),
    earlier: earlierMessageIds(sent, earlierImages),
  };
  const system = buildSystemPrompt(chat, input.toolGuidance);
  const messages: WireMessage[] = system.length > 0 ? [{ role: "system", content: system }] : [];
  // Right after the system prompt: it changes only when the cut moves, so the cache holds.
  if (carried) messages.push(userWire(carried, input, placement));
  let contextAt: number | undefined;
  for (const block of sanitise(visible)) {
    if ("role" in block) {
      contextAt = messages.length;
      messages.push(userWire(block, input, placement));
    } else {
      messages.push(...turnWire(block, input, placement));
    }
  }
  const context = buildContext(chat, {
    timeline: input.timeline,
    cast: input.cast,
    thoroughness: input.thoroughness,
    audioCoverage: input.audioCoverage,
    story,
  });
  if (context.length > 0) {
    // After the stable history, so a new note only misses the prompt cache from here on.
    const wire: WireMessage = { role: "user", content: `${CONTEXT_HEADING}\n\n${context}` };
    messages.splice(contextAt ?? messages.length, 0, wire);
  }
  if (input.answerNow) messages.push({ role: "user", content: ANSWER_NOW_NOTE });
  else if (input.finalRound) messages.push({ role: "user", content: FINAL_ROUND_NOTE });
  const { temperature } = chat.settings;
  const reasoningEffort = requestEffort(input);
  const listTools = input.allowTools && model.tools && tools.length > 0;
  const noTools = input.finalRound || input.answerNow === true;
  return {
    model: chat.settings.modelId,
    messages,
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

const CHARS_PER_TOKEN = 4;
export const FALLBACK_IMAGE_TOKENS = 1500;

function wireText(message: WireMessage): string {
  switch (message.role) {
    case "system":
    case "tool":
      return message.content;
    case "user":
      if (typeof message.content === "string") return message.content;
      return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    case "assistant":
      return [
        message.content ?? "",
        ...(message.tool_calls ?? []).map((call) => call.function.name + call.function.arguments),
      ].join("");
  }
}

function imageUrls(message: WireMessage): string[] {
  if (message.role !== "user" || typeof message.content === "string") return [];
  return message.content.flatMap((part) => (part.type === "image_url" ? [part.image_url.url] : []));
}

export function requestImageCount(request: ChatRequest): number {
  return request.messages.reduce((sum, message) => sum + imageUrls(message).length, 0);
}

// Keyed by the URL each image is sent as, since the request no longer names its images.
export function sheetSidesByUrl(
  messages: readonly ChatMessage[],
  dataUrls: ReadonlyMap<string, string>,
): Map<string, number> {
  const sides = new Map<string, number>();
  for (const message of messages) {
    for (const { id, source } of imagesOf(message)) {
      const url = dataUrls.get(id);
      if (url !== undefined && source.kind === "sheet" && source.resolution !== undefined) {
        sides.set(url, source.resolution);
      }
    }
  }
  return sides;
}

// A rough count before sending, for display only: four characters a token plus a cost per image.
// Images missing from sides, such as uploads and older sheets, are priced at resolution.
export function estimateRequestTokens(
  request: ChatRequest,
  resolution: number,
  imageTokens?: (side: number) => number,
  sides: ReadonlyMap<string, number> = new Map(),
): number {
  const characters =
    request.messages.reduce((sum, message) => sum + wireText(message).length, 0) +
    (request.tools ? JSON.stringify(request.tools).length : 0);
  const imageCost = (url: string) =>
    imageTokens?.(sides.get(url) ?? resolution) ?? FALLBACK_IMAGE_TOKENS;
  const images = request.messages.flatMap(imageUrls);
  return (
    Math.ceil(characters / CHARS_PER_TOKEN) + images.reduce((sum, url) => sum + imageCost(url), 0)
  );
}
