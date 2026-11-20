# Architecture

vid2grid turns a video into collage sheets: grid JPEGs that pack many
timestamped frames into one image. It runs in a browser, from Python, from
Node.js, on the command line and as an MCP server. All of these produce the
same sheets because one piece of code makes every decision and the rest only
move pixels.

This page is the map. [render-plan.md](render-plan.md) is the contract's spec,
and [adding-a-host.md](adding-a-host.md) is the guide to writing a new
executor.

## Three layers

```
packages/core            the planner: decides everything, touches no media
     |
     |  RenderPlan (plain JSON) and the ports an executor fills
     v
executors                probe, capture, draw, encode
  packages/browser         <video>/<canvas>, WebCodecs, workers, Whisper
  apps/node-library        ffprobe/ffmpeg, @napi-rs/canvas
  apps/python-library      PyAV, Pillow, core embedded in mini-racer
     |
     v
entry points             what a person or program actually runs
  apps/web                 the website, on packages/browser
  apps/node-cli            vid2grid-node, on apps/node-library
  apps/python-cli          vid2grid, on apps/python-library
  apps/mcp-server          vid2grid-mcp, on apps/python-library
  apps/chat                the chat app, on packages/browser
```

`apps/node-library` and `apps/python-library` are entry points too: other code
can import them directly.

## Where things live

| Folder                | Package              | Role                                                                   |
| --------------------- | -------------------- | ---------------------------------------------------------------------- |
| `packages/core`       | `@vid2grid/core`     | The planner. DOM-free, no dependencies.                                |
| `packages/browser`    | `@vid2grid/browser`  | The browser executor.                                                  |
| `apps/web`            | `vid2grid-web`       | The Vite website. Its `package.json` version is the release key.       |
| `apps/chat`           | `vid2grid-chat`      | The chat app: a vision model with tools over a video. Own release key. |
| `apps/node-library`   | `@vid2grid/node`     | The Node.js executor and its conformance test.                         |
| `apps/node-cli`       | `@vid2grid/node-cli` | The `vid2grid-node` command.                                           |
| `apps/python-library` | `vid2grid`           | The Python executor, with the bundled core in `src/vid2grid/_core.js`. |
| `apps/python-cli`     | `vid2grid-cli`       | The `vid2grid` command.                                                |
| `apps/mcp-server`     | `vid2grid-mcp`       | An MCP server whose tools plan and render a local video.               |
| `fixtures/`           |                      | Golden plans, draw ops and frame selections, plus the two test videos. |
| `scripts/`            |                      | The fixture generator, the core bundler and the frame recorders.       |

`packages/` holds building blocks that are never installed on their own.
`apps/` holds every way to use vid2grid.

## Core and the RenderPlan

`packages/core` takes a `CollagePlanRequest` (what the user asked for) and a
`VideoInfo` (what the probe found) and builds a `RenderPlan`: which timestamps
to capture, the cell size, where each frame sits on each sheet, the text burned
into it, the JPEG quality and the file names. `sheetDrawOps` turns one sheet of
that plan into an ordered list of draw operations. `OPTION_SPECS` lists every
option a CLI or tool can expose, so the flags are the same in every entry
point.

Core compiles with `lib: ["ES2022"]` and `types: []`, so any browser or Node
API is a compile error, and it has no `dependencies`. That is what lets every
executor run it.

The plan's shape and rules are in [render-plan.md](render-plan.md).

## Executors

An executor does the four things core cannot do without touching media: probe
the video, capture the planned frames, run the draw ops on a surface, and
encode JPEGs. Core names these as ports in
[`pipeline/ports.ts`](../packages/core/src/pipeline/ports.ts).

The JavaScript executors (`packages/browser`, `apps/node-library`) implement
those ports and call core's `generateCollages` or `streamCollages`, which drive
the whole sequence. The browser and Python executors can also transcribe the
audio; the Node one cannot.

Audio analysis follows the same split, outside the RenderPlan contract. Core's
`analyseAudio` (in `packages/core/src/audio/`) is DOM-free: it cuts the audio
into windows, merges the scores, measures loudness and repetition, and builds
the text lines a model reads. A label line is `name` or
`name: wording; wording`, which `parseSoundLabel` splits so several wordings
report as one name. Core reaches the audio only through
`AudioAnalysisPorts`: `decode`, `scoreWindows` and an optional `transcribe`.
`scoreWindows` gets each label's wordings and returns one logit per label per
window. `packages/browser/src/audio/` supplies the ports as
`createBrowserAudioPorts`, with a zero-shot sound classifier worker that
averages a label's wordings into one text embedding, and the Whisper worker for
speech. For analysis Whisper hears five second pieces without timestamps, one
cue per piece, skipping near-silent ones; the website's transcript keeps the
timestamped decode. A cue that is a single tag such as `(laughter)` is listed
as a sound rather than speech.
`packages/browser/src/capture/mp4AudioDecoder.ts` decodes just the requested
range of an MP4 or MOV, and other formats fall back to decoding the whole
file. A Node or Python host can reuse the orchestration by supplying the same
three ports. A track the browser cannot decode raises `undecodable_audio`.

The browser probe's `readFrameTimes` returns every frame's presentation time,
corrected for the edit list, for callers that need to step between real frames
rather than guess from the frame rate.

`apps/python-library` cannot import TypeScript, so it runs core's own code
instead of porting it. `npm run bundle` builds
[`embed.ts`](../packages/core/src/embed.ts) into one script,
`apps/python-library/src/vid2grid/_core.js`, which the library loads into an
embedded V8 (`mini-racer`) and calls through `_core.py`. There is no Python
planner to keep in sync. The bundle is generated and checked into the repo;
never edit it by hand. The library's `options.py` holds `plan_from_options` and
`render_from_options`, which the Python CLI and the MCP server both call.

## Entry points

An entry point turns its own input into a request and hands it to one
executor. It holds no planning or rendering logic of its own. The CLIs and the
MCP server take their options from `OPTION_SPECS`.

- `apps/web` wires the markup in `index.html` to the browser executor.
- `apps/chat` is a chat app served at `/chat/` on the website's Pages site.
  It calls a model's API straight from the page and uses `@vid2grid/core` and
  `@vid2grid/browser` as a library to render sheets, with no planning of its
  own. CI's `test` job builds it on every push and PR, so a break shows up
  before a release.
- `apps/node-cli` is bundled by Vite with core inlined and `@vid2grid/node`
  kept external, so build `apps/node-library` before running it.
- `apps/python-cli` and `apps/mcp-server` depend on `vid2grid` through a git
  reference, and `[tool.uv.sources]` points that at `../python-library`. Local
  work and `uvx --from git+...` both use the library from the same commit.

## Goldens keep every executor honest

Rendered JPEGs are never compared across executors, because a canvas and
Pillow rasterise text differently. What is compared is host independent:

- `fixtures/render-plans/`: the plan core builds for each request and video
  info. `apps/python-library/tests/test_planner.py` runs them through the
  bundle.
- `fixtures/draw-ops/`: the draw ops for each of those plans.
- `fixtures/frames/`: which source frame the capture rule picks for each
  planned time, over the videos in `fixtures/videos/`.

`npm run fixtures` writes the first two from core, and CI fails if they drift.
The frame goldens come from a real decode and are recorded by hand. The Node
and Python executors each have a conformance test against them:
[`apps/node-library/tests/conformance.test.ts`](../apps/node-library/tests/conformance.test.ts)
and
[`apps/python-library/tests/test_conformance.py`](../apps/python-library/tests/test_conformance.py).
[adding-a-host.md](adding-a-host.md#proving-conformance) has the details.

## Toolchains

The repo root is an npm workspaces monorepo over `packages/*`, `apps/web`,
`apps/chat`, `apps/node-library` and `apps/node-cli`. Every npm command runs from the root.

The three Python apps have no `package.json`. Each is its own uv project, with
its own `pyproject.toml`, checked from its own folder:

```
uv sync --all-groups
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy
```

CI in [`pages.yml`](../.github/workflows/pages.yml) runs the root npm checks,
a build of the website and the chat app, and the fixture and bundle diffs
(`test`), the Python library on three OSes and
Python 3.11 to 3.13 (`python-library`), the Python CLI and MCP server
(`python-apps`), and both Node apps on Windows and macOS (`node`).

The same workflow releases and deploys. The website and the chat app share one
GitHub Pages site, the website at the root and the chat app at `/chat/`, but
each has its own release key: a new `version` in `apps/web/package.json` on
`main` tags `vX.Y.Z`, and one in `apps/chat/package.json` tags `chat-vX.Y.Z`
(`0.0.0` never releases). Either release triggers a deploy, and since a deploy
replaces the whole site,
[`scripts/buildPagesSite.sh`](../scripts/buildPagesSite.sh) builds each app
from its own release: the one releasing from this commit, the other from its
latest tag. That way neither release ships the other app's unreleased changes.
The script handles both the workspace layout and the older `web/` layout of
tags from before the monorepo.
