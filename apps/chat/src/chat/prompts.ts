import { formatSpan, formatTimestamp } from "../time";
import type {
  AudioCoverage,
  Chat,
  ChatSettings,
  SceneNote,
  Thoroughness,
  VideoCast,
  VideoReferences,
  VideoTimeline,
  Voice,
} from "../types";

export function sceneLogLines(notes: readonly SceneNote[]): string[] {
  return [...notes]
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((note) => `[${formatTimestamp(note.timeSeconds)}] ${note.text}`);
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

export const CONTEXT_HEADING = "Context for this reply, from the app (not written by the user):";

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
