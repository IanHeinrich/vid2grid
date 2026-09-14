export const MODEL_RESOLUTION_PRESETS: Record<string, number> = {
  "OpenAI GPT-5.x (high detail)": 2048,
  "OpenAI GPT-5.x (original/auto detail)": 3072,
  "OpenAI GPT-4o / GPT-4.1 (tile-based)": 2048,
  "Google Gemini 3.x": 2048,
  "Anthropic Claude (standard tier)": 1536,
  "Anthropic Claude (Opus 4.7+ / Sonnet 5 / Fable 5, high-res tier)": 2560,
  "xAI Grok (direct API, file-size limited only, ~20MiB)": 3072,
  "Venice: Venice Large (Qwen 3 VL, ~16MP ceiling)": 3840,
  "Venice: Grok 4.5 / 4.20 (~4-8MP ceiling)": 2000,
  "Venice: Claude Sonnet 4.6 / 5 (~3.75MP, 2576px edge)": 2560,
  "Venice: Venice Small (Llama 3.2 Vision, ~1.2MP)": 1088,
  "Unknown model (conservative default)": 1536,
};

export const CUSTOM_OPTION = "Custom";
