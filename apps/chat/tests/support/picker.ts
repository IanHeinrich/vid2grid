import type { ModelInfo } from "../../src/types";
import { model } from "./factories";

export const LONG_DESCRIPTION =
  "Sharp eyes for video frames. ".repeat(12) + "It ends with this exact sentence.";

export const MODELS: ModelInfo[] = [
  model("qwen3-6-27b", {
    name: "Qwen 3.6 27B",
    traits: ["default_vision", "function_calling_default"],
    pricing: { inputPerMTok: 0.33, outputPerMTok: 3.25, cachedInputPerMTok: 0.1 },
    contextTokens: 262144,
    description: LONG_DESCRIPTION,
    reasoningEffortOptions: ["low", "high"],
    quantization: "fp8",
    videoInput: true,
  }),
  model("venice-uncensored", { name: "Venice Uncensored", uncensored: true, contextTokens: 32768 }),
  model("gemma-4", {
    name: "Gemma 4",
    reasoning: true,
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
    description: "Small and quick",
  }),
  model("glm-5v", { name: "GLM 5V", privacy: "anonymized", beta: true, contextTokens: 131072 }),
  model("audio-one", { name: "Audio One", audioInput: true, recommended: true }),
  model("text-only", { name: "Text Only", vision: false }),
];

export function firstModel(): ModelInfo {
  const [qwen] = MODELS;
  if (!qwen) throw new Error("No model");
  return qwen;
}

export function pickerIds(mount: HTMLElement): string[] {
  return [...mount.querySelectorAll<HTMLElement>(".model-row")].map((row) => row.dataset.id ?? "");
}

export function triggerName(mount: HTMLElement): string | null | undefined {
  return mount.querySelector(".model-trigger-name")?.textContent;
}

export function pickRow(mount: HTMLElement, id: string): void {
  mount.querySelector<HTMLButtonElement>(".model-trigger")?.click();
  mount.querySelector<HTMLElement>(`.model-row[data-id="${id}"]`)?.click();
}
