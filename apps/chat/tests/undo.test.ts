import { beforeEach, describe, expect, it, vi } from "vitest";
import { offerUndo } from "../src/app/undo";
import type { AppElements } from "../src/dom";
import { initToast, type Toast } from "../src/ui/shared/toast";
import { mountPage } from "./support/page";

let els: AppElements;
let toast: Toast;

beforeEach(() => {
  els = mountPage();
  toast = initToast(els, { set: () => 0, clear: () => undefined });
});

describe("offerUndo", () => {
  it("undoes from the toast's Undo button", () => {
    const undo = vi.fn();
    offerUndo(toast, "Note deleted", { undo });
    expect(els.toast.action.textContent).toBe("Undo");
    els.toast.action.click();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("does nothing once the change is no longer in front", () => {
    const undo = vi.fn();
    offerUndo(toast, "Note deleted", { undo, stillValid: () => false });
    els.toast.action.click();
    expect(undo).not.toHaveBeenCalled();
  });

  it("reports a failed undo, thrown or rejected", async () => {
    offerUndo(toast, "Note deleted", {
      undo: () => {
        throw new Error("disk full");
      },
    });
    els.toast.action.click();
    expect(els.toast.text.textContent).toBe("Could not undo: disk full");
    const failed = vi.fn();
    offerUndo(toast, "Note deleted", { undo: () => Promise.reject(new Error("gone")), failed });
    els.toast.action.click();
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  });

  it("passes on expiry when Undo is not chosen", () => {
    const expired = vi.fn();
    offerUndo(toast, "Chat deleted", { undo: vi.fn(), expired });
    toast.show("Copied");
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
