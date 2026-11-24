import type { ToolSchema } from "../types";
import { MAX_FRAMES_PER_SHEET } from "./packing";

export const MAX_LOOK_FRAMES = 64;
export const MAX_FRAMES_TIMES = 9;

const VIDEO_SCHEMAS: ToolSchema[] = [
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
];

const RECALL_SCHEMA: ToolSchema = {
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
};

const ASK_SCHEMA: ToolSchema = {
  type: "function",
  function: {
    name: "ask",
    description:
      "Ask the looking model about pictures from anywhere in this conversation. It sees the pictures themselves and answers in text.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "What to find out from the pictures." },
        pictures: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description:
            'Picture names as their labels give them, e.g. "grid_0002 from look(60, 90)" or "beach.jpg".',
        },
      },
      required: ["question", "pictures"],
    },
  },
};

const QUESTION = {
  type: "string",
  description: "Optional: what the looking model should find out from the new pictures.",
};
const TAKES_QUESTION: readonly string[] = ["look", "frames", "zoom"];

function withQuestion(schema: ToolSchema): ToolSchema {
  const { name, parameters } = schema.function;
  if (!TAKES_QUESTION.includes(name)) return schema;
  const properties = { ...(parameters["properties"] as object), question: QUESTION };
  return { ...schema, function: { ...schema.function, parameters: { ...parameters, properties } } };
}

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

const ZOOM_SCALE =
  "The area is in thousandths of the picture as shown: 0, 0 is its top left and 1000, 1000 its bottom right.";

function zoomEdge(edge: string, direction: string) {
  return {
    type: "number",
    minimum: 0,
    maximum: 1000,
    description: `${edge} edge, 0 to 1000 ${direction} the picture.`,
  };
}

// Without the loaded video there is no moment to name, only images.
function zoomSchema(videoLoaded: boolean): ToolSchema {
  const image = {
    type: "string",
    description:
      'An image\'s name as its label or stub gives it, e.g. "grid_0002 from look(60, 90)" or "beach.jpg".',
  };
  const t = {
    type: "number",
    description: "A time in seconds in the video; the area is then of that whole frame.",
  };
  const area = {
    left: zoomEdge("Left", "across"),
    top: zoomEdge("Top", "down"),
    right: zoomEdge("Right", "across"),
    bottom: zoomEdge("Bottom", "down"),
  };
  return {
    type: "function",
    function: {
      name: "zoom",
      description: videoLoaded
        ? `Show part of one video frame or image larger, at its source resolution. Give exactly one of image or t. ${ZOOM_SCALE}`
        : `Show part of one image larger, at its source resolution. ${ZOOM_SCALE} Frames of a video need the user to load it again.`,
      parameters: {
        type: "object",
        properties: { image, ...(videoLoaded ? { t } : {}), ...area },
        required: [...(videoLoaded ? [] : ["image"]), ...Object.keys(area)],
      },
    },
  };
}

const NOTE_GUIDANCE = "use note for anything worth remembering.";

// How to use the tools, the same for every voice; history adds the voice's answer style.
const VIDEO_GUIDANCE = [
  "The attached video is available through the look, frames and note tools.",
  "Scan with a dense look first (16 to 20 frames per sheet). When a detail is unclear, repeat that range with fewer frames per sheet (6 to 9 for a normal look, 1 to 4 for fine detail), or check the moments with frames, instead of guessing.",
  "Batch the specific moments you want into one frames call rather than one call per moment, and make several tool calls in one round rather than one per round.",
  "perSheet is adjusted to fill each sheet without blank space, and the result says what was actually rendered.",
  "Every frame has its timestamp printed on it.",
];

const OLDER_IMAGES_GUIDANCE = `Older images become text stubs; recall one by its stub's name, and ${NOTE_GUIDANCE}`;

const BEFORE_LOOKING_GUIDANCE =
  "If you write to the user before looking, keep it to one short line and claim nothing you have not seen yet.";

const IMAGE_GUIDANCE =
  "Older images become text stubs; recall one by its stub's name to see it again.";

const LOOKING_GUIDANCE = [
  "You cannot see pictures yourself. A separate looking model looks at every picture, and what it says is written in the picture's place, with the picture's name.",
  "Its descriptions leave things out. When a detail matters, call ask with a question and the pictures' names instead of guessing, about pictures from any earlier turn too. Never invent what it has not said.",
  "Do not mention the looking model to the user unless they ask about it.",
];

const LOOKING_QUESTION_GUIDANCE =
  "Give look, frames and zoom a question when you know what you want to find out from the new pictures. To zoom, ask where something is in the picture first if you do not know.";

const ZOOM_GUIDANCE =
  "When a detail is too small to read, use zoom. Its coordinates are of the picture as shown, 0 to 1000 each way. Prefer a generous area over a tight one.";

const ZOOM_GRID_GUIDANCE = "From a grid, aim zoom at one frame.";

export interface ToolSituation {
  videoLoaded: boolean;
  // The conversation holds at least one image.
  images: boolean;
  vision: boolean;
  listen: boolean;
  // A looking model sees the images in the writer's place, whatever its own vision.
  looking?: boolean;
}

export interface ToolOffer {
  tools: ToolSchema[];
  guidance: string;
}

export function toolOffer(situation: ToolSituation): ToolOffer {
  const { images, vision, looking } = situation;
  if (situation.videoLoaded) return videoOffer(situation);
  if (!images || (!vision && !looking)) return { tools: [], guidance: "" };
  if (looking) {
    return {
      tools: [ASK_SCHEMA, withQuestion(zoomSchema(false))],
      guidance: [...LOOKING_GUIDANCE, ZOOM_GUIDANCE].join("\n"),
    };
  }
  return {
    tools: [RECALL_SCHEMA, zoomSchema(false)],
    guidance: [IMAGE_GUIDANCE, ZOOM_GUIDANCE].join("\n"),
  };
}

function videoOffer({ vision, listen, looking }: ToolSituation): ToolOffer {
  const zoom = vision || looking === true;
  const zoomGuidance = zoom ? [`${ZOOM_GUIDANCE} ${ZOOM_GRID_GUIDANCE}`] : [];
  const tools = [
    ...VIDEO_SCHEMAS,
    looking ? ASK_SCHEMA : RECALL_SCHEMA,
    ...(zoom ? [zoomSchema(true)] : []),
    ...(listen ? [LISTEN_SCHEMA] : []),
  ];
  const seeing = looking
    ? [...LOOKING_GUIDANCE, LOOKING_QUESTION_GUIDANCE, `Also ${NOTE_GUIDANCE}`]
    : [OLDER_IMAGES_GUIDANCE];
  return {
    tools: looking ? tools.map(withQuestion) : tools,
    guidance: [...VIDEO_GUIDANCE, ...seeing, ...zoomGuidance, BEFORE_LOOKING_GUIDANCE].join("\n"),
  };
}
