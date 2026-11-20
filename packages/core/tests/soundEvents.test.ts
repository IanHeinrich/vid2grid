import { describe, expect, it } from "vitest";
import { energyEnvelope } from "../src/audio/loudness";
import { soundEvents } from "../src/audio/soundEvents";
import { concat, pulseTrain, TEST_SAMPLE_RATE, tone } from "./audioSignals";

const LABELS = ["applause", "footsteps", "background noise"];

describe("soundEvents", () => {
  it("measures each merged event's loudness against the median and its repetition rate", () => {
    const samples = concat(tone(8, 0.1), pulseTrain(8, 120));
    const envelope = energyEnvelope(samples, TEST_SAMPLE_RATE);
    const windows = Array.from({ length: 15 }, (_, index) => ({
      startSeconds: index,
      endSeconds: index + 2,
      scores: index < 6 ? [0.1, 0.1, 0.8] : index < 8 ? [0.2, 0.2, 0.6] : [0.1, 0.8, 0.1],
    }));

    const events = soundEvents(windows, LABELS, envelope, {
      minScore: 0.5,
      backgroundLabels: ["background noise"],
      offsetSeconds: 30,
    });

    expect(events).toHaveLength(1);
    const [footsteps] = events;
    expect(footsteps).toMatchObject({
      label: "footsteps",
      startSeconds: 38,
      endSeconds: 46,
      score: 0.8,
    });
    expect(footsteps?.ratePerMinute).toBeCloseTo(120, 0);
    expect(footsteps?.loudnessDb).toBeCloseTo(4, 0);
  });

  it("leaves the rate out of a steady sound", () => {
    const envelope = energyEnvelope(concat(tone(4, 0.1), tone(4, 0.4)), TEST_SAMPLE_RATE);
    const windows = [4, 5, 6].map((start) => ({
      startSeconds: start,
      endSeconds: start + 2,
      scores: [0.9, 0.05, 0.05],
    }));

    const [applause] = soundEvents(windows, LABELS, envelope, { minScore: 0.5, offsetSeconds: 0 });

    expect(applause).not.toHaveProperty("ratePerMinute");
    expect(applause?.loudnessDb).toBeGreaterThan(5);
  });
});
