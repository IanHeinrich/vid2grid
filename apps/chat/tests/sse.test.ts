import { describe, expect, it } from "vitest";
import { createSseParser } from "../src/api/sse";

describe("createSseParser", () => {
  it("returns the payload of a completed event", () => {
    const parser = createSseParser();
    expect(parser.feed('data: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it("returns several events from one chunk", () => {
    const parser = createSseParser();
    expect(parser.feed("data: one\n\ndata: two\n\n")).toEqual(["one", "two"]);
  });

  it("waits for the blank line before returning an event", () => {
    const parser = createSseParser();
    expect(parser.feed("data: one\n")).toEqual([]);
    expect(parser.feed("\n")).toEqual(["one"]);
  });

  it("joins a line split across chunks", () => {
    const parser = createSseParser();
    expect(parser.feed("da")).toEqual([]);
    expect(parser.feed("ta: hel")).toEqual([]);
    expect(parser.feed("lo\n\n")).toEqual(["hello"]);
  });

  it("handles CRLF line endings", () => {
    const parser = createSseParser();
    expect(parser.feed("data: one\r\n\r\ndata: two\r\n\r\n")).toEqual(["one", "two"]);
  });

  it("handles a CRLF split between the carriage return and the line feed", () => {
    const parser = createSseParser();
    expect(parser.feed("data: one\r")).toEqual([]);
    expect(parser.feed("\n\r")).toEqual([]);
    expect(parser.feed("\n")).toEqual(["one"]);
  });

  it("ignores comment lines", () => {
    const parser = createSseParser();
    expect(parser.feed(": keep-alive\n\ndata: one\n: note\n\n")).toEqual(["one"]);
  });

  it("joins multi-line data with a newline", () => {
    const parser = createSseParser();
    expect(parser.feed("data: first\ndata: second\n\n")).toEqual(["first\nsecond"]);
  });

  it("strips only a single space after the colon", () => {
    const parser = createSseParser();
    expect(parser.feed("data:tight\n\ndata:  loose\n\n")).toEqual(["tight", " loose"]);
  });

  it("ignores fields other than data", () => {
    const parser = createSseParser();
    expect(parser.feed("event: message\nid: 7\nretry: 100\ndata: one\n\n")).toEqual(["one"]);
  });

  it("returns [DONE] like any other payload", () => {
    const parser = createSseParser();
    expect(parser.feed("data: [DONE]\n\n")).toEqual(["[DONE]"]);
  });

  it("returns nothing for blank lines without data", () => {
    const parser = createSseParser();
    expect(parser.feed("\n\n\n")).toEqual([]);
  });
});
