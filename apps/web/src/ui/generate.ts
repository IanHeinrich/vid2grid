import type { AppElements, FormElements } from "../dom";
import { setGenerating, setResults, type AppState, type GenerationResults } from "../state";
import { readInteger, readNumber } from "../inputs";
import { toUserMessage } from "../errors";
import type { StatusLine } from "./status";
import type { Gallery } from "./gallery";
import {
  collagePlanRequestProblem,
  generateCollages,
  type CollagePlanRequest,
  type Phase,
  type Progress,
} from "@vid2grid/core";
import { createBrowserPorts } from "@vid2grid/browser";

type PhaseWeights = Record<Phase, number>;

// Rough share of wall-clock time each phase takes, so the bar moves at an even pace.
const PHASE_WEIGHTS_WITH_TRANSCRIPT: PhaseWeights = {
  extracting: 0.5,
  rendering: 0.2,
  transcribing: 0.3,
};
const PHASE_WEIGHTS_WITHOUT_TRANSCRIPT: PhaseWeights = {
  extracting: 0.7,
  rendering: 0.3,
  transcribing: 0,
};

export interface GenerateControls {
  render(): void;
}

interface GenerateContext {
  els: Pick<AppElements, "form" | "generate">;
  state: AppState;
  status: StatusLine;
  gallery: Gallery;
}

export function buildRequest(form: FormElements): CollagePlanRequest {
  return {
    startSeconds: readNumber(form.startTimeInput),
    endSeconds: readNumber(form.endTimeInput),
    targetFps: readNumber(form.targetFpsInput),
    keyframeSampling: form.keyframeModeInput.checked,
    framesPerGrid: readInteger(form.framesPerGridInput),
    outputResolution: readInteger(form.outputResolutionInput),
    jpegQuality: readInteger(form.jpegQualityInput),
    ...(form.transcriptModeInput.checked && {
      transcript: { scope: form.transcriptCombinedInput.checked ? "combined" : "per-sheet" },
    }),
  };
}

export function overallProgress({ phase, done, total }: Progress, withTranscript: boolean): number {
  const weights = withTranscript ? PHASE_WEIGHTS_WITH_TRANSCRIPT : PHASE_WEIGHTS_WITHOUT_TRANSCRIPT;
  const phaseStarts: PhaseWeights = {
    extracting: 0,
    rendering: weights.extracting,
    transcribing: weights.extracting + weights.rendering,
  };
  return phaseStarts[phase] + (done / total) * weights[phase];
}

export function progressLabel({ phase, stage }: Progress): string {
  if (phase === "extracting") return "Extracting frames...";
  if (phase === "rendering") return "Rendering collage sheets...";
  if (stage === "model") return "Downloading speech model (first use only)...";
  return "Transcribing audio...";
}

export function initGenerate(
  els: Pick<AppElements, "form" | "generate">,
  state: AppState,
  deps: { status: StatusLine; gallery: Gallery },
): GenerateControls {
  const ctx: GenerateContext = { els, state, ...deps };
  const { form, generate } = els;
  form.jpegQualityInput.addEventListener("input", () => renderJpegQuality(ctx));
  // The "combined transcript" option only means something once transcription is on.
  form.transcriptModeInput.addEventListener("change", () => renderTranscriptMode(ctx));
  generate.generateButton.addEventListener("click", () => {
    void generateGrids(ctx);
  });
  renderJpegQuality(ctx);
  renderTranscriptMode(ctx);
  renderGenerateButton(ctx);
  return { render: () => renderGenerateButton(ctx) };
}

function renderJpegQuality(ctx: GenerateContext): void {
  ctx.els.generate.jpegQualityValue.textContent = ctx.els.form.jpegQualityInput.value;
}

function renderTranscriptMode(ctx: GenerateContext): void {
  ctx.els.generate.transcriptCombinedField.hidden = !ctx.els.form.transcriptModeInput.checked;
}

function renderGenerateButton(ctx: GenerateContext): void {
  ctx.els.generate.generateButton.disabled = !ctx.state.videoInfo || ctx.state.generating;
}

function renderProgress(ctx: GenerateContext, fraction: number, label: string): void {
  const { progressContainer, progressBar, progressText } = ctx.els.generate;
  const percent = Math.round(fraction * 100);
  progressContainer.hidden = false;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${label} ${percent}%`;
}

function hideProgress(ctx: GenerateContext): void {
  ctx.els.generate.progressContainer.hidden = true;
}

function setGeneratingAndRender(ctx: GenerateContext, generating: boolean): void {
  setGenerating(ctx.state, generating);
  renderGenerateButton(ctx);
}

async function generateGrids(ctx: GenerateContext): Promise<void> {
  const file = ctx.state.videoFile;
  if (!file) return;
  setResults(ctx.state, null);
  ctx.gallery.render();
  setGeneratingAndRender(ctx, true);
  ctx.status.show("");

  const request = buildRequest(ctx.els.form);
  const problem = collagePlanRequestProblem(request);
  if (problem !== undefined) {
    ctx.status.show(problem);
    setGeneratingAndRender(ctx, false);
    return;
  }

  try {
    const results = await runGeneration(ctx, file, request);
    if (!isCurrentFile(ctx, file)) return;
    setResults(ctx.state, results);
    ctx.gallery.render();
  } catch (err) {
    if (isCurrentFile(ctx, file)) {
      ctx.status.show(`Failed to generate collages: ${toUserMessage(err)}`);
    }
  } finally {
    hideProgress(ctx);
    setGeneratingAndRender(ctx, false);
  }
}

// A file loaded mid-generation owns the results and status from then on.
function isCurrentFile(ctx: GenerateContext, file: File): boolean {
  return ctx.state.videoFile === file;
}

async function runGeneration(
  ctx: GenerateContext,
  file: File,
  request: CollagePlanRequest,
): Promise<GenerationResults> {
  const withTranscript = request.transcript !== undefined;
  const { videoInfo } = ctx.state;
  const { plan, sheets, transcriptFiles } = await generateCollages(
    file,
    request,
    createBrowserPorts(),
    {
      ...(videoInfo && { videoInfo }),
      onProgress: (progress) =>
        renderProgress(ctx, overallProgress(progress, withTranscript), progressLabel(progress)),
      onWarning: (warning) => {
        if (isCurrentFile(ctx, file)) ctx.status.show(warning.message);
      },
    },
  );
  return { plan, sheets, transcriptFiles };
}
