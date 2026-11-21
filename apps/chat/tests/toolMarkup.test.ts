import { describe, expect, it } from "vitest";
import { stripToolMarkup } from "../src/chat/toolMarkup";

describe("stripToolMarkup", () => {
  it("strips DeepSeek DSML calls, fullwidth or ASCII bars, with or without a closing tag", () => {
    const leaked =
      'Let me check.\n\n<｜DSML｜calls> <｜DSML｜invoke name="look"> <｜DSML｜parameter name="start">60</｜DSML｜parameter> </｜DSML｜invoke> </｜DSML｜calls>';
    expect(stripToolMarkup(leaked)).toEqual({ text: "Let me check.", stripped: true });
    const ascii = 'Before.\n<|DSML|function_calls>\n<|DSML|invoke name="frame">';
    expect(stripToolMarkup(ascii)).toEqual({ text: "Before.", stripped: true });
    expect(stripToolMarkup("A < ｜ DSML ｜ calls >x</ ｜ DSML ｜ calls > B").text).toBe("A  B");
  });

  it("strips stray DSML tags", () => {
    expect(stripToolMarkup("Answer.</｜DSML｜invoke><｜DSML｜parameter>")).toEqual({
      text: "Answer.",
      stripped: true,
    });
  });

  it("strips DeepSeek native tool call tokens", () => {
    const leaked =
      "Two dogs.<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>look\n{}<｜tool▁call▁end｜><｜tool▁calls▁end｜>";
    expect(stripToolMarkup(leaked)).toEqual({ text: "Two dogs.", stripped: true });
    expect(stripToolMarkup("Ok.<｜tool▁sep｜>").text).toBe("Ok.");
  });

  it("strips tool_call and function_calls blocks", () => {
    expect(stripToolMarkup('<tool_call>{"name": "look"}</tool_call>Seen.').text).toBe("Seen.");
    expect(
      stripToolMarkup('Seen.<function_calls><invoke name="look"></invoke></function_calls>').text,
    ).toBe("Seen.");
    expect(stripToolMarkup('Seen.\n<tool_call>{"name": "look"').text).toBe("Seen.");
  });

  it("strips <|tool_call|>-style tags and blocks", () => {
    expect(stripToolMarkup('Seen.<|tool_call|>[{"name": "look"}]<|/tool_call|>').text).toBe(
      "Seen.",
    );
    expect(stripToolMarkup("Seen.<|tool_call_begin|>look:0<|tool_call_end|>").text).toBe("Seen.");
    expect(stripToolMarkup("<|tool_calls_section_begin|>Seen.").text).toBe("Seen.");
  });

  it("keeps the text around markup in the middle", () => {
    const leaked =
      'First part.\n\n<｜DSML｜calls><｜DSML｜invoke name="look"></｜DSML｜invoke></｜DSML｜calls>\n\nSecond part.';
    expect(stripToolMarkup(leaked)).toEqual({
      text: "First part.\n\nSecond part.",
      stripped: true,
    });
  });

  it("leaves ordinary text, including its whitespace, untouched", () => {
    const text = "  A | B <b>bold</b> and x < y > z.\n\n\n";
    expect(stripToolMarkup(text)).toEqual({ text, stripped: false });
  });
});
