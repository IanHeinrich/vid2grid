# vid2grid (Python library)

The Python package `vid2grid`: turns a video into collage sheets, grid JPEGs
packing many timestamped frames, without a browser. PyAV decodes, Pillow
paints, and faster-whisper transcribes when the `transcribe` extra is
installed. The [command line](../python-cli/) and the
[MCP server](../mcp-server/) are built on it.

It has no planner of its own. `src/vid2grid/_core.js` is
[packages/core](../../packages/core/) bundled by `npm run bundle` (generated,
never edited by hand), and it runs in an embedded V8 through `mini-racer`.
Every plan, validation message and warning comes from core itself, so sheets
match the website's geometry and burned-in text: same cells, same timestamps,
same `grid_0001.jpg` file names. They do not match its bytes, because a canvas
and Pillow rasterise text differently.

## Install

It is not on a package index, so every install names the git URL:

```bash
pip install "git+https://github.com/IanHeinrich/vid2grid#subdirectory=apps/python-library"
```

With transcripts:

```bash
pip install "vid2grid[transcribe] @ git+https://github.com/IanHeinrich/vid2grid#subdirectory=apps/python-library"
```

It needs Python 3.11 or later and depends on `av`, `Pillow` and `mini-racer`.
`mini-racer` ships wheels for Linux (manylinux 2.27+ and musllinux), macOS and
Windows, each on x64 and arm64; anywhere else pip builds it from source.

## Usage

### From options

The simplest entry point takes options keyed by core's camelCase names, the
same ones the command line and MCP server take. A missing option, or `None`,
gets core's default.

```python
from vid2grid import plan_from_options, render_from_options

planned = plan_from_options("clip.mp4", {"targetFps": 2, "framesPerGrid": 16})
print(len(planned.plan.sheets), planned.warnings)

result = render_from_options("clip.mp4", "sheets", {"targetFps": 2, "framesPerGrid": 16})
for sheet in result.sheets:
    print(sheet.path, sheet.first_timestamp_seconds, sheet.last_timestamp_seconds)
```

- `plan_from_options(path, values)` probes the video and returns a
  `PlanResult` with the `RenderPlan` and its `warnings`, without decoding a
  frame.
- `render_from_options(path, out_dir, values)` probes, plans and writes the
  sheets and any transcript, returning a `RenderResult`. An `out_dir` of
  `None` means `default_out_dir(path)`, a new folder beside the video named
  the way the website names its download.
- `option_specs(host_capabilities())` lists every option this install can
  honour, with its `name`, `flag`, `type`, `default` and `help`.
  `host_capabilities()` is `("transcription",)` when the `transcribe` extra is
  installed and `()` otherwise, so `transcript` is offered only when it can be
  done.

The options are `startSeconds`, `endSeconds`, `targetFps`, `framesPerGrid`,
`outputResolution`, `jpegQuality`, `keyframeSampling`, `maxKeyframes`,
`frameCount` and, with the extra, `transcript` (`"none"`, `"per-sheet"` or
`"combined"`). An unknown name, a value of the wrong type or a `transcript`
without the extra raises `InvalidRequestError`.

When keyframe sampling is asked for but the keyframes cannot be read, or none
fall in the range, the plan samples by target FPS instead and a warning says
so.

### With a request

`render_sheets` takes a full `CollagePlanRequest`:

```python
from vid2grid import CollagePlanRequest, probe_video, render_sheets

info = probe_video("clip.mp4")
request = CollagePlanRequest(
    start_seconds=0.0,
    end_seconds=info.duration_seconds,
    target_fps=1.0,
    frames_per_grid=16,
    output_resolution=1024,
    jpeg_quality=85,
)
batch = render_sheets("clip.mp4", request, "sheets/")
```

### One sheet

`render_single_sheet` puts an exact number of frames on one sheet. Its
defaults (16 frames, 1024 px, quality 85) are its own.

```python
from vid2grid import render_single_sheet

result = render_single_sheet("clip.mp4", out_path="sheet.jpg", frames=16)
print(result.to_sheet_row())
```

### Results

`RenderResult.sheets` holds a `WrittenSheet` per sheet written, with its
`path` and the `first_timestamp_seconds` and `last_timestamp_seconds` of the
frames actually captured on it. Those can differ from the plan, because a
stream that ends early cuts the last sheet short. `RenderResult.to_dict()` is
the JSON the command line's `--json` prints and the MCP server returns:

```json
{
  "sheets": [{ "path": "...", "firstTimestampSeconds": 0, "lastTimestampSeconds": 8 }],
  "transcriptPaths": [],
  "warnings": [],
  "frameCount": 9,
  "timingsMs": { "extracting": 0, "rendering": 0 },
  "vid2gridVersion": "..."
}
```

`timingsMs` gains `transcribing` when a transcript was made.
`PlanResult.to_dict()` is `{"plan": ..., "warnings": [...]}`.

### Errors

Every error is a `Vid2GridError` with a `code`. A missing video, or a file
with no video stream, raises `InvalidRequestError`; one PyAV cannot read
raises `InternalError`; a range with no capturable frames raises
`NoFramesError`, which is also a `ValueError`.

## Transcription

With the `transcribe` extra, a request whose `transcript` is `"per-sheet"`
writes one `.vtt` per sheet and `"combined"` writes a single
`transcript.vtt`. Cue times are on the video's timeline, matching the
timestamps on the sheets.

`render_from_options` uses `WhisperTranscriber()` unless you pass
`transcriber=`. `render_sheets` takes `transcriber=` too. A transcriber is any
callable taking the path and the start and end seconds and returning
`TranscriptCue`s.
`WhisperTranscriber(model="tiny.en", device="cpu", compute_type="int8")` is the
one this package ships. Its model downloads on first use and stays loaded for
later calls. A video with no audio track, or a transcriber that raises, leaves
the sheets in place and adds a warning.

## Development

From `apps/python-library/`:

```bash
uv sync --all-groups
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy
```

`tests/test_transcribe.py` has one test against a real Whisper model, skipped
unless `VID2GRID_WHISPER_TEST=1` is set.

`tests/test_planner.py` runs every golden plan in
[fixtures/render-plans/](../../fixtures/render-plans/) through the bundled
core, and `tests/test_conformance.py` holds the package to core's draw ops and
to the frame choices recorded in [fixtures/frames/](../../fixtures/frames/).
After a change to how frames are picked, re-record those from this folder:

```bash
uv run python ../../scripts/recordFrameFixtures.py
```

A change to core reaches this package only through the bundle: run
`npm run bundle` from the repo root.

The modules are named after the ports they implement: `probe.py` reads a
video's `VideoInfo`, `capture.py` decodes the planned frames, `render.py`
paints a sheet by running core's draw ops with Pillow, and `sheets.py` runs
them in turn, one sheet at a time.
