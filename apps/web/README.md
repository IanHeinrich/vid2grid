# vid2grid website

The site at
**[ianheinrich.github.io/vid2grid](https://ianheinrich.github.io/vid2grid/)**.
It turns a video into collage sheets entirely in the browser: nothing is
uploaded and there is no server. Plain TypeScript and Vite, no framework.

## What it does

- Drop a video on the sidebar, then set the start and end with a timeline
  slider whose handles preview the exact frame.
- Pick a sampling rate and frames per sheet. The sidebar suggests nearby
  frames-per-sheet values that divide the frame count evenly, so the last
  sheet has no empty cells.
- A model quick-select sets the sheet size just below the image limit of
  popular vision models, or you enter your own.
- Keyframe fast mode decodes only the video's keyframes for a near-instant
  preview, at the cost of exact frame timing.
- Generate transcript runs a Whisper model in the browser and writes WebVTT
  files: one per sheet (`grid_0001.vtt` beside `grid_0001.jpg`) or one
  combined `transcript.vtt`. Cue times match the timestamps on the sheets.
- Sheets appear in a gallery and download as a `.zip` or save to a folder.

## Run, build, test

From the repo root:

```bash
npm ci
npm run dev
npm run build
npm run preview --workspace apps/web
npm test --workspace apps/web
```

`npm run build` type-checks every package, then writes the site to
`apps/web/dist`.

## Where the code lives

- [index.html](index.html) holds all the markup.
- [src/main.ts](src/main.ts) wires that markup to the modules in [src/](src/)
  and the panels in [src/ui/](src/ui/).
- [packages/browser](../../packages/browser/) does the work: WebCodecs and
  mp4box decoding with a `<video>` fallback, a pool of workers painting on
  `OffscreenCanvas`, and the transformers.js Whisper worker.
- [packages/core](../../packages/core/) plans the sheets, the same planner
  every other way of using vid2grid runs.
- Tests are in [tests/](tests/).

## Limitations

- Browsers do not expose a video's frame rate, so sampling is by time. A
  sampling rate above the source's gives duplicate frames.
- Transcripts are English-focused (`Xenova/whisper-tiny.en`). The first run
  downloads about 40 MB of model and 20 MB of runtime, which the browser then
  caches; the video itself is never sent. Without WebGPU it is noticeably
  slower. Per-sheet transcripts split speech by time and can cut a sentence
  across two sheets.

## Releases

A change to `version` in [package.json](package.json) landing on `main` tags a
release and deploys the site to GitHub Pages. That is the maintainer's call,
so a change never bumps it.
