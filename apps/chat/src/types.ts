import type { SoundEvent, TranscriptCue } from "@vid2grid/core";

export type Privacy = "private" | "anonymized" | "unknown";

export interface ModelInfo {
  id: string;
  name: string;
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
  reasoningEffortOptions: readonly string[];
  defaultReasoningEffort?: string;
  // 1 for models that keep only the latest image.
  maxImages: number;
  privacy: Privacy;
  contextTokens?: number;
  pricing?: { inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number };
  // Venice's own labels, e.g. "default_vision", "most_uncensored", "most_intelligent".
  traits: readonly string[];
  uncensored: boolean;
  recommended: boolean;
  beta: boolean;
  videoInput: boolean;
  audioInput: boolean;
  e2ee: boolean;
  description?: string;
  quantization?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
}

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
}

// How replies are written. The tool guidance adapts so a persona stays in character.
export type Voice = "analyst" | "character" | "narrator";

// How freely replies cite and talk about the video; absent means the voice's default.
export type VideoReferences = "free" | "few" | "none";

export type Thoroughness = "normal" | "thorough" | "exhaustive";

// What happens to images from before the newest user message: stubs to recall, or sent while they fit.
export type EarlierImages = "describe" | "send";

export interface ChatSettings {
  systemPrompt: string;
  voice?: Voice;
  videoReferences?: VideoReferences;
  // Substituted for {{char}} and {{user}} in the system prompt.
  characterName?: string;
  userName?: string;
  modelId: string;
  temperature?: number;
  reasoningEffort?: string;
  // Absent means Normal.
  thoroughness?: Exclude<Thoroughness, "normal">;
  sheetResolution: number | "auto";
  // Tool rounds a normal reply may use before it must answer; absent means the default.
  maxRounds?: number;
  // Absent means "describe".
  earlierImages?: EarlierImages;
}

export interface VideoAttachment {
  name: string;
  // name, size and lastModified joined, so a reattached file finds its cached sheets.
  fileKey: string;
  durationSeconds: number;
  width: number;
  height: number;
}

export interface SceneNote {
  timeSeconds: number;
  text: string;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  settings: ChatSettings;
  video?: VideoAttachment;
  sceneLog: SceneNote[];
  storySoFar?: StorySoFar;
}

// A summary that stands in for every message up to and including throughMessageId.
export interface StorySoFar {
  text: string;
  throughMessageId: string;
  // Still marks the cut once that message is deleted; absent on summaries saved before it existed.
  throughCreatedAt?: number;
  updatedAt: number;
}

export interface TimelineEntry {
  startSeconds: number;
  endSeconds: number;
  text: string;
  // Written by a zoom pass over denser frames.
  zoomed?: true;
}

// A moment the study could not describe confidently, left for a zoom pass to look at closely.
export interface UnclearSpan {
  startSeconds: number;
  endSeconds: number;
  reason: string;
  zoomed?: true;
}

// What a study was planned with beyond the video and model; absent fields use planStudy's defaults.
export interface StudyPlanOptions {
  windowSeconds?: number;
  framesPerWindow?: number;
  startSeconds?: number;
  endSeconds?: number;
}

// The result of "Study this video", kept per video so every chat using it shares it.
export interface VideoTimeline {
  fileKey: string;
  modelId: string;
  entries: TimelineEntry[];
  // Index of the next study window, so a paused study resumes where it stopped.
  nextWindow: number;
  windowCount: number;
  updatedAt: number;
  usage?: TokenUsage;
  // Kept so Resume after a reload plans the same windows.
  plan?: StudyPlanOptions;
  unclear?: UnclearSpan[];
}

export interface CastCard {
  id: string;
  name: string;
  description: string;
  firstSeenSeconds?: number;
}

export interface AudioSpan {
  startSeconds: number;
  endSeconds: number;
}

// What has been heard in a video, kept per video like its timeline and grown range by range.
export interface VideoAudio {
  fileKey: string;
  // The sound labels the events were scored against; new labels make the events stale.
  labels: string[];
  backgroundLabels: string[];
  speechSpans: AudioSpan[];
  soundSpans: AudioSpan[];
  speech: TranscriptCue[];
  events: SoundEvent[];
  noAudio?: true;
  updatedAt: number;
}

// What the model is told about a video's audio on a message with audio on.
export interface AudioCoverage {
  text: string;
  // False when the video has no audio track, so listen is not offered.
  canListen: boolean;
}

// The people or characters in a video, kept per video like its timeline.
export interface VideoCast {
  fileKey: string;
  cards: CastCard[];
  updatedAt: number;
}

export type ImageSource =
  | {
      kind: "sheet";
      // The call that produced it, as shown to the model, e.g. "look(60, 90)" or "overview".
      call: string;
      name: string;
      startSeconds: number;
      endSeconds: number;
      frameCount: number;
      // Longest edge in px as rendered; the overview is often smaller than the chat's resolution.
      resolution?: number;
    }
  | { kind: "upload"; name: string };

export interface ImageRef {
  // Key of the JPEG blob in the ImageStore.
  id: string;
  source: ImageSource;
  pinned: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface MessageBase {
  id: string;
  createdAt: number;
}

export interface UserMessage extends MessageBase {
  role: "user";
  text: string;
  images: ImageRef[];
  // Where the video was attached, so the conversation shows it inline at that point.
  video?: VideoAttachment;
  // Sent by "Keep going": shown as a small marker rather than a message bubble.
  continuation?: true;
  // How hard this message's reply investigates; absent means normal.
  thoroughness?: "thorough" | "exhaustive";
  // Saved before thoroughness tiers existed; reads as exhaustive.
  deep?: true;
  // Overrides the chat's and the tier's reasoning effort for this message's reply.
  reasoningEffort?: string;
  // Audio: this message's reply may call listen and is told what has been heard so far.
  audio?: true;
  // Swipes: the replies not shown, in swipe order. The shown reply sits at replyIndex among them.
  alternates?: AlternateReply[];
  replyIndex?: number;
  // The model that wrote the shown reply, once swiping has recorded it.
  replyModelId?: string;
}

export interface AlternateReply {
  messages: (AssistantMessage | ToolMessage)[];
  modelId?: string;
  createdAt: number;
}

export interface AssistantMessage extends MessageBase {
  role: "assistant";
  text: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  // Set on a reply forced to answer at the round limit, so the UI can offer "Keep going".
  stoppedAtRoundLimit?: true;
  // The reasoning was cut off and the reply answered without further thinking.
  reasoningCutShort?: true;
  // What this round's request cost, as the server reported it.
  usage?: TokenUsage;
  // Set on the final message of a turn.
  receipt?: TurnReceipt;
  verification?: ClaimCheck[];
}

export interface TurnReceipt {
  rounds: number;
  // Images sent across all of the turn's requests.
  imagesSent: number;
  durationMs: number;
  // Times the reply cites that no sheet in the conversation covers.
  unseenCitations: number[];
}

export type ClaimVerdict = "confirmed" | "contradicted" | "unclear";

export interface ClaimCheck {
  claim: string;
  seconds: number[];
  verdict: ClaimVerdict;
  reason: string;
}

// Images on a tool message are sent in one user message after the turn's tool replies.
export interface ToolMessage extends MessageBase {
  role: "tool";
  toolCallId: string;
  text: string;
  images: ImageRef[];
}

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage;

export type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  model: string;
  messages: WireMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  reasoning_effort?: string;
  tool_choice?: "auto" | "none";
  stream: true;
  stream_options?: { include_usage: boolean };
  venice_parameters?: { include_venice_system_prompt: boolean };
  prompt_cache_key?: string;
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "toolCalls"; calls: ToolCall[] }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason: string | null };

export type StreamChat = (
  settings: ApiSettings,
  request: ChatRequest,
  signal: AbortSignal,
) => AsyncIterable<StreamEvent>;

export interface ToolResult {
  text: string;
  images: ImageRef[];
  note?: SceneNote;
}

export type RunTool = (call: ToolCall) => Promise<ToolResult>;

export interface ImageStore {
  putImage(blob: Blob): Promise<string>;
  getImage(id: string): Promise<Blob | undefined>;
}

export interface SheetCache {
  getSheets(key: string): Promise<ImageRef[] | undefined>;
  putSheets(key: string, refs: ImageRef[]): Promise<void>;
}

export interface ChatStore extends ImageStore, SheetCache {
  listChats(): Promise<Chat[]>;
  getChat(id: string): Promise<Chat | undefined>;
  putChat(chat: Chat): Promise<void>;
  deleteChat(id: string): Promise<void>;
  listMessages(chatId: string): Promise<ChatMessage[]>;
  putMessage(chatId: string, message: ChatMessage): Promise<void>;
  deleteMessages(chatId: string, ids: readonly string[]): Promise<void>;
  getTimeline(fileKey: string): Promise<VideoTimeline | undefined>;
  putTimeline(timeline: VideoTimeline): Promise<void>;
  getCast(fileKey: string): Promise<VideoCast | undefined>;
  putCast(cast: VideoCast): Promise<void>;
  getAudio(fileKey: string): Promise<VideoAudio | undefined>;
  putAudio(audio: VideoAudio): Promise<void>;
  getVideoHandle(chatId: string): Promise<FileSystemFileHandle | undefined>;
  putVideoHandle(chatId: string, handle: FileSystemFileHandle): Promise<void>;
  deleteVideoHandle(chatId: string): Promise<void>;
}
