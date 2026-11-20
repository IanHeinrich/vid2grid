export interface WindowScores {
  startSeconds: number;
  endSeconds: number;
  scores: readonly number[];
}

export interface ScoredSpan {
  startSeconds: number;
  endSeconds: number;
  label: string;
  score: number;
}

export interface ScoreMergeOptions {
  minScore: number;
  backgroundLabels?: readonly string[];
}

export function softmax(logits: readonly number[]): number[] {
  if (logits.length === 0) return [];
  const peak = Math.max(...logits);
  const weights = logits.map((logit) => Math.exp(logit - peak));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

function topLabel(
  scores: readonly number[],
  labels: readonly string[],
): { label: string; score: number } | undefined {
  let best: { label: string; score: number } | undefined;
  scores.forEach((score, index) => {
    const label = labels[index];
    if (label !== undefined && (best === undefined || score > best.score)) best = { label, score };
  });
  return best;
}

export function mergeWindowScores(
  windows: readonly WindowScores[],
  labels: readonly string[],
  options: ScoreMergeOptions,
): ScoredSpan[] {
  const background = new Set(options.backgroundLabels ?? []);
  const spans: ScoredSpan[] = [];
  let open: ScoredSpan | undefined;
  for (const window of windows) {
    const top = topLabel(window.scores, labels);
    const kept =
      top && top.score >= options.minScore && !background.has(top.label) ? top : undefined;
    if (kept && open?.label === kept.label && window.startSeconds <= open.endSeconds) {
      open.endSeconds = window.endSeconds;
      open.score = Math.max(open.score, kept.score);
      continue;
    }
    open = kept && { startSeconds: window.startSeconds, endSeconds: window.endSeconds, ...kept };
    if (open) spans.push(open);
  }
  return spans;
}
