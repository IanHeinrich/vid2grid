import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Study } from "../src/ui/study/studyPanel";
import type * as StudyModule from "../src/video/study";
import { runZoom, type ZoomDeps } from "../src/video/study";
import {
  FLAGS,
  VIDEO,
  els,
  flaggedStudy,
  openPlayer,
  resetStudy,
  seekVideo,
  seeded,
  setup,
  status,
  store,
} from "./support/study";

vi.mock("../src/video/study", async (importOriginal) => {
  const actual = await importOriginal<typeof StudyModule>();
  return { ...actual, runStudy: vi.fn(), runZoom: vi.fn() };
});

beforeEach(resetStudy);

describe("timeline section", () => {
  it("loads the timeline for the video and offers it to the turn", async () => {
    const study = await seeded();
    expect(els.study.summary.textContent).toBe("Timeline for beach.mp4 (2)");
    expect(study.status()).toBe("Timeline ready");
    expect(study.timeline()?.entries).toHaveLength(2);
    els.study.list.querySelector<HTMLButtonElement>(".timestamp")?.click();
    expect(openPlayer).toHaveBeenCalledWith(0);
  });

  it("edits and deletes entries, and clears the timeline", async () => {
    await seeded();
    els.study.list.querySelector<HTMLButtonElement>(".note-edit")?.click();
    const input = els.study.list.querySelector<HTMLInputElement>(".timeline-input");
    if (!input) throw new Error("No editor");
    input.value = "She runs in";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(async () =>
      expect((await store.getTimeline(VIDEO.fileKey))?.entries[0]?.text).toBe("She runs in"),
    );
    els.study.list.querySelectorAll<HTMLButtonElement>(".note-delete")[1]?.click();
    await vi.waitFor(async () =>
      expect((await store.getTimeline(VIDEO.fileKey))?.entries).toHaveLength(1),
    );
    els.study.clearButton.click();
    await vi.waitFor(async () =>
      expect((await store.getTimeline(VIDEO.fileKey))?.entries).toEqual([]),
    );
    expect(els.study.empty.hidden).toBe(false);
  });
});

describe("timeline undo", () => {
  it("undoes clearing, editing and deleting from the toast", async () => {
    await seeded();
    els.study.clearButton.click();
    expect(els.toast.text.textContent).toBe("Timeline cleared");
    els.toast.action.click();
    await vi.waitFor(async () =>
      expect((await store.getTimeline(VIDEO.fileKey))?.entries).toHaveLength(2),
    );
    expect((await store.getTimeline(VIDEO.fileKey))?.nextWindow).toBe(3);
    els.study.list.querySelectorAll<HTMLButtonElement>(".note-delete")[0]?.click();
    expect(els.toast.text.textContent).toBe("Timeline entry deleted");
    els.toast.action.click();
    await vi.waitFor(async () =>
      expect((await store.getTimeline(VIDEO.fileKey))?.entries[0]?.text).toBe("She walks in"),
    );
    els.study.list.querySelector<HTMLButtonElement>(".note-edit")?.click();
    const input = els.study.list.querySelector<HTMLInputElement>(".timeline-input");
    if (!input) throw new Error("No editor");
    input.value = "She runs in";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(els.toast.text.textContent).toBe("Timeline entry edited");
    els.toast.action.click();
    await vi.waitFor(async () =>
      expect((await store.getTimeline(VIDEO.fileKey))?.entries[0]?.text).toBe("She walks in"),
    );
  });
});

async function startHeldZoom(): Promise<void> {
  const held: { deps?: ZoomDeps } = {};
  vi.mocked(runZoom).mockImplementationOnce(
    (deps) =>
      new Promise((resolve) => {
        held.deps = deps;
        deps.signal.addEventListener("abort", () => resolve(deps.timeline));
      }),
  );
  els.study.zoomButton.click();
  await vi.waitFor(() => expect(held.deps).toBeDefined());
}

function editRow(row: number, value: string): HTMLInputElement {
  els.study.list.querySelectorAll<HTMLButtonElement>(".note-edit")[row]?.click();
  const input = els.study.list.querySelector<HTMLInputElement>(".timeline-input");
  if (!input) throw new Error("No editor");
  input.value = value;
  return input;
}

const enter = (input: HTMLInputElement) =>
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
const texts = (study: Study) => study.timeline()?.entries.map((entry) => entry.text);
const rowButtons = () => [
  ...els.study.list.querySelectorAll<HTMLButtonElement>(".note-edit, .note-delete"),
];

describe("timeline changes while a study runs", () => {
  it("disables editing and deleting while a zoom runs, until it pauses", async () => {
    const study = await flaggedStudy(FLAGS);
    await startHeldZoom();
    expect(rowButtons()).toHaveLength(4);
    expect(rowButtons().every((button) => button.disabled)).toBe(true);
    study.pause();
    await vi.waitFor(() => expect(rowButtons().some((button) => button.disabled)).toBe(false));
  });

  it("closes an open edit without saving when a zoom starts", async () => {
    const study = await flaggedStudy(FLAGS);
    const input = editRow(0, "She runs in");
    await startHeldZoom();
    expect(status.show).toHaveBeenCalledWith("Editing is paused while the study runs.");
    expect(els.study.list.querySelector(".timeline-input")).toBeNull();
    enter(input);
    expect(texts(study)).toEqual(["She walks in", "She sits"]);
    study.pause();
  });

  it("drops an edit to an entry that changed meanwhile, and says so", async () => {
    const study = await seeded();
    enter(editRow(0, "She runs in"));
    const input = editRow(0, "She dashes in");
    els.toast.action.click();
    enter(input);
    expect(texts(study)).toEqual(["She walks in", "She sits"]);
    expect(status.show).toHaveBeenCalledWith(
      "That entry has changed since, so the change was dropped.",
    );
    expect(els.study.list.querySelector(".timeline-input")).toBeNull();
  });
});

describe("an older video's timeline", () => {
  const OLDER = { ...VIDEO, name: "park.mp4", fileKey: "park-key" };

  it("shows what was saved for it read only, and seeks that video", async () => {
    await store.putTimeline({
      fileKey: OLDER.fileKey,
      modelId: "m",
      entries: [{ startSeconds: 3, endSeconds: 8, text: "A dog runs past" }],
      unclear: FLAGS,
      nextWindow: 1,
      windowCount: 1,
      updatedAt: 1,
    });
    setup(() => ({ video: OLDER, current: false }));
    await vi.waitFor(() => expect(els.study.summary.textContent).toBe("Timeline for park.mp4 (1)"));
    expect(els.study.list.querySelector(".note-edit, .note-delete")).toBeNull();
    const time = els.study.list.querySelector<HTMLButtonElement>(".timestamp");
    expect(time?.textContent).toBe("[0:03-0:08]");
    time?.click();
    expect(seekVideo).toHaveBeenCalledWith(3, OLDER);
    expect(openPlayer).not.toHaveBeenCalled();
    expect(els.study.zoomButton.hidden).toBe(true);
  });

  it("says when nothing was saved for it", () => {
    setup(() => ({ video: OLDER, current: false }));
    expect(els.study.empty.hidden).toBe(false);
    expect(els.study.empty.textContent).toBe("No timeline was saved for this video.");
  });
});
