# @vid2grid/node (Node library)

Turns a video into collage sheets, grid JPEGs packing many timestamped
frames, from a Node.js script. It runs the same planner as the website and
implements its steps with ffprobe, ffmpeg and a Skia canvas, so the sheets
match every other way of using vid2grid. No browser is involved. The
[Node command line](../node-cli/) is built on it.

## Install

The package is private and not on npm, so it runs from a clone. It needs
Node 20 or later. From the repo root:

```bash
npm ci
npm run build --workspace apps/node-library
```

Code in this workspace then imports it as `@vid2grid/node`, as the command
line does. The build bundles core into `dist/`, because Node cannot load
core's TypeScript source directly.

ffmpeg, ffprobe and the canvas come prebuilt from npm (`ffmpeg-static`,
`@ffprobe-installer/ffprobe` and `@napi-rs/canvas`), so nothing is installed
system-wide. They add about 195 MB to `node_modules`. `ffmpeg-static`
downloads its binary in an install script, so `npm ci --ignore-scripts`
leaves the library without ffmpeg.

## Usage

```ts
import { renderVideo } from "@vid2grid/node";

const { plan, sheetPaths, timings, warnings } = await renderVideo(
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

`renderVideo(path, request, outDir, options?)` plans the sheets and writes
each one to `outDir` as soon as it is encoded, `grid_0001.jpg` onwards. It
returns the `RenderPlan`, the paths written, the timings and any warnings.
`options` takes `onProgress`, a `videoInfo` you have already probed and a
`signal`. Aborting the signal kills the running ffmpeg and rejects with the
signal's reason. The folder is made on the first sheet, so a rejected request
leaves none; a run that fails or is aborted partway leaves the sheets written
before that.

The library also exports:

- `createNodePorts()`: the ports on their own, for a caller that runs core's
  `generateCollages` itself and keeps the JPEG buffers in memory.
- `probeVideo(path)` and `readKeyframeTimes(path)`: the video's info and its
  keyframe times.
- `captureFrames` and `encodeSheet`: the capture and encode steps.

## How it follows the plan

- **Probe**: ffprobe reads the duration and coded size; core applies the
  sample aspect ratio and rotation, as for every host. Keyframe times are read
  only when keyframe sampling asks for them.
- **Capture**: ffmpeg decodes from the keyframe before the first planned time,
  scales each frame to its cell and pipes it out as raw RGBA. Each planned time
  takes the first frame at or after it. Where a keyframe lets it skip at least
  five seconds and 150 frames of video, it seeks there with a new ffmpeg
  process instead of decoding through, one process at a time, so a sparse plan
  over a long video is quick. When every planned time is a keyframe, one
  process decodes keyframes alone.
- **Render**: core's `paintSheetFromPlan` paints each sheet onto an
  `@napi-rs/canvas` canvas, which encodes it as JPEG. Two sheets encode at
  once.
- **Memory** stays flat however long the video: at most three sheets' frames
  are held at once.

## Limits

- No transcription. A request with `transcript` set still renders its sheets
  and reports a `no_transcription_port` warning.
- A sparse plan decodes straight through, which is slow on a long video, when
  a seek does not land on a keyframe with a known time (MPEG-TS, AVI) or the
  video has too few keyframes to skip to.
- On Linux, the bundled ffmpeg can crash opening an MPEG-TS file. Remux it to MP4
  or MKV first.
- A file with no seek index (MKV without cues, FLV) is read from its start on
  every seek. Once seeks take longer than decoding the video they skip, the
  rest is decoded straight through.

## Development

From the repo root:

```bash
npx vitest run --root apps/node-library
npm run build --workspace apps/node-library
```

The conformance test holds the library to the shared goldens in
[fixtures/](../../fixtures/): probing and frame choice over
`fixtures/frames/`, painting over `fixtures/draw-ops/`. It runs on its own
with:

```bash
npx vitest run --root apps/node-library tests/conformance.test.ts
```
