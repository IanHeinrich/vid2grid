import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRenderPlan, type CollagePlanRequest, type VideoInfo } from "@vid2grid/core";

interface FixtureCase {
  name: string;
  request: CollagePlanRequest;
  info: VideoInfo;
}

const LANDSCAPE: VideoInfo = { durationSeconds: 3, width: 320, height: 240 };
const PORTRAIT: VideoInfo = { durationSeconds: 60, width: 1080, height: 1920 };
const HD: VideoInfo = { durationSeconds: 92.4, width: 1920, height: 1080 };

// Keyframes roughly every 2s, deliberately not on whole numbers.
const SPARSE_KEYFRAMES = [0, 2.002, 4.004, 6.006, 8.008, 10.01, 12.012, 14.014, 16.016];
const DENSE_KEYFRAMES = Array.from({ length: 24 }, (_, i) => Number((i * 0.5).toFixed(3)));

const CASES: FixtureCase[] = [
  {
    name: "landscape-3s-fps2-4up-512",
    request: {
      startSeconds: 0,
      endSeconds: 3,
      targetFps: 2,
      framesPerGrid: 4,
      outputResolution: 512,
      jpegQuality: 85,
      transcript: { scope: "per-sheet" },
    },
    info: LANDSCAPE,
  },
  {
    name: "portrait-60s-fps1-12up-2048",
    request: {
      startSeconds: 0,
      endSeconds: 60,
      targetFps: 1,
      framesPerGrid: 12,
      outputResolution: 2048,
      jpegQuality: 80,
    },
    info: PORTRAIT,
  },
  {
    name: "single-sheet-16-frames-1024",
    request: {
      startSeconds: 0,
      endSeconds: 92.4,
      targetFps: 16 / 92.4,
      frameCount: 16,
      framesPerGrid: 16,
      outputResolution: 1024,
      jpegQuality: 85,
    },
    info: HD,
  },
  {
    name: "keyframe-sparse-9-frames",
    request: {
      startSeconds: 0,
      endSeconds: 20,
      targetFps: 2,
      keyframeSampling: true,
      framesPerGrid: 4,
      outputResolution: 1024,
      jpegQuality: 85,
    },
    info: {
      durationSeconds: 20,
      width: 1280,
      height: 720,
      keyframeTimestampsSeconds: SPARSE_KEYFRAMES,
    },
  },
  {
    name: "keyframe-capped-to-8",
    request: {
      startSeconds: 0,
      endSeconds: 12,
      targetFps: 1,
      keyframeSampling: true,
      maxKeyframes: 8,
      framesPerGrid: 6,
      outputResolution: 1024,
      jpegQuality: 85,
    },
    info: {
      durationSeconds: 12,
      width: 1280,
      height: 720,
      keyframeTimestampsSeconds: DENSE_KEYFRAMES,
    },
  },
  {
    name: "two-hours-fps-half",
    request: {
      startSeconds: 7100,
      endSeconds: 7200,
      targetFps: 0.5,
      framesPerGrid: 9,
      outputResolution: 1536,
      jpegQuality: 75,
    },
    info: { durationSeconds: 7200, width: 1920, height: 1080 },
  },
  {
    name: "trailing-partial-sheet",
    request: {
      startSeconds: 0,
      endSeconds: 7,
      targetFps: 1,
      framesPerGrid: 4,
      outputResolution: 768,
      jpegQuality: 85,
    },
    info: { durationSeconds: 7, width: 640, height: 480 },
  },
  {
    name: "transcript-per-sheet-windows",
    request: {
      startSeconds: 5,
      endSeconds: 35,
      targetFps: 1,
      framesPerGrid: 6,
      outputResolution: 1024,
      jpegQuality: 85,
      transcript: { scope: "per-sheet" },
    },
    info: { durationSeconds: 40, width: 1280, height: 720 },
  },
  {
    name: "transcript-combined",
    request: {
      startSeconds: 5,
      endSeconds: 35,
      targetFps: 1,
      framesPerGrid: 6,
      outputResolution: 1024,
      jpegQuality: 85,
      transcript: { scope: "combined" },
    },
    info: { durationSeconds: 40, width: 1280, height: 720 },
  },
  {
    name: "min-font-clamp",
    request: {
      startSeconds: 0,
      endSeconds: 10,
      targetFps: 4,
      framesPerGrid: 36,
      outputResolution: 512,
      jpegQuality: 85,
    },
    info: { durationSeconds: 10, width: 640, height: 480 },
  },
];

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "render-plans");
mkdirSync(fixturesDir, { recursive: true });

for (const { name, request, info } of CASES) {
  const fixture = { name, request, info, plan: buildRenderPlan(request, info) };
  writeFileSync(
    join(fixturesDir, `${name}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
    "utf-8",
  );
  console.log(`wrote fixtures/render-plans/${name}.json`);
}
