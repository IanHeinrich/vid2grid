import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ImageRef, UserMessage, VideoAttachment, ZoomTarget } from "../src/types";
import { initConversation } from "../src/ui/conversation/conversation";
import { cellAt, sheetGrid } from "../src/video/sheetCells";
import {
  beach,
  deps,
  els,
  investigation,
  list,
  openActivity,
  resetConversation,
  setView,
  spies,
  store,
} from "./support/conversation";
import { assistant, tool, user } from "./support/factories";

beforeEach(resetConversation);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sheetGrid", () => {
  it("picks the columns that give the largest cells, like core's packing", () => {
    expect(sheetGrid(4, 16 / 9, 1000, 1000)).toMatchObject({ cols: 2, rows: 2, cellW: 488 });
    expect(sheetGrid(3, 9 / 16, 1000, 1000)).toMatchObject({ cols: 3, rows: 1 });
    expect(sheetGrid(4, 1, 10, 10)).toBeUndefined();
  });

  it("finds no grid on an image that is not a square sheet", () => {
    expect(sheetGrid(4, 16 / 9, 1000, 800)).toBeUndefined();
  });
});

describe("cellAt", () => {
  const grid = sheetGrid(4, 16 / 9, 1000, 1000);

  it("finds cells row by row and nothing outside the grid or past the last frame", () => {
    if (!grid) throw new Error("No grid");
    expect(cellAt(grid, 250, 300, 3)).toBe(0);
    expect(cellAt(grid, 750, 300, 3)).toBe(1);
    expect(cellAt(grid, 250, 600, 3)).toBe(2);
    expect(cellAt(grid, 750, 600, 3)).toBeNull();
    expect(cellAt(grid, 500, 50, 3)).toBeNull();
  });
});

async function seedImages(): Promise<UserMessage> {
  const ids = await Promise.all(["a", "b", "c"].map((name) => store.putImage(new Blob([name]))));
  const images: ImageRef[] = ids.map((id, index) => ({
    id,
    source: { kind: "upload", name: `photo-${index + 1}.png` },
    pinned: false,
  }));
  return user("u1", "", { images });
}

function pressKey(key: string): void {
  els.lightbox.dialog.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
}

describe("images and the lightbox", () => {
  it("toggles a pin on a user image and reports the changed message", async () => {
    const conversation = initConversation(els, deps());
    conversation.show(await seedImages());
    list().querySelector<HTMLButtonElement>(".pin-toggle")?.click();
    const changed = spies.onMessageChanged.mock.calls[0]?.[0] as UserMessage | undefined;
    expect(changed?.images[0]?.pinned).toBe(true);
    expect(list().querySelector(".pin-toggle")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens a thumbnail in the overlay with its label and position", async () => {
    const conversation = initConversation(els, deps());
    conversation.show(await seedImages());
    list().querySelectorAll<HTMLButtonElement>(".thumb-button")[1]?.click();
    expect(els.lightbox.dialog.open).toBe(true);
    expect(els.lightbox.label.textContent).toBe("photo-2.png");
    expect(els.lightbox.counter.textContent).toBe("2 of 3");
    expect(els.lightbox.pin.hidden).toBe(false);
    await vi.waitFor(() => expect(els.lightbox.image.getAttribute("src")).toMatch(/^blob:/));
  });

  it("moves with the arrow keys, stops at the ends and closes on Escape", async () => {
    const conversation = initConversation(els, deps());
    conversation.show(await seedImages());
    list().querySelector<HTMLButtonElement>(".thumb-button")?.click();
    pressKey("ArrowLeft");
    expect(els.lightbox.counter.textContent).toBe("1 of 3");
    pressKey("ArrowRight");
    pressKey("ArrowRight");
    pressKey("ArrowRight");
    expect(els.lightbox.counter.textContent).toBe("3 of 3");
    expect(els.lightbox.next.disabled).toBe(true);
    pressKey("Escape");
    expect(els.lightbox.dialog.open).toBe(false);
  });

  it("pins the shown image from the overlay", async () => {
    const conversation = initConversation(els, deps());
    conversation.show(await seedImages());
    list().querySelector<HTMLButtonElement>(".thumb-button")?.click();
    els.lightbox.pin.click();
    expect(els.lightbox.pin.getAttribute("aria-pressed")).toBe("true");
    const changed = spies.onMessageChanged.mock.calls[0]?.[0] as UserMessage | undefined;
    expect(changed?.images[0]?.pinned).toBe(true);
  });

  it("opens an activity thumbnail in the overlay at that image", () => {
    const conversation = initConversation(els, deps());
    conversation.reset(investigation());
    const details = openActivity();
    details.querySelectorAll<HTMLButtonElement>(".activity-thumbs .thumb-button")[1]?.click();
    expect(els.lightbox.counter.textContent).toBe("2 of 2");
    expect(els.lightbox.pin.hidden).toBe(true);
  });
});

function control(selector: string): HTMLButtonElement {
  const button = els.lightbox.dialog.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`No ${selector}`);
  return button;
}

function openSheet(messages: ChatMessage[] = investigation()): HTMLImageElement {
  const conversation = initConversation(els, deps());
  conversation.reset(messages);
  openActivity().querySelector<HTMLButtonElement>(".activity-thumbs .thumb-button")?.click();
  const { image } = els.lightbox;
  Object.defineProperty(image, "naturalWidth", { value: 1000 });
  Object.defineProperty(image, "naturalHeight", { value: 1000 });
  image.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 1000);
  return image;
}

function clickAt(image: HTMLElement, x: number, y: number): void {
  image.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }));
}

describe("seeking and zooming in the lightbox", () => {
  it("cues the clicked cell of a 2 by 2 sheet without playing, and ignores the margin", () => {
    vi.useFakeTimers();
    const image = openSheet();
    clickAt(image, 750, 600);
    vi.runAllTimers();
    expect(spies.onCue).toHaveBeenLastCalledWith(39);
    clickAt(image, 250, 300);
    vi.runAllTimers();
    expect(spies.onCue).toHaveBeenLastCalledWith(36);
    clickAt(image, 500, 100);
    vi.runAllTimers();
    expect(spies.onCue).toHaveBeenCalledTimes(2);
    expect(spies.onSeek).not.toHaveBeenCalled();
    expect(els.lightbox.dialog.open).toBe(true);
    vi.useRealTimers();
  });

  it("plays the clicked cell of a sheet from an earlier video in that video", () => {
    vi.useFakeTimers();
    const dunes: VideoAttachment = { ...beach, name: "dunes.mp4", fileKey: "dunes-key" };
    setView({ video: dunes, url: "blob:dunes" });
    const [first, ...rest] = investigation();
    if (first?.role !== "user") throw new Error("No user message");
    const later = user("u2", "Now", { video: dunes });
    const image = openSheet([{ ...first, video: beach }, ...rest, later]);
    clickAt(image, 750, 600);
    vi.runAllTimers();
    expect(spies.onSeek).toHaveBeenCalledWith(39, beach);
    expect(spies.onCue).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("asks about the clicked frame and closes", () => {
    const image = openSheet();
    clickAt(image, 750, 600);
    expect(spies.onCue).not.toHaveBeenCalled();
    control(".lightbox-ask").click();
    expect(spies.onPrefill).toHaveBeenCalledWith("About [0:39]: ");
    expect(els.lightbox.dialog.open).toBe(false);
  });

  it("zooms with the buttons and double-click, and a drag does not seek", () => {
    const image = openSheet();
    expect(control(".lightbox-zoom-out").disabled).toBe(true);
    control(".lightbox-zoom-in").click();
    expect(image.style.transform).toContain("scale(1.25)");
    image.dispatchEvent(new MouseEvent("dblclick", { clientX: 500, clientY: 500 }));
    expect(image.style.transform).toBe("");
    image.dispatchEvent(new MouseEvent("dblclick", { clientX: 500, clientY: 500 }));
    expect(image.style.transform).toContain("scale(2.5)");
    image.dispatchEvent(new MouseEvent("pointerdown", { clientX: 700, clientY: 600, button: 0 }));
    image.dispatchEvent(new MouseEvent("pointermove", { clientX: 760, clientY: 600 }));
    image.dispatchEvent(new MouseEvent("pointerup", { clientX: 760, clientY: 600 }));
    clickAt(image, 760, 600);
    expect(spies.onSeek).not.toHaveBeenCalled();
  });
});

function zoomChat(target: ZoomTarget): ChatMessage[] {
  const zoomed: ImageRef = {
    id: "z1",
    pinned: false,
    source: {
      kind: "zoom",
      name: "zoom(1:02.5, 100, 200, 400, 500)",
      target,
      area: { left: 100, top: 200, right: 400, bottom: 500 },
      width: 600,
      height: 450,
    },
  };
  return [
    user("u1", "Zoom in"),
    assistant("a1", "", { toolCalls: [{ id: "c1", name: "zoom", arguments: "{}" }] }),
    tool("t1", "c1", [zoomed]),
    assistant("a2", "Done"),
  ];
}

describe("a zoom in the lightbox", () => {
  it("shows the moment, cues it on a click and only asks from the button", () => {
    vi.useFakeTimers();
    const image = openSheet(zoomChat({ kind: "moment", seconds: 62.5, fileKey: "beach-key" }));
    expect(els.lightbox.label.textContent).toBe("Zoom · 1:02.5");
    expect(els.lightbox.hint.textContent).toContain("1:02.5");
    expect(control(".lightbox-ask").hidden).toBe(false);
    clickAt(image, 500, 500);
    vi.runAllTimers();
    expect(spies.onCue).toHaveBeenCalledWith(62.5);
    spies.onCue.mockClear();
    control(".lightbox-ask").click();
    vi.runAllTimers();
    expect(spies.onCue).not.toHaveBeenCalled();
    expect(spies.onSeek).not.toHaveBeenCalled();
    expect(spies.onPrefill).toHaveBeenCalledWith("About [1:02]: ");
    expect(els.lightbox.dialog.open).toBe(false);
    vi.useRealTimers();
  });

  it("has no time to ask about or jump to when it zooms into an image", () => {
    vi.useFakeTimers();
    const image = openSheet(zoomChat({ kind: "image", id: "u1", name: "beach.jpg" }));
    expect(els.lightbox.label.textContent).toBe("Zoom · beach.jpg");
    expect(control(".lightbox-ask").hidden).toBe(true);
    expect(els.lightbox.hint.textContent).toBe("");
    clickAt(image, 500, 500);
    vi.runAllTimers();
    expect(spies.onCue).not.toHaveBeenCalled();
    expect(spies.onSeek).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("double-clicks and pans in the lightbox", () => {
  it("zooms on a double-click without seeking", () => {
    vi.useFakeTimers();
    const image = openSheet();
    image.dispatchEvent(new MouseEvent("click", { clientX: 750, clientY: 600, detail: 1 }));
    image.dispatchEvent(new MouseEvent("click", { clientX: 750, clientY: 600, detail: 2 }));
    image.dispatchEvent(new MouseEvent("dblclick", { clientX: 750, clientY: 600 }));
    vi.runAllTimers();
    expect(image.style.transform).toContain("scale(2.5)");
    expect(spies.onCue).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("captures the pointer while panning, so a pan ending over the backdrop keeps it open", () => {
    const capture = vi.fn();
    Element.prototype.setPointerCapture = capture;
    const image = openSheet();
    image.dispatchEvent(new MouseEvent("dblclick", { clientX: 500, clientY: 500 }));
    image.dispatchEvent(new MouseEvent("pointerdown", { clientX: 700, clientY: 600, button: 0 }));
    expect(capture).toHaveBeenCalled();
    image.dispatchEvent(new MouseEvent("pointermove", { clientX: 900, clientY: 600 }));
    image.dispatchEvent(new MouseEvent("pointerup", { clientX: 900, clientY: 600 }));
    els.lightbox.dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(els.lightbox.dialog.open).toBe(true);
    els.lightbox.dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(els.lightbox.dialog.open).toBe(false);
  });
});
