import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import { queryElements } from "../src/dom";

describe("queryElements", () => {
  it("finds every element the app needs in index.html", () => {
    document.body.innerHTML = indexHtml;
    expect(() => queryElements()).not.toThrow();
  });

  it("fails fast naming a missing element", () => {
    document.body.innerHTML = "";
    expect(() => queryElements()).toThrow("#startTime");
  });

  it("fails fast on an element of the wrong type", () => {
    document.body.innerHTML = indexHtml;
    document
      .getElementById("lightboxImage")
      ?.replaceWith(Object.assign(document.createElement("div"), { id: "lightboxImage" }));
    expect(() => queryElements()).toThrow("#lightboxImage");
  });
});
