export type LabelWordings = readonly string[];

export interface SoundLabel {
  name: string;
  wordings: LabelWordings;
}

// A line is `name` or `name: wording; wording`. A name with no wordings is its own wording.
export function parseSoundLabel(line: string): SoundLabel {
  const colon = line.indexOf(":");
  if (colon < 0) {
    const name = line.trim();
    return { name, wordings: [name] };
  }
  const wordings = line
    .slice(colon + 1)
    .split(";")
    .map((wording) => wording.trim())
    .filter((wording) => wording !== "");
  const name = line.slice(0, colon).trim() || (wordings[0] ?? "");
  return { name, wordings: wordings.length > 0 ? wordings : [name] };
}
