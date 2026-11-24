import { describe, expect, it } from "vitest";
import {
  sameTranscript,
  speechLines,
  transcriptSentText,
  transcriptTexts,
  transcriptTimes,
  transcriptToCarry,
  transcriptTokenCap,
  type HeardSpeech,
  type TranscriptContext,
} from "../src/chat/transcript";
import type { AudioSpan, ChatMessage, SentTranscript, VideoAttachment } from "../src/types";
import { assistant, user } from "./support/factories";

const VIDEO: VideoAttachment = {
  name: "talk.mp4",
  fileKey: "talk",
  durationSeconds: 3600,
  width: 1920,
  height: 1080,
};
const CAP = 16_000;

function span(startSeconds: number, endSeconds: number): AudioSpan {
  return { startSeconds, endSeconds };
}

function cue(start: number, text: string, length = 4) {
  return { start, end: start + length, text };
}

// One sentence every 30 seconds, so each is a line of its own.
function spoken(endSeconds: number, spans = [span(0, endSeconds)]): HeardSpeech {
  const speech = Array.from({ length: Math.ceil(endSeconds / 30) }, (_, index) =>
    cue(index * 30, `Sentence ${index}.`),
  );
  return { fileKey: "talk", speechSpans: spans, speech };
}

function context(extra: Partial<TranscriptContext> = {}): TranscriptContext {
  return { speech: spoken(600), video: VIDEO, capTokens: CAP, listen: true, ...extra };
}

function carrying(id: string, transcript: SentTranscript) {
  return user(id, "Question", { audio: true, transcript });
}

function heardTo(endSeconds: number): SentTranscript {
  return { fileKey: "talk", spans: [span(0, endSeconds)] };
}

describe("transcriptTokenCap", () => {
  it("is 16,000 tokens or a quarter of the context, whichever is smaller", () => {
    expect(transcriptTokenCap({ contextTokens: 256_000 })).toBe(16_000);
    expect(transcriptTokenCap({ contextTokens: 32_000 })).toBe(8_000);
    expect(transcriptTokenCap({})).toBe(8192);
  });
});

describe("speechLines", () => {
  it("merges neighbouring cues until a pause, twenty seconds or 240 characters", () => {
    const long = "word ".repeat(30).trim();
    const speech = [
      cue(0, " Hello ", 5),
      cue(5, "there.", 5),
      cue(10, "", 5),
      cue(13, "After a pause.", 5),
      cue(18, "Still.", 5),
      cue(23, "Going.", 5),
      cue(28, "On.", 4.5),
      cue(33, "Past twenty seconds.", 5),
      cue(38, long, 5),
      cue(43, long, 5),
    ];
    const lines = speechLines({ speech }, [span(0, 60)]);
    expect(lines.map((line) => [line.startSeconds, line.text])).toEqual([
      [0, "Hello there."],
      [13, "After a pause. Still. Going. On."],
      [33, `Past twenty seconds. ${long}`],
      [43, long],
    ]);
  });

  it("keeps to the spans given and never joins across a gap between them", () => {
    const speech = [cue(0, "A."), cue(9.5, "B.", 0.5), cue(10.5, "Unheard."), cue(11, "C.")];
    const lines = speechLines({ speech }, [span(0, 10), span(11, 20)]);
    expect(lines.map((line) => line.text)).toEqual(["A.", "B.", "C."]);
  });
});

describe("transcriptToCarry", () => {
  it("carries nothing until some speech has been heard", () => {
    const silent: HeardSpeech = {
      fileKey: "talk",
      speechSpans: [span(0, 300)],
      speech: [cue(0, " ")],
    };
    expect(transcriptToCarry([user("u1", "Hi")], silent, CAP)).toBeUndefined();
  });

  it("records the ranges heard on the first message, as a copy", () => {
    const speech = spoken(600, [span(0, 300), span(330, 600)]);
    const carried = transcriptToCarry([user("u1", "Hi")], speech, CAP);
    expect(carried).toEqual({ fileKey: "talk", spans: [span(0, 300), span(330, 600)] });
    expect(carried?.spans[0]).not.toBe(speech.speechSpans[0]);
  });

  it("carries a later one only when the text has grown by a quarter", () => {
    const messages = [carrying("u1", heardTo(600)), assistant("a1", "Ok"), user("u2", "More")];
    expect(transcriptToCarry(messages, spoken(660), CAP)).toBeUndefined();
    expect(transcriptToCarry(messages, spoken(900), CAP)).toEqual(heardTo(900));
  });

  it("does not carry it again once the cap keeps the text from growing", () => {
    const first = transcriptToCarry([], spoken(3600), 500);
    expect(first?.cutSeconds).toBeGreaterThan(0);
    const messages = [carrying("u1", first ?? heardTo(0)), assistant("a1", "Ok")];
    expect(transcriptToCarry(messages, spoken(7200), 500)).toBeUndefined();
  });

  it("carries it again at the cap once speech before its start has been heard", () => {
    const late = spoken(3600, [span(1800, 3600)]);
    const sent = transcriptToCarry([user("u1", "Hi")], late, 500);
    if (!sent) throw new Error("Expected a transcript");
    const messages = [carrying("u1", sent), assistant("a1", "Ok"), user("u2", "Hi")];
    const whole = spoken(3600);
    const again = transcriptToCarry(messages, whole, 500);
    expect(again?.spans).toEqual([span(0, 3600)]);
    const resent = carrying("u2", again ?? sent);
    const after = [...messages.slice(0, 2), resent, assistant("a2", "Ok"), user("u3", "Hi")];
    expect(transcriptToCarry(after, whole, 500)).toBeUndefined();
  });

  it("is never carried again by a Keep going whose turn already holds it", () => {
    const goingOn = user("u2", "Keep going", { audio: true, continuation: true });
    const held = [carrying("u1", heardTo(300)), assistant("a1", "Ok"), goingOn];
    expect(transcriptToCarry(held, spoken(3600), CAP)).toBeUndefined();
    const another = [...held, assistant("a2", "Ok"), { ...goingOn, id: "u3" }];
    expect(transcriptToCarry(another, spoken(3600), CAP)).toBeUndefined();
    const bare = [user("u1", "Hi", { audio: true }), assistant("a1", "Ok"), goingOn];
    expect(transcriptToCarry(bare, spoken(3600), CAP)).toEqual(heardTo(3600));
    const other = [
      carrying("u1", { ...heardTo(300), fileKey: "other" }),
      assistant("a1", "Ok"),
      goingOn,
    ];
    expect(transcriptToCarry(other, spoken(3600), CAP)).toEqual(heardTo(3600));
  });

  it("does not count one whose message got no reply, or another video's", () => {
    const unanswered = [carrying("u1", heardTo(600)), user("u2", "Hello?")];
    expect(transcriptToCarry(unanswered, spoken(600), CAP)).toEqual(heardTo(600));
    const other = { ...heardTo(600), fileKey: "other" };
    const elsewhere = [carrying("u1", other), assistant("a1", "Ok"), user("u2", "Hi")];
    expect(transcriptToCarry(elsewhere, spoken(600), CAP)).toEqual(heardTo(600));
  });
});

describe("transcriptTexts", () => {
  function only(messages: ChatMessage[], extra: Partial<TranscriptContext> = {}) {
    return transcriptTexts(messages, context(extra));
  }

  it("gives the current turn timed lines and what has been heard", () => {
    const { byMessage, sentInFull } = only([
      carrying("u1", { fileKey: "talk", spans: [span(0, 60), span(90, 150)] }),
      assistant("a1", "Looking."),
    ]);
    expect(sentInFull).toBe(true);
    const lines = byMessage.get("u1")?.split("\n") ?? [];
    expect(lines[0]).toContain("not written by the user");
    expect(lines[1]).toBe(
      "Heard so far: 0:00 to 1:00, 1:30 to 2:30. The rest of the video has not been heard yet, so no lines there does not mean no speech. Call listen(start, end) to hear more.",
    );
    expect(lines.slice(2)).toEqual([
      "[0:00] Sentence 0.",
      "[0:30] Sentence 1.",
      "[1:30] Sentence 3.",
      "[2:00] Sentence 4.",
    ]);
  });

  it("says when the whole video was heard", () => {
    const video = { ...VIDEO, durationSeconds: 600.2 };
    const text = only([carrying("u1", heardTo(600))], { video }).byMessage.get("u1");
    expect(text).toContain("Heard: 0:00 to 10:00, the whole video.");
    expect(text).not.toContain("not been heard yet");
  });

  it("is the same text once more speech has been heard", () => {
    const messages = [carrying("u1", heardTo(300))];
    const before = only(messages, { speech: spoken(300) }).byMessage.get("u1");
    expect(only(messages, { speech: spoken(1200) }).byMessage.get("u1")).toBe(before);
  });

  it("stops at the cap and says what is left out and how to read it", () => {
    const speech = spoken(3600);
    const record = transcriptToCarry([], speech, 200);
    if (!record) throw new Error("Expected a transcript");
    const messages = [carrying("u1", record)];
    const text = only(messages, { speech, capTokens: 200 }).byMessage.get("u1") ?? "";
    const cut = record.cutSeconds ?? 0;
    expect(text.split("\n").filter((line) => line.startsWith("["))).toHaveLength(cut / 30);
    expect(text).toContain(" to 1:00:00 is not included.");
    expect(text).toContain(`from ${cut} seconds on to read it.`);
    expect(only(messages, { speech }).byMessage.get("u1")).toBe(text);
    const smaller = only(messages, { speech, capTokens: 100 }).byMessage.get("u1") ?? "";
    expect(smaller.length).toBeLessThan(text.length);
    expect(smaller).toContain("is not included.");
  });

  it("leaves a stub on later turns and through a continuation keeps the text", () => {
    const first = carrying("u1", heardTo(570));
    const goingOn = user("u2", "Keep going", { audio: true, continuation: true });
    const continued = [first, assistant("a1", "Ok"), goingOn];
    expect(only(continued).sentInFull).toBe(true);
    const later = only([...continued, assistant("a2", "Ok"), user("u3", "Next")]);
    expect(later.sentInFull).toBe(false);
    expect(later.byMessage.get("u1")).toBe(
      "[Transcript of the video's speech up to 9:30. Sent earlier; call listen(start, end) to read any range again.]",
    );
  });

  it("never mentions listen when it is not offered", () => {
    const now = only([carrying("u1", { ...heardTo(600), cutSeconds: 300 })], { listen: false });
    expect(now.byMessage.get("u1")).toContain("5:00 to 10:00 is not included.");
    expect(now.byMessage.get("u1")).not.toContain("listen");
  });

  describe("on a later turn", () => {
    const later = [carrying("u1", heardTo(600)), assistant("a1", "Ok"), user("u2", "Hi")];

    it("keeps the full text where it was when listen is not offered", () => {
      const now = only(later.slice(0, 1), { listen: false });
      const { byMessage, sentInFull } = only(later, { listen: false });
      expect(byMessage.get("u1")).toBe(now.byMessage.get("u1"));
      expect(byMessage.get("u1")).toContain("[9:30] Sentence 19.");
      expect(sentInFull).toBe(true);
    });

    it("keeps only the newest of several in full", () => {
      const more = carrying("u2", heardTo(600));
      const { byMessage } = only([carrying("u1", heardTo(300)), assistant("a1", "Ok"), more], {
        listen: false,
      });
      expect(byMessage.get("u1")).toBe(
        "[Transcript of the video's speech up to 5:00. Sent earlier.]",
      );
      expect(byMessage.get("u2")).toContain("[9:30] Sentence 19.");
    });

    const otherVideo = { ...heardTo(300), fileKey: "other" };
    const back = [
      carrying("u1", heardTo(600)),
      assistant("a1", "Ok"),
      carrying("u2", otherVideo),
      assistant("a2", "Ok"),
      user("u3", "And here?", { audio: true }),
    ];

    it("keeps the full text of a video the chat came back to after another", () => {
      expect(transcriptToCarry(back, spoken(600), CAP)).toBeUndefined();
      const { byMessage, sentInFull } = only(back, { listen: false });
      expect(byMessage.get("u1")).toContain("[9:30] Sentence 19.");
      expect(byMessage.get("u2")).toBe(
        "[Transcript of an earlier video's speech up to 5:00. Sent earlier.]",
      );
      expect(sentInFull).toBe(true);
      expect(only(back).byMessage.get("u1")).toContain("call listen(start, end)");
      expect(only(back).sentInFull).toBe(false);
    });

    it("keeps it through a turn begun with the other video", () => {
      const { byMessage } = only(back.slice(0, 4), { listen: false });
      expect(byMessage.get("u1")).toContain("[9:30] Sentence 19.");
      expect(byMessage.get("u2")).toContain("an earlier video's speech");
    });

    it("is a stub when the text cannot be rebuilt, as when audio is off", () => {
      const { byMessage, sentInFull } = only(later, { listen: false, speech: undefined });
      expect(byMessage.get("u1")).toBe(
        "[Transcript of the video's speech up to 10:00. Sent earlier.]",
      );
      expect(sentInFull).toBe(false);
    });
  });

  it("names an earlier video's transcript as one, never in full", () => {
    const other = carrying("u1", { ...heardTo(600), fileKey: "other" });
    const stub = "[Transcript of an earlier video's speech up to 10:00. Sent earlier.]";
    expect(only([other])).toEqual({ byMessage: new Map([["u1", stub]]), sentInFull: false });
    const later = [other, assistant("a1", "Ok"), user("u2", "Hi")];
    expect(only(later, { listen: false }).byMessage.get("u1")).toBe(stub);
  });

  it("names every range when the speech is not simply from the start", () => {
    const gaps = { fileKey: "talk", spans: [span(0, 300), span(600, 900)] };
    const later = [carrying("u1", gaps), assistant("a1", "Ok"), user("u2", "Hi")];
    expect(only(later).byMessage.get("u1")).toBe(
      "[Transcript of the video's speech, 0:00 to 5:00, 10:00 to 15:00. Sent earlier; call listen(start, end) to read any range again.]",
    );
  });
});

describe("transcriptTimes", () => {
  it("gives the time each sent line shows, for the speech that is there", () => {
    const speech = { ...spoken(90), speech: [cue(12.9, "A."), cue(40, "B."), cue(70, "C.")] };
    const cut = { ...heardTo(90), cutSeconds: 70 };
    const messages = [carrying("u1", cut), assistant("a1", "Ok"), user("u2", "Hi")];
    expect(transcriptTimes(messages, speech, CAP)).toEqual([12, 40]);
    expect(transcriptTimes(messages, speech, 4)).toEqual([12]);
    expect(transcriptTimes(messages, { ...speech, fileKey: "other" }, CAP)).toEqual([]);
    expect(transcriptTimes(messages, undefined, CAP)).toEqual([]);
  });
});

describe("sameTranscript", () => {
  it("compares the video, the ranges and the cut", () => {
    expect(sameTranscript(undefined, undefined)).toBe(true);
    expect(sameTranscript(heardTo(60), undefined)).toBe(false);
    expect(sameTranscript(heardTo(60), heardTo(60))).toBe(true);
    expect(sameTranscript(heardTo(60), heardTo(90))).toBe(false);
    expect(sameTranscript(heardTo(60), { ...heardTo(60), cutSeconds: 30 })).toBe(false);
    expect(sameTranscript(heardTo(60), { ...heardTo(60), fileKey: "other" })).toBe(false);
  });
});

describe("transcriptSentText", () => {
  it("names where the transcript ends", () => {
    expect(transcriptSentText(heardTo(2530))).toBe("Transcript to 42:10 sent");
    expect(transcriptSentText({ ...heardTo(2530), cutSeconds: 600 })).toBe(
      "Transcript to 10:00 sent",
    );
  });

  it("names every range, up to the cut, when it is not simply from the start", () => {
    const gaps = { fileKey: "talk", spans: [span(0, 300), span(600, 900)] };
    expect(transcriptSentText(gaps)).toBe("Transcript of 0:00 to 5:00, 10:00 to 15:00 sent");
    expect(transcriptSentText({ ...gaps, cutSeconds: 720 })).toBe(
      "Transcript of 0:00 to 5:00, 10:00 to 12:00 sent",
    );
    expect(transcriptSentText({ ...gaps, cutSeconds: 600 })).toBe("Transcript to 5:00 sent");
    expect(transcriptSentText({ fileKey: "talk", spans: [span(600, 900)] })).toBe(
      "Transcript of 10:00 to 15:00 sent",
    );
  });
});
