# vid2grid (Python)

Turns a video into "collage sheets": grid JPEGs packing many timestamped frames
into one image, sized for feeding into AI vision models. This is the headless
executor of the same `RenderPlan` contract the browser app uses. PyAV decodes,
Pillow paints. No transcription.

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

A CLI or tool built on this package takes its flags and defaults from core:
`vid2grid.option_specs()` lists every option with its camelCase `name`, `flag`,
`type`, `default` and `help`, and `request_from_options(values, info)`
turns the values given (keyed by `name`; `None` counts as unset) into a
`CollagePlanRequest` with the web app's defaults filled in. Both take an
optional `capabilities` argument for what the host can do. This package has no
transcription, so it passes none: `transcript` is never offered, and
`request_from_options` raises `InvalidRequestError` for it, for any other
unknown name, for a value of the wrong type and for an enum value outside the
spec's `values`.
`render_single_sheet`'s defaults (16 frames, quality 85) are deliberately its
own: it is curator's single-sheet API, not the generic entry point.

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

Development, from this directory:

```
uv sync --all-groups && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```
