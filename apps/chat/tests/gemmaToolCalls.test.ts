import { describe, expect, it } from "vitest";
import { parseGemmaToolCalls } from "../src/chat/gemmaToolCalls";

function argumentsOf(text: string): unknown[] {
  const parsed = parseGemmaToolCalls(text);
  if (parsed.kind !== "calls") throw new Error(`Not parsed: ${parsed.kind}`);
  return parsed.calls.map((call): unknown => JSON.parse(call.arguments));
}

describe("parseGemmaToolCalls", () => {
  it("reads a call's name and bare arguments as JSON", () => {
    expect(
      parseGemmaToolCalls("<|tool_call>call:look{end:60,frames:30,start:45}<tool_call|>"),
    ).toEqual({
      kind: "calls",
      calls: [{ name: "look", arguments: '{"end":60,"frames":30,"start":45}' }],
    });
  });

  it("finds calls among prose, back to back or apart", () => {
    const text =
      "Let me look.\n<|tool_call>call:look{start:0,end:30}<tool_call|><|tool_call>call:listen{start:0,end:30}<tool_call|>\nAnd then.";
    const parsed = parseGemmaToolCalls(text);
    expect(parsed.kind === "calls" ? parsed.calls.map((call) => call.name) : []).toEqual([
      "look",
      "listen",
    ]);
  });

  it("reads Gemma strings, quoted strings, booleans, null and negative numbers", () => {
    const text =
      '<|tool_call>call:note{text:<|"|>a dog, then {a ball}<|"|>,label:"say \\"hi\\"",pinned:true,gone:false,at:null,shift:-1.5,mode:fast}<tool_call|>';
    expect(argumentsOf(text)).toEqual([
      {
        text: "a dog, then {a ball}",
        label: 'say "hi"',
        pinned: true,
        gone: false,
        at: null,
        shift: -1.5,
        mode: "fast",
      },
    ]);
  });

  it("reads nested objects and arrays, with spaces and trailing commas", () => {
    const text =
      '<|tool_call> call: ask { question: <|"|>Who?<|"|>, pictures: [ <|"|>p1<|"|>, <|"|>p2<|"|>, ], area: {x:1, y:[2,3]}, } <tool_call|>';
    expect(argumentsOf(text)).toEqual([
      { question: "Who?", pictures: ["p1", "p2"], area: { x: 1, y: [2, 3] } },
    ]);
  });

  it("gives empty arguments to a call without braces", () => {
    expect(argumentsOf("<|tool_call>call:recall<tool_call|>")).toEqual([{}]);
  });

  it("reads a call whose closing tag was cut off, but not one cut inside its arguments", () => {
    expect(argumentsOf("<|tool_call>call:look{start:45,end:60}")).toEqual([{ start: 45, end: 60 }]);
    expect(parseGemmaToolCalls("<|tool_call>call:look{start:45,en")).toEqual({ kind: "unparsed" });
    expect(parseGemmaToolCalls('<|tool_call>call:note{text:<|"|>a do')).toEqual({
      kind: "unparsed",
    });
  });

  it("reports a block it cannot read, even beside one it can", () => {
    expect(parseGemmaToolCalls("<|tool_call><tool_call|>")).toEqual({ kind: "unparsed" });
    expect(parseGemmaToolCalls("<|tool_call>call:look{start:1} stray<tool_call|>")).toEqual({
      kind: "unparsed",
    });
    expect(
      parseGemmaToolCalls("<|tool_call>call:look{}<tool_call|><|tool_call>{x:1}<tool_call|>"),
    ).toEqual({ kind: "unparsed" });
  });

  it("finds nothing in text without Gemma calls, including other models' markup", () => {
    expect(parseGemmaToolCalls("A dog runs.")).toEqual({ kind: "none" });
    expect(parseGemmaToolCalls('<tool_call>{"name": "look"}</tool_call>')).toEqual({
      kind: "none",
    });
    expect(parseGemmaToolCalls('<|tool_call|>[{"name": "look"}]<|/tool_call|>')).toEqual({
      kind: "none",
    });
  });
});
