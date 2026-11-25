# The RenderPlan contract

A **RenderPlan** is plain JSON that says exactly how to turn one video into
collage sheets: which timestamps to capture, what size to scale each frame to,
where every frame goes on every sheet, what text to burn into it, and what to
call the output files.

`packages/core` is the only place that decides any of it
([`plan/buildRenderPlan.ts`](../packages/core/src/plan/buildRenderPlan.ts),
typed in [`plan/renderPlan.ts`](../packages/core/src/plan/renderPlan.ts)). An
**executor** (the browser one in `packages/browser`, the Node.js one in
`apps/node-library`, the Python one in `apps/python-library`) only decodes,
scales, pastes, draws text and encodes. That keeps the policy in one
implementation and one set of tests, whatever language the host is written
in: the Python library does not port the planner, it runs core's own code
(see [Hosts without JavaScript](#hosts-without-javascript)).
[adding-a-host.md](adding-a-host.md) is the short guide to writing a new
executor and proving it conforms.

```
CollagePlanRequest + VideoInfo  ->  buildRenderPlan  ->  RenderPlan  ->  executor  ->  JPEG sheets (+ .vtt)
```

`RENDER_PLAN_VERSION` is `2`, the newest version core plans; `plan.version`
carries the version a plan needs so an executor can refuse a plan it does not
understand. A plan with a `crop` is version `2`, because an executor that
ignored the crop would squash the whole picture into a cell shaped for part of
it. Every other plan is version `1` (`UNCROPPED_PLAN_VERSION`), unchanged, so an
executor that only knows version `1` still renders it. An executor that checks
accepts any version up to the newest it knows, never just the one equal to it.

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
Explicit times (`timestampsSeconds`) take exactly the times listed, rounded to
microseconds, sorted and with repeats dropped. `startSeconds` and `endSeconds`
play no part in choosing those frames: they still bound what is transcribed, and
`requestFromOptions` defaults them to the whole video, which covers any valid
time. The list must not be empty, every time must be a finite number from 0, and
it cannot be combined with `keyframeSampling`, `frameCount` or `maxKeyframes`.
A time at or past `durationSeconds` is rejected rather than dropped, even in a
file whose stream starts after zero, where frames can lie past that point. All
of these are `invalid_request`. A time before `durationSeconds` can still come
after the last frame starts, and then has no frame to take. Core cannot know
that when planning, so `generateCollages`, `streamCollages` and the Python
library's `render_sheets` report a `no_frame_at_timestamps` warning naming every
explicit time the capture returned no image for. A sampled plan that ends early
gets no such warning.
`frameIndex` is 0-based across the whole export, so it keeps counting up across
sheets. `targetFps` still matters in keyframe mode and with explicit times: the
burned-in timestamp shows milliseconds when it is above 1, and also when any
explicit time is not a whole second to the nearest millisecond.

**Microsecond rounding.** Every timestamp and transcript boundary passes through
`floor(t * 1e6 + 0.5) / 1e6`. That is spelled out rather than using a built-in:
JavaScript's `Math.round` rounds a half up and Python's `round` rounds a half to
even, so a host that matches decoded frame times against the plan in its own
language must use this rule too, or it would disagree on exact
half-microseconds.

**Area.** With `area`, only part of the picture is rendered. Its `left`, `top`,
`right` and `bottom` are thousandths of the picture as displayed, from its top
left: each from `0` to `1000`, `left` less than `right` and `top` less than
`bottom`, anything else being `invalid_request`. Core turns it into `plan.crop`,
in whole pixels of a picture `sourceWidth` by `sourceHeight`, which are the
`VideoInfo`'s `width` and `height`. Each side goes to its nearest pixel with
JavaScript's `Math.round`, and a crop is always at least one pixel, inside the
picture. Cells then take the crop's aspect ratio in place of the picture's. An
area so thin that a cell would have no width or no height is `invalid_request`.
A plan without an `area` has no `crop` field.

```json
"crop": { "x": 192, "y": 216, "width": 576, "height": 324, "sourceWidth": 1920, "sourceHeight": 1080 }
```

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
in exactly one sheet. An explicit time outside the range moves that first start
or last end out to itself. With `"combined"`, the plan carries a single
`combinedTranscript` over the whole range instead.

**File names.** Sheets are `grid_0001.jpg` upward, per-sheet transcripts are the
same number as `.vtt`, and a combined transcript is `transcript.vtt`. Names live
in the plan; hosts must not recompute them.

## What an executor must do

1. Decode the source and capture one image per `plan.frames` entry, in order:
   the first frame **at or after** each `timestampSeconds`. The frame's time
   and the planned time are both rounded to microseconds with
   `floor(t * 1e6 + 0.5) / 1e6` before they are compared. A frame whose time
   is not a finite number (no pts) fills no planned frame. Returning fewer
   images than planned is allowed (the stream ended early); more is not.
2. Turn each captured frame clockwise by the video's display rotation (0, 90,
   180 or 270; `normalizeRotationClockwise` converts the counter-clockwise
   value ffmpeg reports) and scale it to exactly `plan.cell`.
   `VideoInfo.width` and `height` are display dimensions, so the cell is
   display-oriented. With a `plan.crop`, scale the turned frame to
   `sourceWidth` by `sourceHeight` first (a no-op unless its pixels are not
   square), cut out the crop's rectangle and scale that to `plan.cell`. A
   subsampled pixel format must become RGB before the cut, or an odd edge lands
   between its chroma samples. Scaling the cut must take nothing from outside
   it, so the neighbouring pixels never show at a cell's edge.
3. Per sheet, run core's `sheetDrawOps(plan, sheetIndex)` on a
   `plan.canvas`-sized surface, in order. It returns a `fillRect` with
   `style.background` over the whole canvas, then for each cell an `image` op
   (paste that cell's captured image at its `x`/`y`, already `width` by
   `height`) followed by its `text` ops. A cell with no captured image is left
   as background: skip its `image` op and its `text` ops, which carry the same
   `cellIndex`.
4. Draw each `text` op at `fontSizePx` in `fontFamily` with `baseline`,
   anchored at its `anchor` corner, stroked in `stroke` then filled with
   `fill`. Pillow uses `stroke_width = strokeWidthPx`; a canvas uses
   `lineWidth = 2 * strokeWidthPx`. Pillow cannot resolve a CSS generic family
   like `sans-serif`, so the Python library draws with Pillow's bundled
   default font.
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
JavaScript host by running the same draw ops on a canvas
(`fixtures/render-plans/` pins steps 1-6's inputs, `fixtures/draw-ops/` step
3's ops, and `fixtures/frames/` step 1's choice of source frame), and
`generateCollages` drives the whole sequence through the ports in
[`pipeline/ports.ts`](../packages/core/src/pipeline/ports.ts) as a stream: the
capture port yields frames in plan order, each sheet starts encoding as soon as
its cells are captured, and up to the encoder's `concurrency` sheets encode at
once, so memory stays at the sheets in flight whatever the video's length. The
browser's WebCodecs capture adds its own bounds: it reads the file in ranges and
skips what no planned frame needs. The Node capture seeks past long gaps between
planned frames. Neither changes the order of the frames, or, apart from the
known limitations below, which are picked. Step 1's rule is core's too:
`createFrameMatcher` decides which planned frames each decoded frame fills, and
`isKeyframePlan` decides when a capture may decode keyframes alone. The capture
port receives the `VideoInfo` the plan was built from for that decision.

**One documented deviation.** The browser's `<video>` fallback (used when
WebCodecs or the ISO-BMFF demuxer cannot handle the file) sets `currentTime`,
which seeks to the _nearest_ frame rather than the first frame at or after the
timestamp. The browser's WebCodecs path and the Node executor match frames with
`createFrameMatcher` and decide keyframe decodes with `isKeyframePlan`; the
Python executor calls `isKeyframePlan` through the embedded core and applies
the same at-or-after rule in its own per-frame loop.

**Known limitations.** A container whose seek lands after the target, as
ffmpeg's MPEG-TS demuxer can, makes the hosts that seek through ffmpeg pick
frames late, because the frames before the landing point are never decoded. In
Node this reaches only a plan's first frames: it checks every later seek, and
decodes through from the first when one lands late. When a seeking ffmpeg
crashes, Node decodes the rest of the plan from the start of the file.

A file whose timestamps are out of order, such as an MP4 made by joining clips
with B-frames with `concat -c copy`, can give Node a frame one off from the one
a full decode picks. ffmpeg swaps pts for dts partway through such a file, and
a decode that starts after that point has not swapped.

## Hosts without JavaScript

A host in another language embeds core rather than porting it.
`npm run bundle` builds [`embed.ts`](../packages/core/src/embed.ts) into one
script, `apps/python-library/src/vid2grid/_core.js`, that defines a global
`vid2gridCore` with a single function, `call(name, argsJson)`. `argsJson` is
a JSON array of positional arguments in the camelCase shapes above, and the
result is a JSON envelope: `{"ok": true, "value": ...}`, or
`{"ok": false, "code": ..., "message": ...}` where `code` is
`invalid_request`, `no_audio`, `undecodable_audio`, `no_frames` or `internal`.
`undecodable_audio` means the video has an audio track the host cannot decode;
the bundle itself never returns it. The functions are
`buildRenderPlan`, `collagePlanRequestProblem`,
`validateCollagePlanRequest`, `sheetDrawOps`, `resolveKeyframeSampling` (the
sampled fallback and its warning, as `generateCollages` applies it),
`missingTimestampsWarning` (a request, a plan or an object holding just its
`frames`, and how many images were captured, to the warning above or `null`),
`displaySize`, `normalizeRotationClockwise`, `isKeyframePlan` (a plan, or an
object holding just its `frames`, and the keyframe times, to whether a capture
may decode keyframes alone), `optionSpecs` (the options a CLI or tool exposes
for the host capabilities it passes, with their flags and defaults),
`requestFromOptions` (option values, a `VideoInfo` and the same capabilities to
a request, defaults filled in), `cuesFromSegments` (a speech model's segments
to transcript cues), `transcriptFiles` (the plan, the rendered sheet count, the
end time and the cues to each `.vtt` file's name and text),
`transcriptionFailedWarning`, `noTranscriptionPortWarning`, `gridsFolderName`
(a video's file name and an ISO time to the web app's download folder name)
and `version`. An optional request or info field (`frameCount`,
`keyframeTimestampsSeconds` and the like) is left out when unset, never sent as
`null`, and so are `resolveKeyframeSampling`'s optional third argument, the
reason keyframes could not be read, and `isKeyframePlan`'s keyframe times when
there are none. The one `null` is `displaySize`'s third argument, which every
call passes: `null` for a video with no sample aspect ratio, an object with
`numerator` and `denominator` otherwise.

`apps/python-library` loads that script once per process into an embedded V8
(`mini-racer`) and maps each error code to its own exception class, so its
plans are core's plans by construction. It checks that against every fixture
in `apps/python-library/tests/test_planner.py`.

## Changing the planner

A planner change is not done until the generated files move with it: run
`npm run fixtures` (the plan and draw-op goldens) and `npm run bundle` in the
same PR, and CI's `git diff --exit-code` over `fixtures/` and
`apps/python-library/src/vid2grid/_core.js` will fail if either drifts. If it
moves planned times, rerecord the frame goldens too, as
[adding-a-host.md](adding-a-host.md#proving-conformance) describes.
