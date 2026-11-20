export type VisionConfidence = "high" | "medium" | "low";

export interface ModelVisionProfile {
  family: string;
  autoResolution: number;
  confidence: VisionConfidence;
  imageTokens?: (squarePx: number) => number;
}

interface VisionRule {
  pattern: RegExp;
  profile: ModelVisionProfile;
}

const UNKNOWN_MODEL: ModelVisionProfile = {
  family: "Unknown model",
  autoResolution: 1536,
  confidence: "low",
};

function patchTokens(squarePx: number, patchPx: number): number {
  return Math.ceil(squarePx / patchPx) ** 2;
}

function openAiTokens(patches: number): number {
  return Math.ceil(patches * 1.2);
}

const CLAUDE_HIGH_RES_SIDE = 1932;
const CLAUDE_SIDE = 1092;
const MISTRAL_SMALL_SIDE = 1540;
const MINIMAX_SIDE = 1008;

const GPT_LATEST = {
  family: "GPT-5.5 and later",
  autoResolution: 3072,
  imageTokens: (px: number) => openAiTokens(patchTokens(px, 32)),
};

const RULES: readonly VisionRule[] = [
  {
    pattern: /gemma-3/,
    profile: { family: "Gemma 3", autoResolution: 896, confidence: "high", imageTokens: () => 256 },
  },
  {
    pattern: /gemma-4/,
    profile: { family: "Gemma 4", autoResolution: 768, confidence: "high", imageTokens: () => 256 },
  },
  {
    pattern: /qwen/,
    profile: {
      family: "Qwen",
      autoResolution: 3072,
      confidence: "high",
      imageTokens: (px) => patchTokens(px, 32) + 2,
    },
  },
  {
    pattern: /mimo/,
    profile: {
      family: "MiMo",
      autoResolution: 3072,
      confidence: "medium",
      imageTokens: (px) => patchTokens(px, 32),
    },
  },
  // Claude shrinks an image to fit its token budget (4784 or 1568), so tokens stop at that side.
  {
    pattern: /claude-(opus-4-[78]|(opus|sonnet|haiku|fable)-5)/,
    profile: {
      family: "Claude (4.7 and later)",
      autoResolution: CLAUDE_HIGH_RES_SIDE,
      confidence: "high",
      imageTokens: (px) => patchTokens(Math.min(px, CLAUDE_HIGH_RES_SIDE), 28),
    },
  },
  {
    pattern: /claude/,
    profile: {
      family: "Claude",
      autoResolution: CLAUDE_SIDE,
      confidence: "high",
      imageTokens: (px) => patchTokens(Math.min(px, CLAUDE_SIDE), 28),
    },
  },
  {
    pattern: /gpt-4o/,
    profile: { family: "GPT-4o", autoResolution: 768, confidence: "high", imageTokens: () => 765 },
  },
  {
    pattern: /gpt-54/,
    profile: {
      family: "GPT-5.4",
      autoResolution: 1600,
      confidence: "high",
      imageTokens: (px) => openAiTokens(Math.min(patchTokens(px, 32), 2500)),
    },
  },
  {
    pattern: /gpt-5[23]/,
    profile: {
      family: "GPT-5.2 and 5.3",
      autoResolution: 2048,
      confidence: "medium",
      imageTokens: (px) => openAiTokens(patchTokens(px, 32)),
    },
  },
  { pattern: /gpt-5[56]/, profile: { ...GPT_LATEST, confidence: "high" } },
  { pattern: /gpt-6/, profile: { ...GPT_LATEST, confidence: "medium" } },
  {
    pattern: /mistral-small/,
    profile: {
      family: "Mistral Small",
      autoResolution: MISTRAL_SMALL_SIDE,
      confidence: "high",
      imageTokens: (px) => {
        const side = Math.ceil(Math.min(px, MISTRAL_SMALL_SIDE) / 28);
        return side * side + side;
      },
    },
  },
  {
    pattern: /deepseek/,
    profile: {
      family: "DeepSeek",
      autoResolution: 1300,
      confidence: "medium",
      imageTokens: (px) => Math.min(patchTokens(px, 28), 1024),
    },
  },
  {
    pattern: /minimax/,
    profile: {
      family: "MiniMax",
      autoResolution: MINIMAX_SIDE,
      confidence: "medium",
      imageTokens: (px) => patchTokens(Math.min(px, MINIMAX_SIDE), 28),
    },
  },
  {
    pattern: /nemotron.*vl/,
    profile: {
      family: "Nemotron VL",
      autoResolution: 1536,
      confidence: "low",
      imageTokens: (px) => (Math.min(patchTokens(px, 512), 12) + 1) * 256,
    },
  },
  {
    pattern: /kimi/,
    profile: {
      family: "Kimi",
      autoResolution: 2048,
      confidence: "low",
      imageTokens: (px) => patchTokens(px, 28),
    },
  },
  {
    pattern: /gemini/,
    profile: { family: "Gemini", autoResolution: 1536, confidence: "low", imageTokens: () => 1120 },
  },
  { pattern: /grok/, profile: { family: "Grok", autoResolution: 1536, confidence: "low" } },
  { pattern: /glm/, profile: { family: "GLM", autoResolution: 1536, confidence: "low" } },
];

export function modelVisionProfile(modelId: string): ModelVisionProfile {
  const id = modelId.toLowerCase().replace(/^e2ee-/, "");
  return RULES.find((rule) => rule.pattern.test(id))?.profile ?? UNKNOWN_MODEL;
}
