import { requestFromOptions, Vid2GridError } from "@vid2grid/core";
import { probeVideo, renderVideo, type RenderVideoResult } from "@vid2grid/node";
import { NODE_CAPABILITIES, parseCliArgs, USAGE, type CliCommand } from "./cliArgs";

async function main(argv: readonly string[]): Promise<void> {
  let command: CliCommand;
  try {
    command = parseCliArgs(argv);
  } catch (error) {
    throw new Vid2GridError("invalid_request", `${errorMessage(error)}\n\n${USAGE}`);
  }
  if (command.kind === "help") {
    console.log(USAGE);
    return;
  }

  const { videoPath, outDir, options } = command;
  const videoInfo = await probeVideo(videoPath);
  const request = requestFromOptions(options, videoInfo, NODE_CAPABILITIES);
  report(await renderVideo(videoPath, request, outDir, { videoInfo }));
}

function report({ warnings, sheetPaths, timings }: RenderVideoResult): void {
  for (const warning of warnings) console.error(`warning: ${warning.message}`);
  for (const sheetPath of sheetPaths) console.log(sheetPath);
  const extractMs = Math.round(timings.phaseMs.extracting ?? 0);
  const renderMs = Math.round(timings.phaseMs.rendering ?? 0);
  console.error(
    `${timings.frameCount} frames on ${timings.sheetCount} sheets: ` +
      `extract ${extractMs} ms, render ${renderMs} ms`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
