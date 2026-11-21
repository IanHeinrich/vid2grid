import type { ToolSchema } from "../types";
import { MAX_FRAMES_PER_SHEET } from "./packing";

export const MAX_LOOK_FRAMES = 64;
export const MAX_FRAMES_TIMES = 9;

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "look",
      description:
        "Render frames from start to end of the video as grid images, perSheet frames per image. " +
        "Fewer frames per sheet means larger, more detailed frames: about 16 to 20 for a broad scan, 6 to 9 for a normal look, 1 to 4 to read fine detail. " +
        "frames and perSheet are adjusted so every sheet is full, with no blank space. Every frame has its timestamp printed on it.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "number", description: "Start time in seconds." },
          end: { type: "number", description: "End time in seconds." },
          frames: {
            type: "integer",
            minimum: 1,
            maximum: MAX_LOOK_FRAMES,
            description: "How many evenly spaced frames to take between start and end.",
          },
          perSheet: {
            type: "integer",
            minimum: 1,
            maximum: MAX_FRAMES_PER_SHEET,
            description:
              "Frames packed into each image, at most frames. Adjusted to fill the sheets.",
          },
        },
        required: ["start", "end", "frames", "perSheet"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "frames",
      description:
        "Render exactly these moments of the video on one image. Use it to check specific details. " +
        "One call with several times costs one image.",
      parameters: {
        type: "object",
        properties: {
          times: {
            type: "array",
            items: { type: "number" },
            minItems: 1,
            maxItems: MAX_FRAMES_TIMES,
            description: "Times in seconds, 1 to 9 of them.",
          },
        },
        required: ["times"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "note",
      description:
        "Record an observation in the scene log, which is kept for the rest of the chat.",
      parameters: {
        type: "object",
        properties: {
          t: { type: "number", description: "Time in seconds the observation is about." },
          text: { type: "string", description: "The observation." },
        },
        required: ["t", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description:
        "Attach earlier images again, by the names their stubs give, without rendering anything.",
      parameters: {
        type: "object",
        properties: {
          names: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: 'Image names as the stubs give them, e.g. "grid_0002 from look(60, 90)".',
          },
        },
        required: ["names"],
      },
    },
  },
];

// Listed only on a message with audio turned on, so the model is never offered it otherwise.
export const LISTEN_SCHEMA: ToolSchema = {
  type: "function",
  function: {
    name: "listen",
    description:
      "Read what is heard from start to end of the video: speech in quotes and sound events, one line each in time order. " +
      "The audio is analysed on the user's machine the first time a stretch is heard, which can take a while. " +
      "One call covers at most 10 minutes; call again from where it stopped for more.",
    parameters: {
      type: "object",
      properties: {
        start: { type: "number", description: "Start time in seconds." },
        end: {
          type: "number",
          description: "End time in seconds, at most 10 minutes after start.",
        },
      },
      required: ["start", "end"],
    },
  },
};

export function toolSchemas(audio: boolean): ToolSchema[] {
  return audio ? [...TOOL_SCHEMAS, LISTEN_SCHEMA] : TOOL_SCHEMAS;
}

// How to use the tools, the same for every voice; history adds the voice's answer style.
export const TOOL_GUIDANCE = [
  "The attached video is available through the look, frames and note tools.",
  "Scan with a dense look first (16 to 20 frames per sheet). When a detail is unclear, repeat that range with fewer frames per sheet (6 to 9 for a normal look, 1 to 4 for fine detail), or check the moments with frames, instead of guessing.",
  "Batch the specific moments you want into one frames call rather than one call per moment, and make several tool calls in one round rather than one per round.",
  "perSheet is adjusted to fill each sheet without blank space, and the result says what was actually rendered.",
  "Every frame has its timestamp printed on it.",
  "Older images become text stubs; recall one by its stub's name, and use note for anything worth remembering.",
].join("\n");
