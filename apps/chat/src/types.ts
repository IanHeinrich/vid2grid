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
  // The saved preset the instructions came from; they may have been edited since. Empty means the
  // user picked No preset, which stops matching the fields against presets.
  presetId?: string;
  modelId: string;
  // The model every picture goes to, in place of modelId; absent means modelId sees its own.
  lookingModelId?: string;
  // The server the looking model was picked on, so a change of API never moves the pictures.
  lookingBaseUrl?: string;
  // The user chose it, or chose none, so an empty chat no longer follows the default.
  lookingPicked?: true;
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

// Stays what the messages up to then are about where none of them names a video.
export interface RemovedVideo {
  video: VideoAttachment;
  throughCreatedAt: number;
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
  // The chat's own videos that were removed, oldest first.
  removedVideos?: RemovedVideo[];
  sceneLog: SceneNote[];
  storySoFar?: StorySoFar;
  // Absent means the chat is in no folder.
  folderId?: string;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  collapsed?: boolean;
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
  // More than one model worked on it, so its tokens have no one price.
  mixedModels?: true;
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
  // Replaces text in a request that carries the transcript; absent while no speech has been heard.
  besideTranscript?: string;
  // False when the video has no audio track, so listen is not offered.
  canListen: boolean;
}

// Which of a video's heard speech a message sent; the text is rebuilt from the stored speech.
export interface SentTranscript {
  fileKey: string;
  // What had been heard by then, so speech heard later does not change the text.
  spans: AudioSpan[];
  // Where the text stopped at its size cap.
  cutSeconds?: number;
}

// The people or characters in a video, kept per video like its timeline.
export interface VideoCast {
  fileKey: string;
  cards: CastCard[];
  updatedAt: number;
}

// In thousandths of the full picture's width and height, from its top left corner.
export interface ImageArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ZoomTarget =
  | { kind: "moment"; seconds: number; fileKey: string }
  // Another stored image: its blob id, and the name the model knows it by.
  | { kind: "image"; id: string; name: string };

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
      // Each frame's exact time, in cell order; absent on sheets rendered before it was recorded.
      cellTimes?: number[];
      // The video it was rendered from; absent on sheets rendered before it was recorded.
      fileKey?: string;
    }
  // originalId is a larger copy kept for zooming, when the picture was shrunk to be sent.
  | { kind: "upload"; name: string; originalId?: string }
  | {
      kind: "zoom";
      // The call as shown to the model, e.g. "zoom(1:02.5, 100, 200, 400, 500)".
      name: string;
      target: ZoomTarget;
      // What the picture really shows, after clamping and padding.
      area: ImageArea;
      width: number;
      height: number;
    };

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

// What the looking model said about pictures, which the writer reads in their place.
export interface SeenNote {
  // A description stands in for the message's own images; an answer is about images anywhere.
  kind: "described" | "answered";
  imageIds: string[];
  modelId: string;
  // What it was asked, or told to pay attention to.
  question?: string;
  text: string;
  // Absent when the note was reused, so it is counted once.
  usage?: TokenUsage;
}

interface MessageBase {
  id: string;
  createdAt: number;
}

export interface UserMessage extends MessageBase {
  role: "user";
  text: string;
  images: ImageRef[];
  seen?: SeenNote[];
  // The user asked for its pictures to be described afresh, so no earlier words are reused.
  lookAgain?: true;
  // Where the video was attached, so the conversation shows it inline at that point.
  video?: VideoAttachment;
  // The video attached here before it was removed from the chat: shown by name, and not in use.
  removedVideo?: VideoAttachment;
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
  // The transcript the message's reply was given, when it was given one.
  transcript?: SentTranscript;
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
  seen?: SeenNote[];
  // The user asked for its pictures to be described afresh, so no earlier words are reused.
  lookAgain?: true;
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
  // Set by a tool that has already asked the looking model about its images.
  seen?: SeenNote[];
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

// The stored images and videos that something refers to, by blob id and fileKey.
export interface ImageUse {
  images: ReadonlySet<string>;
  videos: ReadonlySet<string>;
}

// Just before the transaction is created, and again inside it once everything stored is read.
export type AskedWhen = "before" | "inside";

// What is in use but not saved, or undefined to delete nothing.
export type UnsavedUse = (when: AskedWhen) => ImageUse | undefined;

export interface UnusedImages {
  images: readonly string[];
  // The cache entries that go with them.
  sheets: readonly string[];
  bytes: number;
}

export interface ImageRelease {
  // Deletes those of the images, and the cached sheets of those videos, that nothing uses any more.
  releaseImages(dropped: ImageUse, unsaved: UnsavedUse): Promise<void>;
  countUnusedImages(unsaved: () => ImageUse): Promise<UnusedImages>;
  // Deletes what was counted and is still unused; undefined when unsaved said to delete nothing.
  deleteUnusedImages(counted: UnusedImages, unsaved: UnsavedUse): Promise<UnusedImages | undefined>;
}

export interface ChatStore extends ImageStore, SheetCache, ImageRelease {
  listChats(): Promise<Chat[]>;
  getChat(id: string): Promise<Chat | undefined>;
  putChat(chat: Chat): Promise<void>;
  // Changes the chat as it is stored, in one step; undefined when it is gone.
  changeChat(
    id: string,
    change: (stored: Chat, hasMessages: boolean) => Chat,
  ): Promise<Chat | undefined>;
  deleteChat(id: string): Promise<void>;
  // Per chat id, the fileKey of every video its chat or messages refer to; chats with none are absent.
  listVideoKeysByChat(): Promise<Map<string, string[]>>;
  listFolders(): Promise<Folder[]>;
  putFolder(folder: Folder): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  listMessages(chatId: string): Promise<ChatMessage[]>;
  // Rejects when the chat is gone, since what its messages refer to could then never be deleted.
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
