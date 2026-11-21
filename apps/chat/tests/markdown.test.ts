import { describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "../src/ui/markdown";

function render(text: string, onSeek: (seconds: number) => void = () => undefined): string {
  const container = document.createElement("div");
  container.append(renderMarkdown(text, { onSeek }));
  return container.innerHTML;
}

describe("paragraphs and line breaks", () => {
  it("splits paragraphs on blank lines and breaks on single newlines", () => {
    expect(render("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });

  it("renders nothing for empty text", () => {
    expect(render("")).toBe("");
    expect(render("\n \n")).toBe("");
  });

  it("accepts Windows line endings", () => {
    expect(render("a\r\n\r\nb")).toBe("<p>a</p><p>b</p>");
  });
});

describe("emphasis", () => {
  it("renders *text* and _text_ as actions", () => {
    expect(render("*waves* and _smiles_")).toBe(
      '<p><em class="md-action">waves</em> and <em class="md-action">smiles</em></p>',
    );
  });

  it("renders **text** as bold", () => {
    expect(render("a **big** day")).toBe("<p>a <strong>big</strong> day</p>");
  });

  it("lets an action span a line break", () => {
    expect(render("*walks\nover*")).toBe('<p><em class="md-action">walks<br>over</em></p>');
  });

  it("nests bold inside an action", () => {
    expect(render("*she **really** means it*")).toBe(
      '<p><em class="md-action">she <strong>really</strong> means it</em></p>',
    );
  });

  it("leaves markers inside words literal", () => {
    expect(render("snake_case_name and 2*3*4")).toBe("<p>snake_case_name and 2*3*4</p>");
  });

  it("leaves markers padded by spaces literal", () => {
    expect(render("5 * 3 * 2")).toBe("<p>5 * 3 * 2</p>");
  });

  it("leaves unclosed markers literal", () => {
    expect(render("*waves")).toBe("<p>*waves</p>");
    expect(render("**bold")).toBe("<p>**bold</p>");
    expect(render("_half")).toBe("<p>_half</p>");
    expect(render("`code")).toBe("<p>`code</p>");
  });

  it("keeps the closed part when a later marker is unclosed", () => {
    expect(render("*waves* then *leans")).toBe(
      '<p><em class="md-action">waves</em> then *leans</p>',
    );
  });

  it("does not render empty emphasis", () => {
    expect(render("** and ****")).toBe("<p>** and ****</p>");
  });
});

describe("dialogue", () => {
  it("marks straight-quoted text as dialogue and keeps the quotes", () => {
    expect(render('She said "hello there" and left')).toBe(
      '<p>She said <span class="md-dialogue">"hello there"</span> and left</p>',
    );
  });

  it("marks curly-quoted text as dialogue", () => {
    expect(render("“Hi”")).toBe('<p><span class="md-dialogue">“Hi”</span></p>');
  });

  it("leaves an unclosed quote literal", () => {
    expect(render('"still talking')).toBe('<p>"still talking</p>');
  });

  it("nests dialogue inside an action and emphasis inside dialogue", () => {
    expect(render('*says "hi" softly*')).toBe(
      '<p><em class="md-action">says <span class="md-dialogue">"hi"</span> softly</em></p>',
    );
    expect(render('"I *really* do"')).toBe(
      '<p><span class="md-dialogue">"I <em class="md-action">really</em> do"</span></p>',
    );
  });
});

describe("code, lists and quotes", () => {
  it("renders inline code without interpreting its contents", () => {
    expect(render("run `a *b* [1:00]` now")).toBe("<p>run <code>a *b* [1:00]</code> now</p>");
  });

  it("renders bullet lists with - and *", () => {
    expect(render("- one\n* two")).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("renders ordered lists and keeps the starting number", () => {
    expect(render("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(render("3. three")).toBe('<ol start="3"><li>three</li></ol>');
  });

  it("starts a new list when the kind changes", () => {
    expect(render("- a\n1. b")).toBe("<ul><li>a</li></ul><ol><li>b</li></ol>");
  });

  it("renders emphasis inside list items", () => {
    expect(render("- *waves*")).toBe('<ul><li><em class="md-action">waves</em></li></ul>');
  });

  it("does not take an action at line start for a list item", () => {
    expect(render("*waves* hello")).toBe('<p><em class="md-action">waves</em> hello</p>');
  });

  it("renders quotes", () => {
    expect(render("> a\n> b")).toBe("<blockquote>a<br>b</blockquote>");
  });

  it("renders # lines as bold", () => {
    expect(render("## Title\ntext")).toBe(
      '<p class="md-heading"><strong>Title</strong></p><p>text</p>',
    );
  });

  it("ends a list at a paragraph", () => {
    expect(render("- a\ntext")).toBe("<ul><li>a</li></ul><p>text</p>");
  });
});

describe("timestamps", () => {
  it("turns timestamps into seek buttons", () => {
    const onSeek = vi.fn();
    const container = document.createElement("div");
    container.append(renderMarkdown("At [1:42], [1:02:05] and [0:01.5].", { onSeek }));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button.timestamp")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "[1:42]",
      "[1:02:05]",
      "[0:01.5]",
    ]);
    expect(buttons.map((button) => button.title)).toEqual([
      "Play from 1:42",
      "Play from 1:02:05",
      "Play from 0:01",
    ]);
    buttons.forEach((button) => button.click());
    expect(onSeek.mock.calls).toEqual([[102], [3725], [1.5]]);
  });

  it("turns each end of a range into its own seek button, keeping brackets and separator", () => {
    const onSeek = vi.fn();
    const text = "Then [0:43–0:48], [0:43-0:48], [0:43 — 0:48] and [1:02:03 to 1:02:10].";
    const container = document.createElement("div");
    container.append(renderMarkdown(text, { onSeek }));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button.timestamp")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "0:43",
      "0:48",
      "0:43",
      "0:48",
      "0:43",
      "0:48",
      "1:02:03",
      "1:02:10",
    ]);
    expect(container.textContent).toBe(text);
    buttons.forEach((button) => button.click());
    expect(onSeek.mock.calls.flat()).toEqual([43, 48, 43, 48, 43, 48, 3723, 3730]);
  });

  it("keeps timestamps inside emphasis, quotes and list items clickable", () => {
    const onSeek = vi.fn();
    const container = document.createElement("div");
    container.append(
      renderMarkdown('*she waves at [1:42]*\n\n"look at [2:00]"\n\n- then [3:00]', { onSeek }),
    );
    expect(container.querySelector("em button.timestamp")?.textContent).toBe("[1:42]");
    expect(container.querySelector(".md-dialogue button.timestamp")?.textContent).toBe("[2:00]");
    expect(container.querySelector("li button.timestamp")?.textContent).toBe("[3:00]");
    container.querySelector<HTMLButtonElement>("em button")?.click();
    expect(onSeek).toHaveBeenCalledWith(102);
  });
});

describe("parenthesised and bare timestamps", () => {
  it("turns parenthesised and bare times into seek buttons without brackets", () => {
    const onSeek = vi.fn();
    const text = "She nods (0:26), then from 0:31 to 0:40 and at 1:02:03.";
    const container = document.createElement("div");
    container.append(renderMarkdown(text, { onSeek }));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button.timestamp")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "(0:26)",
      "0:31",
      "0:40",
      "1:02:03",
    ]);
    expect(container.textContent).toBe(text);
    buttons.forEach((button) => button.click());
    expect(onSeek.mock.calls.flat()).toEqual([26, 31, 40, 3723]);
  });

  it("leaves URLs, versions and malformed times as text", () => {
    const text = "see https://example.com/12:30 v1:22 12:30:45:10 and 1:2";
    expect(render(text)).toBe(`<p>${text}</p>`);
  });

  it("leaves bare times past maxSeconds as text but keeps bracketed ones", () => {
    const container = document.createElement("div");
    const text = "at 0:26, won 21:14 and [21:14]";
    container.append(renderMarkdown(text, { onSeek: () => undefined, maxSeconds: 60 }));
    const buttons = [...container.querySelectorAll("button.timestamp")];
    expect(buttons.map((button) => button.textContent)).toEqual(["0:26", "[21:14]"]);
    expect(container.textContent).toBe(text);
  });

  it("does not link times inside inline code or a fenced block", () => {
    expect(render("run `at 0:26` now")).toBe("<p>run <code>at 0:26</code> now</p>");
    expect(render("```\nat 0:26 or [0:31]\n```")).not.toContain("<button");
  });
});

describe("safety and streaming", () => {
  it("renders HTML in the text as literal text", () => {
    const text = '<script>alert(1)</script> <img src=x onerror="alert(1)"> *<b>x</b>*';
    const container = document.createElement("div");
    container.append(renderMarkdown(text, { onSeek: () => undefined }));
    expect(container.querySelector("script, img, b")).toBeNull();
    expect(container.textContent).toBe(
      '<script>alert(1)</script> <img src=x onerror="alert(1)"> <b>x</b>',
    );
  });

  it("never throws on every prefix of marked-up text", () => {
    const text = '*a "b **c** `d` [1:42]* _e_\n\n- *f\n> "g\n1. **h\n# i *j\n“k [0:01.5] ”*';
    for (let length = 0; length <= text.length; length += 1) {
      expect(() => render(text.slice(0, length))).not.toThrow();
    }
  });

  it("handles a few KB of unclosed markers quickly", () => {
    const text = "*a ".repeat(2000) + '"b '.repeat(1000) + "_c ".repeat(1000);
    const started = performance.now();
    render(text);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("stops nesting emphasis at a bounded depth", () => {
    const text = "*_".repeat(500) + "x" + "_*".repeat(500);
    expect(() => render(text)).not.toThrow();
  });
});
