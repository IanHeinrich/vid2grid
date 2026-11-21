import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppElements } from "../src/dom";
import { initToast, offerUndo, type Toast } from "../src/ui/toast";
import { mountPage } from "./support/page";

let els: AppElements;
let pending: Map<number, () => void>;
let toast: Toast;

beforeEach(() => {
  els = mountPage();
  pending = new Map();
  let next = 0;
  toast = initToast(els, {
    set: (run) => {
      pending.set(++next, run);
      return next;
    },
    clear: (id) => pending.delete(id),
  });
});

function runTimers(): void {
  [...pending.values()].forEach((run) => run());
}

describe("initToast", () => {
  it("shows the message with its action and runs it once", () => {
    const run = vi.fn();
    toast.show("Message deleted", { label: "Undo", run });
    expect(els.toast.el.hidden).toBe(false);
    expect(els.toast.text.textContent).toBe("Message deleted");
    expect(els.toast.action.textContent).toBe("Undo");
    els.toast.action.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(els.toast.el.hidden).toBe(true);
  });

  it("shows inside an open modal dialog, so it is not left inert behind it", () => {
    const home = els.toast.el.parentElement;
    const { dialog } = els.settingsDialog;
    dialog.setAttribute("open", "");
    toast.show("Could not save");
    expect(els.toast.el.parentElement).toBe(dialog);
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
    expect(els.toast.el.parentElement).toBe(home);
  });

  it("hides itself after its time, but not while hovered", () => {
    toast.show("Saved");
    expect(els.toast.action.hidden).toBe(true);
    els.toast.el.dispatchEvent(new MouseEvent("mouseenter"));
    runTimers();
    expect(els.toast.el.hidden).toBe(false);
    els.toast.el.dispatchEvent(new MouseEvent("mouseleave"));
    runTimers();
    expect(els.toast.el.hidden).toBe(true);
  });

  it("waits while focus is inside it", () => {
    toast.show("Message deleted", { label: "Undo", run: vi.fn() });
    els.toast.action.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    runTimers();
    expect(els.toast.el.hidden).toBe(false);
    els.toast.action.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: els.toast.close }),
    );
    runTimers();
    expect(els.toast.el.hidden).toBe(false);
    els.toast.close.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    runTimers();
    expect(els.toast.el.hidden).toBe(true);
  });

  it("closes from its close button", () => {
    toast.show("Saved");
    els.toast.close.click();
    expect(els.toast.el.hidden).toBe(true);
  });
});

describe("toast actions", () => {
  it("tells an action it expired when the toast goes without it", () => {
    const run = vi.fn();
    const expired = vi.fn();
    toast.show("Chat deleted", { label: "Undo", run, expired });
    toast.show("Copied");
    expect(expired).toHaveBeenCalledTimes(1);
    toast.show("Chat deleted", { label: "Undo", run, expired });
    els.toast.action.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("dismisses only the toast a handle belongs to", () => {
    const first = toast.show("Message deleted", { label: "Undo", run: vi.fn() });
    toast.show("Copied");
    first.dismiss();
    expect(els.toast.el.hidden).toBe(false);
    expect(els.toast.text.textContent).toBe("Copied");
    const second = toast.show("Message deleted", { label: "Undo", run: vi.fn() });
    second.dismiss();
    expect(els.toast.el.hidden).toBe(true);
  });
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
