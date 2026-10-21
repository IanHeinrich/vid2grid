# @vid2grid/node

The Node.js host for vid2grid. It runs the same planner as the browser app
(`generateCollages` from `@vid2grid/core`) and implements its ports with
ffprobe, ffmpeg and a Skia canvas, so a video becomes the same collage sheets
from the command line or a Node script. Nothing is uploaded and no browser is
involved.

The binaries come prebuilt from npm: `ffmpeg-static`, `@ffprobe-installer/ffprobe`
and `@napi-rs/canvas`. There is nothing to install system-wide, but they add
about 195 MB to `node_modules` (on Windows x64: ffmpeg 80 MB, ffprobe 78 MB,
the canvas 37 MB). ffprobe and the canvas arrive as per-platform npm packages;
`ffmpeg-static` instead downloads its binary from its GitHub releases in an
install script, so `npm ci --ignore-scripts` leaves this package without ffmpeg.

## Command line

From the repo root, after `npm ci`:

```sh
npm run build --workspace packages/node
node packages/node/dist/cli.js clip.mp4 -o sheets --fps 4 --frames-per-grid 9
```

The flags, their defaults and the `--help` text are generated from core's
`optionSpecsFor` (the shared `OPTION_SPECS`), and the values go through core's
`requestFromOptions`, so the CLI offers exactly the options every host does
and fills in the same defaults. Run `--help` for the list. `--transcript` is
not offered, because this host has no transcription.

It prints the path of each sheet it wrote, `grid_0001.jpg` onwards, named by
the plan. The package declares a `vid2grid-node` bin for the same entry point.

## From Node

```ts
import { renderVideo } from "@vid2grid/node";

const { sheetPaths, timings, warnings } = await renderVideo(
  "clip.mp4",
  {
    startSeconds: 0,
    endSeconds: 30,
    targetFps: 1,
    framesPerGrid: 16,
    outputResolution: 1024,
    jpegQuality: 85,
  },
  "sheets",
);
```

`createNodePorts()` returns the ports on their own for a caller that wants to
run `generateCollages` itself and keep the JPEG buffers in memory.

## How it follows the plan

- **Probe**: ffprobe reads the duration and the coded size, and core's
  `displaySize` and `normalizeRotationClockwise` apply the sample aspect ratio
  and the rotation (a display matrix or a `rotate` tag), as for every host.
  Keyframe times are read from the packets only when keyframe mode asks for
  them.
- **Capture**: one ffmpeg process per run decodes from the keyframe before the
  first planned time, scales each frame to the plan's cell and pipes it out as
  raw RGBA. Each planned time takes the first decoded frame at or after it,
  compared at whole microseconds, by core's `createFrameMatcher`. When core's
  `isKeyframePlan` finds every planned time among the probed keyframes, ffmpeg
  decodes keyframes alone. Each frame's time comes from ffmpeg's `showinfo`
  log, and every frame that is kept has its pixels checked against the
  checksum logged with that time, so a frame lost between the two outputs
  fails the run. ffmpeg is stopped as soon as the last planned frame is
  filled.
- **Render**: each sheet is painted by core's `paintSheetFromPlan` onto an
  `@napi-rs/canvas` canvas and encoded as JPEG at the plan's quality.

## What it does not do

- **No transcription.** The transcript port is optional in core and this host
  leaves it out. A request with `transcript` set still renders its sheets and
  reports a `no_transcription_port` warning.
- **Memory grows with the number of planned frames.** `generateCollages`
  captures every planned frame, each held as raw RGBA at the cell size, before
  it renders the first sheet. A 1024 px sheet of 9 frames has cells of roughly
  330 by 250 pixels, about 330 KB each, so 3,000 planned frames hold about
  1 GB. The Python package keeps one sheet's frames at a time instead.
- Within one run ffmpeg decodes every frame between the first and the last
  planned time. The Python package seeks across long gaps instead, so a very
  low frame rate over a long video is slower here.
- The package is private and not yet published to npm.

## Development

Run from the repo root:

```sh
npm test --workspace packages/node
npm run build --workspace packages/node
```

The conformance checks against the shared goldens in `fixtures/` (probe and
frame selection over `fixtures/frames/`, painting over `fixtures/draw-ops/`)
run on their own with:

```sh
npx vitest run --root packages/node tests/conformance.test.ts
```

The build bundles `@vid2grid/core` with Vite into `dist/`, because Node cannot
load core's TypeScript source directly, and leaves the packages carrying native
binaries external.
