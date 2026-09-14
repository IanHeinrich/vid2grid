# The RenderPlan contract

A **RenderPlan** is plain JSON that says exactly how to turn one video into
collage sheets: which timestamps to capture, what size to scale each frame to,
where every frame goes on every sheet, what text to burn into it, and what to
call the output files.

`packages/core` is the only place that decides any of it
([`plan/buildRenderPlan.ts`](../packages/core/src/plan/buildRenderPlan.ts),
typed in [`plan/renderPlan.ts`](../packages/core/src/plan/renderPlan.ts)). An
**executor** (the browser one in `packages/browser`, the headless one in
`python/`) only decodes, scales, pastes, draws text and encodes. That keeps
the policy in one implementation and one set of tests, whatever language the
host is written in.

```
CollagePlanRequest + VideoInfo  ->  buildRenderPlan  ->  RenderPlan  ->  executor  ->  JPEG sheets (+ .vtt)
```

`RENDER_PLAN_VERSION` is `1`; `plan.version` carries it so an executor can
refuse a plan it does not understand.

## The shape, with the worked example

The plan below is the fixture
[`landscape-3s-fps2-4up-512.json`](../fixtures/render-plans/landscape-3s-fps2-4up-512.json)
in full: a 3 second 320x240 clip, sampled at 2 fps, 4 frames per 512px sheet,
with per-sheet transcripts. Its numbers are the ones `buildRenderPlan`'s unit
test hand-checks.

Request and probed video:

```json
{
  "startSeconds": 0,
  "endSeconds": 3,
  "targetFps": 2,
  "framesPerGrid": 4,
  "outputResolution": 512,
  "jpegQuality": 85,
  "transcript": { "scope": "per-sheet" }
}
```

```json
{ "durationSeconds": 3, "width": 320, "height": 240 }
```

Plan (frames 2-5 and sheet 2's cells elided):

```json
{
  "version": 1,
  "canvas": { "width": 512, "height": 512 },
  "cell": { "width": 244, "height": 183 },
  "layout": { "cols": 2, "rows": 2, "offsetX": 0, "offsetY": 61 },
  "style": {
    "background": "black",
    "textFill": "black",
    "textStroke": "white",
    "fontFamily": "sans-serif",
    "textBaseline": "top"
  },
  "jpegQuality": 85,
  "timestampFormat": { "showHours": false, "showMinutes": false, "showMilliseconds": true },
  "frames": [
    { "frameIndex": 0, "timestampSeconds": 0 },
    { "frameIndex": 1, "timestampSeconds": 0.5 }
  ],
  "sheets": [
    {
      "sheetIndex": 0,
      "fileName": "grid_0001.jpg",
      "cells": [
        {
          "frameIndex": 0,
          "timestampSeconds": 0,
          "x": 8,
          "y": 69,
          "width": 244,
          "height": 183,
          "watermarks": [
            {
              "text": "00.000",
              "anchor": "top-left",
              "x": 12,
              "y": 73,
              "fontSizePx": 11,
              "strokeWidthPx": 1
            },
            {
              "text": "0",
              "anchor": "top-right",
              "x": 248,
              "y": 73,
              "fontSizePx": 11,
              "strokeWidthPx": 1
            }
          ]
        }
      ],
      "transcript": { "startSeconds": 0, "endSeconds": 1.75, "fileName": "grid_0001.vtt" }
    },
    {
      "sheetIndex": 1,
      "fileName": "grid_0002.jpg",
      "cells": [],
      "transcript": { "startSeconds": 1.75, "endSeconds": 3, "fileName": "grid_0002.vtt" }
    }
  ]
}
```

## The rules

**Frame planning.** Sampled mode takes `count = max(1, floor((endSeconds -
startSeconds) * targetFps))` frames at `startSeconds + i / targetFps`. With
`frameCount` it takes exactly that many at `startSeconds + i * (endSeconds -
startSeconds) / frameCount`. Either way a timestamp at or past
`durationSeconds` ends the list. Keyframe mode (`keyframeSampling`) takes every
`keyframeTimestampsSeconds` inside `[startSeconds, endSeconds]` inclusive, then,
with `maxKeyframes`, thins them to the values at index `floor(i * n / m)`,
keeping the first one always. It throws when the probe supplied no keyframe
times.
`frameIndex` is 0-based across the whole export, so it keeps counting up across
sheets. `targetFps` still matters in keyframe mode: it decides whether the
burned-in timestamp shows milliseconds.

**Microsecond rounding.** Every timestamp and transcript boundary passes through
`floor(t * 1e6 + 0.5) / 1e6`. That is spelled out rather than using a built-in:
JavaScript's `Math.round` rounds a half up and Python's `round` rounds a half to
even, so the two ports would disagree on exact half-microseconds and the golden
fixtures would not match.

**Layout.** `computeOptimalGrid` searches every column count and picks the one
that maximises a single cell's area inside the square canvas without distorting
the source aspect ratio, with an 8px gutter around and between cells. Cells are
truncated to whole pixels and the packed rectangle is centred, which is where
`offsetX`/`offsetY` come from. `cell` is the exact size every frame is scaled
to. A trailing under-full sheet keeps the full layout: its missing cells stay
background, they are not reflowed.

**Watermarks.** Each cell carries the timestamp (`top-left`) and the frame index
(`top-right`), inset 4px, at `fontSizePx = max(8, floor(cellHeight / 16))` and
`strokeWidthPx = max(1, floor(fontSizePx / 8))`. `x` is the text's left edge for
`top-left` and its **right** edge for `top-right`: core has no font metrics, and
a canvas and Pillow measure the same string differently, so the executor
resolves the right-anchored case itself. Sheets are therefore **not byte
identical across hosts**: the contract fixes geometry and strings, not pixels.
Never compare rendered bytes between executors; compare cell rectangles,
watermark text and file names.

**Sheet windows.** With `transcript.scope` `"per-sheet"`, each sheet gets a
`transcript` window: the first starts at `startSeconds`, the last ends at
`endSeconds`, and the gap between two sheets is split at the midpoint between
the previous sheet's last frame and the next sheet's first, so every cue lands
in exactly one sheet. With `"combined"`, the plan carries a single
`combinedTranscript` over the whole range instead.

**File names.** Sheets are `grid_0001.jpg` upward, per-sheet transcripts are the
same number as `.vtt`, and a combined transcript is `transcript.vtt`. Names live
in the plan; hosts must not recompute them.

## What an executor must do

1. Decode the source and capture one image per `plan.frames` entry, in order:
   the first frame **at or after** each `timestampSeconds`. Returning fewer
   images than planned is allowed (the stream ended early); more is not.
2. Scale each captured frame to exactly `plan.cell`, preserving the display
   orientation (any container rotation already applied, so `VideoInfo.width`
   and `height` are display dimensions).
3. Per sheet, fill a `plan.canvas`-sized surface with `style.background`, then
   paste each cell's image at its `x`/`y`/`width`/`height`. A cell with no
   captured image is left as background.
4. Draw each watermark at `fontSizePx` in `style.fontFamily` with
   `style.textBaseline`, stroked in `style.textStroke` then filled with
   `style.textFill`. A canvas uses `lineWidth = 2 * strokeWidthPx`; Pillow uses
   `stroke_width = strokeWidthPx`.
5. Encode each sheet as JPEG at `plan.jpegQuality` (1-100) and name it
   `sheet.fileName`.
6. If a transcript was asked for, keep the cues overlapping each window and
   write them as WebVTT under the window's `fileName`.

**What the plan decides before a frame is decoded.** The timestamp format and the
sheet windows come from the planned frames, not the captured ones: a stream that
ends early keeps the watermark format the full range asked for, and
`generateCollages` stretches the last surviving sheet's window to
`endSeconds` so the dropped sheets' cues still land somewhere. Keyframe mode is
likewise settled before capture: `generateCollages` plans a request whose
keyframes it cannot read, or that selects none in `[startSeconds, endSeconds]`,
as a sampled one instead and reports a warning, where `buildRenderPlan` on its
own throws.

`packages/core`'s `paintSheetFromPlan` implements steps 3 and 4 for any
JavaScript host (`fixtures/render-plans/` pins steps 1-6's inputs), and
`generateCollages` drives the whole sequence through the ports in
[`pipeline/ports.ts`](../packages/core/src/pipeline/ports.ts).

**One documented deviation.** The browser's `<video>` fallback (used when
WebCodecs or the ISO-BMFF demuxer cannot handle the file) sets `currentTime`,
which seeks to the _nearest_ frame rather than the first frame at or after the
timestamp. The WebCodecs path and the Python executor both implement the
at-or-after rule.

## Changing the planner

A planner change is not done until the fixtures move with it: run
`npm run fixtures` in the same PR, and CI's `git diff --exit-code fixtures/`
will fail if they drift.
