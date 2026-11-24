import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageCleanup } from "../src/app/imageCleanup";
import type { AppElements } from "../src/dom";
import type { UnusedImages } from "../src/types";
import { initUnusedImages } from "../src/ui/settings/unusedImages";
import { mountPage } from "./support/page";

const MB = 1024 ** 2;

let els: AppElements;
let unused: UnusedImages;
let confirm: ReturnType<typeof vi.fn<(message: string) => boolean>>;
let deleteUnused: ReturnType<typeof vi.fn<ImageCleanup["deleteUnused"]>>;
let countToDelete: ReturnType<typeof vi.fn<ImageCleanup["countToDelete"]>>;

function images(count: number, bytes: number): UnusedImages {
  return { images: Array.from({ length: count }, (_, i) => `i${i}`), sheets: [], bytes };
}

beforeEach(() => {
  els = mountPage();
  unused = images(12, 34 * MB);
  confirm = vi.fn(() => true);
  countToDelete = vi.fn(() => Promise.resolve({ counted: unused }));
  deleteUnused = vi.fn((counted: UnusedImages) => {
    unused = images(0, 0);
    return Promise.resolve({ deleted: counted });
  });
});

function setup(canDelete = true) {
  const countUnused = () => Promise.resolve(unused);
  const cleanup = { countUnused, countToDelete, canDelete, deleteUnused };
  return initUnusedImages(els, { images: cleanup, confirm });
}

function shown() {
  const { unusedImagesText, unusedImagesStatus, deleteUnusedImagesButton } = els.settingsDialog;
  return {
    text: unusedImagesText.textContent,
    status: unusedImagesStatus.textContent,
    offered: !deleteUnusedImagesButton.hidden,
  };
}

async function clickDelete(): Promise<void> {
  els.settingsDialog.deleteUnusedImagesButton.click();
  await vi.waitFor(() => expect(els.settingsDialog.deleteUnusedImagesButton.disabled).toBe(false));
}

describe("unused images", () => {
  it("shows how many there are, how much space they take and a Delete button", async () => {
    await setup().render();
    expect(shown()).toEqual({ text: "12 unused images, 34.0 MB", status: "", offered: true });
  });

  it("shows a plain line when there are none", async () => {
    unused = images(0, 0);
    await setup().render();
    expect(shown()).toEqual({ text: "No unused images.", status: "", offered: false });
  });

  it("asks before deleting, says what went and counts again", async () => {
    unused = images(1, 2048);
    await setup().render();
    await clickDelete();
    expect(confirm).toHaveBeenCalledWith("Delete 1 unused image, 2.0 KB? This cannot be undone.");
    expect(shown()).toEqual({
      text: "No unused images.",
      status: "Deleted 1 unused image, 2.0 KB.",
      offered: false,
    });
  });

  it("asks about what is unused now, and deletes just that", async () => {
    await setup().render();
    const now = images(3, 2048);
    unused = now;
    await clickDelete();
    expect(confirm).toHaveBeenCalledWith("Delete 3 unused images, 2.0 KB? This cannot be undone.");
    expect(deleteUnused).toHaveBeenCalledWith(now);
  });

  it("asks nothing when none is unused any more", async () => {
    await setup().render();
    unused = images(0, 0);
    await clickDelete();
    expect(confirm).not.toHaveBeenCalled();
    expect(shown()).toEqual({ text: "No unused images.", status: "", offered: false });
  });

  it("says why it cannot delete before asking", async () => {
    countToDelete.mockResolvedValue({ refused: "otherTabs" });
    await setup().render();
    await clickDelete();
    expect(confirm).not.toHaveBeenCalled();
    expect(shown().status).toBe("Close the other vid2grid chat tabs, then try again.");
  });

  it("says so in its own line when they cannot be counted", async () => {
    const countUnused = () => Promise.reject(new Error("disk full"));
    const cleanup = { countUnused, countToDelete, canDelete: true, deleteUnused };
    await initUnusedImages(els, { images: cleanup, confirm }).render();
    expect(shown().status).toBe("Could not count them: disk full");
  });

  it("deletes nothing when the question is declined", async () => {
    confirm.mockReturnValue(false);
    await setup().render();
    await clickDelete();
    expect(deleteUnused).not.toHaveBeenCalled();
  });

  it.each([
    ["otherTabs", "Close the other vid2grid chat tabs, then try again."],
    ["running", "Wait for the reply to finish, then try again."],
    ["late", "That took too long to be safe, so nothing was deleted. Try again."],
    [
      "undo",
      "A deletion can still be undone, or a restore is running. Try again in a few seconds.",
    ],
  ] as const)("says why it was refused: %s", async (refused, text) => {
    deleteUnused.mockResolvedValue({ refused });
    await setup().render();
    await clickDelete();
    expect(shown()).toEqual({ text: "12 unused images, 34.0 MB", status: text, offered: true });
  });

  it("offers no delete to a tab that cannot see the others", async () => {
    await setup(false).render();
    expect(shown()).toEqual({
      text: "12 unused images, 34.0 MB",
      status: "This tab cannot tell whether other tabs use them, so they are kept.",
      offered: false,
    });
  });

  it("offers the delete once the tab can see the others", async () => {
    const canDelete = vi.fn(() => false);
    const cleanup = {
      countUnused: () => Promise.resolve(unused),
      countToDelete,
      get canDelete() {
        return canDelete();
      },
      deleteUnused,
    };
    const panel = initUnusedImages(els, { images: cleanup, confirm });
    await panel.render();
    expect(shown().offered).toBe(false);
    canDelete.mockReturnValue(true);
    await panel.render();
    expect(shown()).toEqual({ text: "12 unused images, 34.0 MB", status: "", offered: true });
  });

  it("reports a failed delete", async () => {
    deleteUnused.mockRejectedValue(new Error("disk full"));
    await setup().render();
    await clickDelete();
    expect(shown().status).toBe("Could not delete the unused images: disk full");
  });
});
