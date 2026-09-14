# vid2grid (Python)

Turns a video into "collage sheets": grid JPEGs packing many timestamped frames
into one image, sized for feeding into AI vision models. This is the headless
executor of the same `RenderPlan` contract the browser app uses. The planner is
a line-by-line port of `packages/core`, pinned to the repo's
`fixtures/render-plans/` goldens. PyAV decodes, Pillow paints. No transcription.

```
pip install git+https://github.com/IanHeinrich/vid2grid#subdirectory=python
```

```python
from vid2grid import probe, render_single_sheet, render_sheets, CollageRequest

info = probe("clip.mp4")
result = render_single_sheet("clip.mp4", out_path="sheet.jpg", frames=16)
print(result.sheet_path, result.frame_count, result.timings_ms)

request = CollageRequest(
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

Development, from this directory:

```
uv sync --all-groups && uv run pytest && uv run ruff check . && uv run ruff format --check .
```
