const TEMPLATE_MAX_WORDS = 2;

// The template helps CLAP with a word or two but hurts a longer phrase, which goes as typed.
export function clapPrompt(wording: string): string {
  const words = wording.trim().split(/\s+/).length;
  return words <= TEMPLATE_MAX_WORDS ? `This is a sound of ${wording}.` : wording;
}
