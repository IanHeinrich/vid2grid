import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import { queryElements } from "../src/dom";
import { initStatus } from "../src/ui/shared/status";

describe("initStatus", () => {
  it("shows errors marked and clears them", () => {
    document.body.innerHTML = indexHtml;
    const els = queryElements();
    const status = initStatus(els);
    status.show("No key", "error");
    expect(els.status.message.textContent).toBe("No key");
    expect(els.status.message.classList.contains("is-error")).toBe(true);
    status.clear();
    expect(els.status.message.textContent).toBe("");
    expect(els.status.message.classList.contains("is-error")).toBe(false);
  });
});
