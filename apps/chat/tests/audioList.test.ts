import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAudio, settingsLabels } from "../src/audio/videoAudio";
import type { VideoAudio } from "../src/types";
import type * as StudyModule from "../src/video/study";
import {
  VIDEO,
  analyseAudio,
  els,
  openPlayer,
  resetStudy,
  seekVideo,
  setup,
  state,
  store,
} from "./support/study";

vi.mock("../src/video/study", async (importOriginal) => {
  const actual = await importOriginal<typeof StudyModule>();
  return { ...actual, runStudy: vi.fn(), runZoom: vi.fn() };
});

beforeEach(resetStudy);

function heard(speech: VideoAudio["speech"]): VideoAudio {
  const span = { startSeconds: 0, endSeconds: VIDEO.durationSeconds };
  return {
    fileKey: VIDEO.fileKey,
    labels: [...state.settings.soundLabels],
    backgroundLabels: [...state.settings.backgroundSoundLabels],
    speechSpans: [span],
    soundSpans: [span],
    speech,
    events: [{ startSeconds: 62, endSeconds: 66, label: "applause", score: 0.9, loudnessDb: 3 }],
    updatedAt: 1,
  };
}

const rows = () => [...els.study.audioList.querySelectorAll("li")];

async function seeded(speech: VideoAudio["speech"]): Promise<void> {
  await store.putAudio(heard(speech));
  setup();
  await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0));
}

describe("timeline audio list", () => {
  it("says the audio is not analysed yet when nothing was heard", async () => {
    setup();
    await vi.waitFor(() => expect(els.study.audioCoverage.textContent).toBe("Not analysed yet."));
    expect(els.study.audioSection.hidden).toBe(false);
    expect(rows()).toEqual([]);
    expect(els.study.audioMore.hidden).toBe(true);
  });

  it("lists what was heard with the coverage, and a timestamp seeks the player", async () => {
    await seeded([{ start: 5, end: 7, text: "Welcome everyone" }]);
    expect(els.study.audioCoverage.textContent).toBe("Analysed 0:00 to 10:00 (speech and sounds).");
    expect(rows().map((row) => row.textContent)).toEqual([
      '[0:05] "Welcome everyone"',
      "[1:02-1:06] applause 0.90, moderate (+3 dB)",
    ]);
    rows()[1]?.querySelector<HTMLButtonElement>(".timestamp")?.click();
    expect(openPlayer).toHaveBeenCalledWith(62);
  });

  it("shows the first lines and the rest on Show all", async () => {
    const speech = Array.from({ length: 30 }, (_, index) => ({
      start: index,
      end: index + 0.5,
      text: `Line ${index}`,
    }));
    await seeded(speech);
    expect(rows()).toHaveLength(20);
    expect(els.study.audioMore.hidden).toBe(false);
    expect(els.study.audioMore.textContent).toBe("Show all 31");
    els.study.audioMore.click();
    expect(rows()).toHaveLength(31);
    expect(els.study.audioMore.hidden).toBe(true);
  });

  it("redraws when an analysis saves", async () => {
    setup();
    await vi.waitFor(() => expect(els.study.audioCoverage.textContent).toBe("Not analysed yet."));
    const deps = { store, labels: settingsLabels(state.settings), analyse: analyseAudio };
    const source = { file: new File(["video"], VIDEO.name), ...VIDEO };
    await ensureAudio(deps, source, { startSeconds: 0, endSeconds: 60 });
    expect(els.study.audioCoverage.textContent).toBe("Analysed 0:00 to 5:00 (speech and sounds).");
  });
});

describe("an older video's audio list", () => {
  it("names the video, lists what was heard and seeks that video", async () => {
    const older = { ...VIDEO, name: "park.mp4", fileKey: "park-key" };
    await store.putAudio({
      ...heard([{ start: 5, end: 7, text: "Hello" }]),
      fileKey: older.fileKey,
    });
    setup(() => ({ video: older, current: false }));
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(els.study.audioTitle.textContent).toBe("Audio for park.mp4");
    expect(rows()[0]?.textContent).toBe('[0:05] "Hello"');
    rows()[0]?.querySelector<HTMLButtonElement>(".timestamp")?.click();
    expect(seekVideo).toHaveBeenCalledWith(5, older);
    expect(openPlayer).not.toHaveBeenCalled();
  });
});
