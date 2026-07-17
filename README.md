<p align="center">
  <img src="docs/images/logo.png" alt="vid2grid logo" width="180">
</p>

# vid2grid

[![Deploy to GitHub Pages](https://github.com/IanHeinrich/vid2grid/actions/workflows/pages.yml/badge.svg)](https://github.com/IanHeinrich/vid2grid/actions/workflows/pages.yml)

Parse a video into a grid of frames, smartly optimising the layout of each frame into one or more grid image files, with timestamps and order. Customise the number of frames per grid, output resolution of final images and more!

Runs entirely in your browser — your video is never uploaded anywhere.

### [ianheinrich.github.io/vid2grid](https://ianheinrich.github.io/vid2grid/)

## Screenshots

The grid packing adapts to the source video's aspect ratio — landscape and
portrait clips each get a layout that maximises every frame's size within the
square sheet:

| Vertical (portrait) source | Horizontal (landscape) source |
| :---: | :---: |
| <img src="docs/images/ui-horizontal-video.png" alt="vid2grid generating grids from a landscape video" width="460"> | <img src="docs/images/ui-vertical-video.png" alt="vid2grid generating grids from a portrait video" width="460"> |

Click any collage in the gallery to view it full-size, with a timestamp and
frame index burned into every cell:

<p align="center">
  <img src="docs/images/example-grid.png" alt="A single collage sheet with per-frame timestamps and indices" width="440">
</p>

## What it does

vid2grid turns a video into one or more **collage sheets** — square grid images
packing many timestamped frames into a single file — sized and shaped for
feeding into AI vision models (OpenAI, Gemini, Claude, Grok, Venice.ai, etc.)
instead of uploading hundreds of individual frames.

- **Time & rate control**: pick a start/end time range and a target sampling
  rate (frames per second).
- **Optimal grid packing**: for a given "frames per grid" count and output
  resolution, it searches every possible row/column split and picks the one
  that maximises each individual frame's size within the square canvas,
  without distorting its aspect ratio.
- **Blank-cell suggestions**: as you tweak the time range, sampling rate, and
  frames-per-grid, the sidebar suggests nearby frames-per-grid values that
  divide the sampled frame count evenly, so the trailing sheet doesn't end up
  with wasted black filler cells.
- **Watermarking**: every frame gets a timestamp (top-left) and its global
  frame index (top-right) burned in — black text with a white stroke, sized
  relative to that frame's actual rendered resolution in the grid.
- **Clean padding**: a black gutter separates every cell (and the outer edge),
  and any left-over cells in a trailing, under-full sheet are filled solid
  black rather than left blank or reflowed into a different layout.
- **Model-aware sizing**: a quick-select in the sidebar sets the output
  resolution just below the known image-input ceiling of popular vision
  models/services, or you can enter a custom resolution.
- Results are shown in a gallery (click any collage to view it full-size) and
  downloadable as a single `.zip` of JPEGs at a configurable quality.

## How it works

Everything runs client-side via the `<video>`/`<canvas>` (and, where
supported, WebCodecs) APIs — no server, no upload. See [web/](web/) for the
full source:

1. [web/src/frameExtraction.ts](web/src/frameExtraction.ts) picks the fastest
   available extraction strategy: for supported browsers and ISO-BMFF files
   (mp4/mov/m4v) it demuxes the file with mp4box.js and decodes the wanted
   sample range in one pass with a WebCodecs `VideoDecoder`
   ([web/src/webcodecsExtractor.ts](web/src/webcodecsExtractor.ts)); otherwise
   it falls back to [web/src/extractor.ts](web/src/extractor.ts), which seeks
   an in-memory `<video>` element to a fixed time-step between the requested
   start/end time and draws each sampled frame to an offscreen `<canvas>`.
   Either way, frames are captured directly at their final collage cell size.
2. [web/src/gridMaths.ts](web/src/gridMaths.ts) computes the optimal
   `(rows, cols, cell size)` layout once per batch, from the requested frames
   per collage and the source frame's aspect ratio.
3. [web/src/renderer.ts](web/src/renderer.ts) resizes each sampled frame to
   its final cell size, draws the timestamp/frame-index watermark at that
   resolution, and pastes every cell onto a black canvas with gutters —
   repeating for as many collage sheets as the extracted frames require.
4. [web/src/core.ts](web/src/core.ts) is the facade (`generateCollages`)
   tying the above together, returning in-memory `HTMLCanvasElement`s that
   [web/src/main.ts](web/src/main.ts) JPEG-encodes and renders into the
   gallery / zips up for download.

## Use it

- **Hosted**: **[ianheinrich.github.io/vid2grid](https://ianheinrich.github.io/vid2grid/)** — no install required.
- **Locally**: see [Development](#development) below for setup.

### Known limitations

- No native-FPS clamping: browsers don't expose a video's native frame rate,
  so sampling is purely time-based (`video.currentTime` seeks to the nearest
  frame). Requesting a `targetFps` higher than the source can still produce
  duplicate frames.

## Development

`web/` is the only app in this repo (a plain Vite + TypeScript project, no
framework). All commands below are run from that directory.

```bash
git clone https://github.com/IanHeinrich/vid2grid.git
cd vid2grid/web
npm install
```

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server with hot reload. |
| `npm test` | Run the vitest suite (jsdom + vitest-canvas-mock; see [web/tests](web/tests)). |
| `npm run build` | Type-check (`tsc -b`) and produce a production build in `web/dist`. |
| `npm run preview` | Serve the `web/dist` production build locally. |

There's no separate lint step — `npm run build`'s `tsc -b` is the type-check
gate, and `npm test` is the correctness gate. Both should pass before opening
a PR.

The [pages.yml](.github/workflows/pages.yml) workflow runs `npm test` on
every push/PR touching `web/**`, and — only on `main`, and only when
`web/package.json`'s `version` has changed to a value with no existing
`vX.Y.Z` git tag — tags the release, publishes a GitHub Release, and deploys
`web/dist` to GitHub Pages.

## Contributing

Contributions are welcome — bug reports, feature ideas, and PRs. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and merge requirements.

