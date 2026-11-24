import { describe, expect, it } from "vitest";
import {
  AUDIO_GUIDANCE,
  answerStyle,
  audioNote,
  applyPersonaNames,
  buildContext,
  buildSystemPrompt,
  effectiveVideoReferences,
  EXHAUSTIVE_GUIDANCE,
  THOROUGH_GUIDANCE,
} from "../src/chat/prompts";
import type { VideoCast, VideoTimeline } from "../src/types";
import { baseChat, videoChat, NOT_YET } from "./support/requestFixtures";

describe("buildSystemPrompt", () => {
  it("is the chat's prompt and any tool guidance without a video", () => {
    expect(buildSystemPrompt(baseChat, "")).toBe("Be brief.");
    expect(buildSystemPrompt(baseChat, "Use zoom.")).toBe(["Be brief.", "Use zoom."].join("\n\n"));
  });

  it("adds tool guidance, the analyst answer style and video facts, but no scene log", () => {
    expect(buildSystemPrompt(videoChat, "Use look.")).toBe(
      [
        "Be brief.",
        "Use look.",
        answerStyle("analyst", "free"),
        "Attached video: beach.mp4, 2:05 long, 1920x1080.",
      ].join("\n\n"),
    );
  });

  it("keeps the video facts when there are no tools", () => {
    expect(buildSystemPrompt(videoChat, "")).toContain("Attached video: beach.mp4");
  });

  it("swaps the answer style for the chat's voice and keeps the tool guidance", () => {
    const voiced = (voice: "character" | "narrator") =>
      buildSystemPrompt({ ...videoChat, settings: { ...videoChat.settings, voice } }, "Use look.");
    const character = voiced("character");
    expect(character).toContain("Use look.");
    expect(character).toContain(answerStyle("character"));
    expect(character).not.toContain("Cite moments as [m:ss]");
    expect(voiced("narrator")).toContain(answerStyle("narrator"));
    expect(answerStyle("character")).toMatch(
      /never mention tools, sheets, frames, grids or rounds/i,
    );
    expect(answerStyle("narrator")).toContain("third-person");
    expect(answerStyle()).toBe(answerStyle("analyst"));
  });

  it("fills in persona names", () => {
    const settings = {
      ...baseChat.settings,
      systemPrompt: "You are {{char}}, talking to {{USER}}. {{Char}} is curious.",
      characterName: "Mira",
      userName: "Sam",
    };
    expect(buildSystemPrompt({ ...baseChat, settings }, "")).toBe(
      "You are Mira, talking to Sam. Mira is curious.",
    );
  });
});

describe("video references", () => {
  it("defaults video references to the voice, so older chats keep their meaning", () => {
    expect(effectiveVideoReferences({})).toBe("free");
    expect(effectiveVideoReferences({ voice: "analyst" })).toBe("free");
    expect(effectiveVideoReferences({ voice: "character" })).toBe("few");
    expect(effectiveVideoReferences({ voice: "narrator" })).toBe("few");
    expect(effectiveVideoReferences({ voice: "character", videoReferences: "free" })).toBe("free");
    expect(answerStyle("analyst")).toContain("Cite moments as [m:ss]");
    expect(answerStyle("character")).toContain("at most a few [m:ss] timestamps");
    expect(answerStyle("character")).toContain("Never mention the video as a recording");
    expect(answerStyle("narrator")).toContain("at most a few [m:ss] timestamps");
    expect(answerStyle("narrator")).not.toContain("recording");
  });

  it("combines the voice with the chosen video references", () => {
    const style = (videoReferences: "free" | "few" | "none") =>
      buildSystemPrompt(
        { ...videoChat, settings: { ...videoChat.settings, voice: "character", videoReferences } },
        "Use look.",
      );
    expect(style("free")).toContain(answerStyle("character", "free"));
    expect(answerStyle("character", "free")).toContain("Cite moments as [m:ss]");
    expect(answerStyle("character", "free")).not.toContain("recording");
    expect(answerStyle("character", "free")).toMatch(/never mention tools/i);
    expect(style("none")).toContain(answerStyle("character", "none"));
    expect(answerStyle("character", "none")).toContain("Write no timestamps.");
    expect(answerStyle("analyst", "none")).toContain("Never mention the video as a recording");
    expect(answerStyle("narrator", "none")).toContain("Never mention the video as a recording");
    expect(answerStyle("analyst", "few")).not.toContain("recording");
  });
});

describe("applyPersonaNames", () => {
  it("leaves placeholders alone when no name is set", () => {
    const prompt = "{{char}} meets {{user}}.";
    expect(applyPersonaNames(prompt, {})).toBe(prompt);
    expect(applyPersonaNames(prompt, { characterName: "  " })).toBe(prompt);
    expect(applyPersonaNames(prompt, { userName: "Sam" })).toBe("{{char}} meets Sam.");
  });

  it("inserts names literally", () => {
    expect(applyPersonaNames("{{char}}", { characterName: "$& $1" })).toBe("$& $1");
  });
});
describe("audio note", () => {
  it("adds the audio note only when audio is on, before thoroughness guidance", () => {
    const note = audioNote({
      text: "analysed 0:00 to 12:30 (speech and sounds)",
      canListen: true,
    });
    expect(note.split("\n")).toEqual([
      "Audio: analysed 0:00 to 12:30 (speech and sounds). Call listen(start, end) to read what is heard.",
      AUDIO_GUIDANCE,
    ]);
    expect(buildContext(baseChat, { audioCoverage: NOT_YET, thoroughness: "exhaustive" })).toBe(
      [audioNote(NOT_YET), EXHAUSTIVE_GUIDANCE].join("\n\n"),
    );
    expect(buildContext(baseChat, {})).not.toContain("Audio:");
    expect(AUDIO_GUIDANCE).toContain("on the user's machine");
    expect(AUDIO_GUIDANCE).toContain("score");
    expect(AUDIO_GUIDANCE).toContain("loudness relative to the surrounding few minutes of audio");
  });

  it("offers no listen call or guidance for a video with no audio track", () => {
    const note = audioNote({ text: "the video has no audio track", canListen: false });
    expect(note).toBe("Audio: the video has no audio track.");
  });
});

describe("buildContext", () => {
  const timeline: VideoTimeline = {
    fileKey: "k",
    modelId: "venice-model",
    entries: [
      { startSeconds: 60, endSeconds: 125, text: "a wave hits the dog" },
      { startSeconds: 0, endSeconds: 60, text: "a dog runs along the beach" },
    ],
    nextWindow: 2,
    windowCount: 2,
    updatedAt: 0,
  };

  it("is empty with nothing volatile to say", () => {
    expect(buildContext(baseChat, {})).toBe("");
  });

  it("holds the story, the timeline in order, the sorted scene log and deep guidance", () => {
    expect(
      buildContext(videoChat, { timeline, thoroughness: "exhaustive", story: "A dog came." }),
    ).toBe(
      [
        "Chat summary: A dog came.",
        "Video timeline (from a study pass):\n[0:00 to 1:00] a dog runs along the beach\n[1:00 to 2:05] a wave hits the dog",
        "Scene log:\n[0:12] dog runs\n[1:30] wave hits",
        EXHAUSTIVE_GUIDANCE,
      ].join("\n\n"),
    );
    expect(buildContext(videoChat, {})).not.toContain(EXHAUSTIVE_GUIDANCE);
  });

  it("says how far a partial timeline reaches", () => {
    const partial = { ...timeline, entries: timeline.entries.slice(1), nextWindow: 1 };
    expect(buildContext(baseChat, { timeline: partial })).toContain(
      "Video timeline (from a study pass):\n[0:00 to 1:00] a dog runs along the beach\nThe study stopped early, so this only covers up to 1:00.",
    );
  });

  it("leaves out an empty timeline", () => {
    const empty = { ...timeline, entries: [], nextWindow: 0 };
    expect(buildContext(baseChat, { timeline: empty })).toBe("");
  });

  const cast: VideoCast = {
    fileKey: "k",
    cards: [
      { id: "c1", name: "Mara ", description: "red coat", firstSeenSeconds: 72 },
      { id: "c2", name: "Rex", description: " " },
    ],
    updatedAt: 0,
  };

  it("lists the cast after the story, with first-seen times and no images", () => {
    expect(buildContext(videoChat, { cast, timeline, story: "A dog came." })).toBe(
      [
        "Chat summary: A dog came.",
        "Cast:\n- Mara: red coat (first seen [1:12])\n- Rex",
        "Video timeline (from a study pass):\n[0:00 to 1:00] a dog runs along the beach\n[1:00 to 2:05] a wave hits the dog",
        "Scene log:\n[0:12] dog runs\n[1:30] wave hits",
      ].join("\n\n"),
    );
  });

  it("leaves out an empty cast", () => {
    expect(buildContext(baseChat, { cast: { ...cast, cards: [] } })).toBe("");
  });
});
describe("buildContext thoroughness", () => {
  it("guides each tier differently and a normal reply not at all", () => {
    const thorough = buildContext(baseChat, { thoroughness: "thorough" });
    expect(thorough).toBe(THOROUGH_GUIDANCE);
    expect(thorough).toContain("unsure");
    expect(thorough).toContain("note");
    expect(thorough.startsWith("Thorough:")).toBe(true);
    expect(EXHAUSTIVE_GUIDANCE.startsWith("Exhaustive:")).toBe(true);
    expect(EXHAUSTIVE_GUIDANCE).toContain("stubs you can recall");
    expect(buildContext(baseChat, { thoroughness: "normal" })).toBe("");
  });
});

describe("buildContext unclear moments", () => {
  it("lists unzoomed unclear moments in order and asks the model to look there", () => {
    const flagged: VideoTimeline = {
      fileKey: "k",
      modelId: "venice-model",
      entries: [
        { startSeconds: 60, endSeconds: 125, text: "a wave hits the dog" },
        { startSeconds: 0, endSeconds: 60, text: "a dog runs along the beach" },
      ],
      nextWindow: 2,
      windowCount: 2,
      updatedAt: 0,
      unclear: [
        { startSeconds: 102, endSeconds: 107, reason: "a sign too small to read" },
        { startSeconds: 30, endSeconds: 32, reason: "already zoomed", zoomed: true },
      ],
    };
    expect(buildContext(baseChat, { timeline: flagged })).toBe(
      [
        "Video timeline (from a study pass):",
        "[0:00 to 1:00] a dog runs along the beach",
        "[1:00 to 2:05] a wave hits the dog",
        "[1:42.0 to 1:47.0] unclear: a sign too small to read",
        "Look at the moments marked unclear yourself before describing them.",
      ].join("\n"),
    );
  });
});
