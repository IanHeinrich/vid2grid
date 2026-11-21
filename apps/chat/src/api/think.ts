import type { AssistantMessage } from "../types";

const OPEN_THINK = "<think>";
const CLOSE_THINK = "</think>";

export type ThinkPiece = { kind: "text" | "reasoning"; delta: string };

function partialTagLength(text: string, tag: string): number {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length--) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}

export function createThinkSplitter() {
  let inside = false;
  let pending = "";

  function drain(final: boolean): ThinkPiece[] {
    const pieces: ThinkPiece[] = [];
    const emit = (delta: string) => {
      if (delta) pieces.push({ kind: inside ? "reasoning" : "text", delta });
    };
    for (;;) {
      const tag = inside ? CLOSE_THINK : OPEN_THINK;
      const at = pending.indexOf(tag);
      if (at !== -1) {
        emit(pending.slice(0, at));
        pending = pending.slice(at + tag.length);
        inside = !inside;
        continue;
      }
      const held = final ? 0 : partialTagLength(pending, tag);
      emit(pending.slice(0, pending.length - held));
      pending = pending.slice(pending.length - held);
      return pieces;
    }
  }

  return {
    feed(text: string): ThinkPiece[] {
      pending += text;
      return drain(false);
    },
    flush(): ThinkPiece[] {
      return drain(true);
    },
  };
}

// Qwen3 and DeepSeek-R1 templates on local servers pre-fill <think>, so only the closing tag streams.
export function splitThink(
  text: string,
  reasoning: string,
): Pick<AssistantMessage, "text" | "reasoning"> {
  if (reasoning.length > 0) return { text, reasoning };
  const end = text.indexOf(CLOSE_THINK);
  if (end < 0) return { text };
  const thought = text.slice(0, end).replace(/^\s*<think>/, "");
  return { reasoning: thought.trim(), text: text.slice(end + CLOSE_THINK.length).trimStart() };
}
