export interface SseParser {
  feed(chunk: string): string[];
}

const LINE_END = /\r\n|\n|\r/;

export function createSseParser(): SseParser {
  let buffer = "";
  let dataLines: string[] = [];

  function readLine(line: string, events: string[]): void {
    if (line === "") {
      if (dataLines.length > 0) events.push(dataLines.join("\n"));
      dataLines = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return;
    const value = colon === -1 ? "" : line.slice(colon + 1);
    dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
  }

  return {
    feed(chunk) {
      buffer += chunk;
      const events: string[] = [];
      for (;;) {
        const match = LINE_END.exec(buffer);
        if (!match) break;
        // A trailing \r may be the first half of \r\n, so wait for the next chunk.
        if (match[0] === "\r" && match.index === buffer.length - 1) break;
        readLine(buffer.slice(0, match.index), events);
        buffer = buffer.slice(match.index + match[0].length);
      }
      return events;
    },
  };
}
