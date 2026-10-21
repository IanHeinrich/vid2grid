# vid2grid (Python)

Turns a video into "collage sheets": grid JPEGs packing many timestamped frames
into one image, sized for feeding into AI vision models. This is the headless
executor of the same `RenderPlan` contract the browser app uses. PyAV decodes,
Pillow paints, and faster-whisper transcribes when the `transcribe` extra is
installed.

It has no planner of its own. `src/vid2grid/_core.js` is `packages/core`
bundled by `npm run bundle` (generated, never edited by hand), and `_core.py`
runs it in an embedded V8 through `mini-racer`, so every plan, every validation
message, the keyframe fallback and its warning, the display size and the draw
ops for each sheet come from core itself. `tests/test_planner.py` runs every
`fixtures/render-plans/` golden through it. It depends on `av`, `Pillow` and
`mini-racer`. `mini-racer` ships prebuilt wheels for Linux (manylinux 2.27+
and musllinux), macOS and Windows, each on x64 and arm64; anywhere else pip
builds it from source.

```
pip install git+https://github.com/IanHeinrich/vid2grid#subdirectory=python
```

It is not on a package index, so every install names the git URL. For
transcripts, add the `transcribe` extra, which brings in `faster-whisper`:

```
pip install "vid2grid[transcribe] @ git+https://github.com/IanHeinrich/vid2grid#subdirectory=python"
```

```python
from vid2grid import probe_video, render_single_sheet, render_sheets, CollagePlanRequest

info = probe_video("clip.mp4")
result = render_single_sheet("clip.mp4", out_path="sheet.jpg", frames=16)
print(result.sheet_path, result.frame_count, result.timings_ms)

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

Sheets match the web app's geometry and burned-in text exactly: same cell
rectangles, same timestamps, same `grid_0001.jpg` file names. They do not match
its bytes, because a canvas and Pillow measure and rasterise text differently,
so never compare rendered pixels between the two executors.

A CLI or tool built on this package needs three calls from `vid2grid`, all
taking option values keyed by core's camelCase option names (`None` counts as
unset):

- `option_specs(host_capabilities())` lists every option this install can
  honour, with its `name`, `flag`, `type`, `default` and `help`.
  `host_capabilities()` is `("transcription",)` when the `transcribe` extra is
  installed and `()` otherwise, so `transcript` is offered only when it can be
  done.
- `plan_from_options(path, values)` probes the video (reading its keyframes
  only when `keyframeSampling` is set) and returns a `PlanResult` holding the
  `RenderPlan` core builds and its `warnings`, without decoding a frame. When
  the keyframes cannot be read or none fall in the range, the plan samples by
  target FPS instead and the warning says so, exactly as `render_sheets` does.
  `PlanResult.to_dict()` is `{"plan": ..., "warnings": [...]}`.
- `render_from_options(path, out_dir, values)` probes, plans and writes the
  sheets and any transcript, returning a `RenderResult`. An `out_dir` of `None`
  is `default_out_dir(path)`, a new folder beside the video named as the web
  app names its download. When a transcript is asked for it uses a
  `WhisperTranscriber()` unless you pass `transcriber=`.

A missing video, or a file with no video stream, raises `InvalidRequestError`
and one PyAV cannot read raises `InternalError`, so a caller of either needs to
catch only `Vid2GridError`.

Both convert the values with `request_from_options(values, info,
host_capabilities())`, which fills in the web app's defaults and raises
`InvalidRequestError` for an unknown name, a value of the wrong type, an enum
value outside the spec's `values` and a `transcript` on an install without the
extra.
`render_single_sheet`'s defaults (16 frames, quality 85) are deliberately its
own: it is curator's single-sheet API, not the generic entry point.

`RenderResult.sheets` holds a `WrittenSheet` for each sheet written, with its
`path` and the `first_timestamp_seconds` and `last_timestamp_seconds` of the
frames actually captured on it. Those can differ from the plan, because a
stream that ends early cuts the last sheet short and drops any sheet after it.
`RenderResult.to_dict()` is the JSON both the CLI and the MCP server report, in
core's camelCase:

```
{
  "sheets": [{"path": ..., "firstTimestampSeconds": ..., "lastTimestampSeconds": ...}],
  "transcriptPaths": [...],
  "warnings": [...],
  "frameCount": ...,
  "timingsMs": {"extracting": ..., "rendering": ...},
  "vid2gridVersion": ...
}
```

`timingsMs` gains `transcribing` when a transcript was made.

`tests/test_conformance.py` holds the package to the repo's host-independent
goldens: core's draw ops for every `fixtures/render-plans/` case and the
painter running exactly those ops, and, for each `fixtures/frames/` case, the
probed info and the source frame capture picks for every planned time (read
through `capture.iter_source_frames`).

The modules are named after the host ports they implement: `probe.py` reads a
video's `VideoInfo` with `probe_video`, `capture.py` decodes the planned frames
with PyAV, `render.py` paints a sheet by running core's draw ops with Pillow and
encodes it, and `sheets.py` runs them in turn. It probes the video once (skipped
when you pass `info`), reads the keyframe times in a second pass only in
keyframe mode when the info has none, then captures and paints one sheet at a
time. `probe` is still exported as a deprecated alias of `probe_video`, and
`CollageRequest` as an alias of `CollagePlanRequest`. A range with no capturable
frames raises `NoFramesError`, a `Vid2GridError` whose `code` is `"no_frames"`
and which is still a `ValueError`. When `probe_video` cannot decode a frame to
read the display rotation, it assumes none and logs a warning on the
`vid2grid.probe` logger rather than raising a Python warning.

Transcription follows core's rules, not its own. `render_sheets` takes an
optional `transcriber`, any callable taking the path, start and end seconds and
returning `TranscriptCue`s, the same shape as core's transcript port. When
`request.transcript_scope` is set it calls it once over the request's range and
writes the `.vtt` files core's `transcriptFiles` names and fills, one per
rendered sheet or a single `transcript.vtt`, into `RenderResult.transcript_paths`.
A transcriber that raises, or a missing one, leaves the sheets in place and adds
core's warning to `RenderResult.warnings`, as `generateCollages` does.
`WhisperTranscriber(model="tiny.en", device="cpu", compute_type="int8")` is the
one this package ships: `transcribe.decode_audio` decodes the range with PyAV
to 16 kHz mono float32, raising `NoAudioError` when there is no audio stream,
and core's `cuesFromSegments` puts faster-whisper's segments back on the
video's timeline exactly as the browser does with its Whisper chunks. The model
is downloaded on first use and kept loaded for later calls.
`tests/test_transcribe.py` has one test against a real model, skipped unless
`VID2GRID_WHISPER_TEST=1` is set.

## Command line

`vid2grid VIDEO [-o OUT_DIR]` renders the sheets, and `python -m vid2grid` does
the same. Its flags are not written out in `cli.py`: they are built from
`option_specs(host_capabilities())`, so `--fps`, `--frames-per-grid` and the rest
come from core with its help text and defaults, and `--transcript` appears only
when the `transcribe` extra is installed. A flag left off is unset and core
fills in its default. Without `-o` the sheets go in a folder beside the video,
named by `default_out_dir`, which uses core's folder name as the web app does.

```
vid2grid clip.mp4 --fps 2 --frames-per-grid 16 -o sheets/
vid2grid clip.mp4 --plan-only
```

It prints one line per sheet with its path and the first and last timestamp
captured on it, then any transcript paths, and sends warnings to stderr.
`--json` prints `RenderResult.to_dict()` instead. `--plan-only` writes nothing:
it prints the `RenderPlan` as JSON and sends its warnings to stderr, or with
`--json` prints `PlanResult.to_dict()`. Either way `--json` prints the same
dict the MCP server returns for that call. A `Vid2GridError` prints
`vid2grid: <message>` to stderr and exits 2 for `invalid_request`, a missing
video among them, and 1 otherwise.

## MCP server

The `mcp` extra adds `vid2grid-mcp`, an MCP server on stdio that lets an agent
make sheets from a local video. It has two tools. `video_to_sheets` takes a
`path`, an optional `outDir` (the same `default_out_dir` as the CLI when
omitted) and every option from `option_specs(host_capabilities())` under its
camelCase name, and returns `RenderResult.to_dict()`, the same dict the CLI's
`--json` prints. `plan_video` takes the same options without `outDir` and
returns `PlanResult.to_dict()`, the `RenderPlan` with any warnings, so the sheet
count and timestamps can be checked before rendering. The tool schemas are
built from the option specs, and core checks the values, so a bad one comes
back as a tool error carrying core's message and error code.

To register it with Claude Code:

```
claude mcp add vid2grid -- uvx --from "vid2grid[mcp] @ git+https://github.com/IanHeinrich/vid2grid#subdirectory=python" vid2grid-mcp
```

Other MCP clients take the same command and arguments.

Development, from this directory:

```
uv sync --all-groups && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```
