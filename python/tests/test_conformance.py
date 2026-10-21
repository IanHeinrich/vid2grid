from pathlib import Path
from typing import Any

import pytest
from helpers import fixture_paths, read_fixture, repo_root
from PIL import Image, ImageDraw, ImageFont

from vid2grid import _core, build_render_plan, render
from vid2grid.capture import iter_source_frames
from vid2grid.contract import CollagePlanRequest, RenderPlan
from vid2grid.probe import probe_video, round_to_microseconds

_REAL_DRAW = ImageDraw.Draw
_REAL_PASTE = Image.Image.paste
_ANCHOR_NAMES = {"la": "top-left", "ra": "top-right"}
# The painter has no use for these: Pillow has one baseline and no CSS font families.
_UNPAINTED_TEXT_FIELDS = ("cellIndex", "baseline", "fontFamily")


def _render_plan_for(draw_ops_path: Path) -> RenderPlan:
    plan_path = repo_root() / "fixtures" / "render-plans" / draw_ops_path.name
    return RenderPlan.from_dict(read_fixture(plan_path)["plan"])


def test_every_render_plan_has_draw_op_goldens() -> None:
    plans = {path.name for path in fixture_paths("render-plans")}
    assert {path.name for path in fixture_paths("draw-ops")} == plans


@pytest.mark.parametrize("path", fixture_paths("draw-ops"), ids=lambda path: path.stem)
def test_the_embedded_core_returns_the_golden_draw_ops(path: Path) -> None:
    plan = _render_plan_for(path)
    golden = read_fixture(path)["sheets"]

    assert len(golden) == len(plan.sheets)
    for index, ops in enumerate(golden):
        assert _core.sheet_draw_ops(plan, index) == ops


class _RecordingDraw:
    def __init__(self, canvas: Image.Image, painted: list[dict[str, Any]]) -> None:
        self._draw = _REAL_DRAW(canvas)
        self._painted = painted

    def rectangle(self, xy: tuple[int, int, int, int], fill: str) -> None:
        left, top, right, bottom = xy
        self._painted.append(
            {
                "kind": "fillRect",
                "x": left,
                "y": top,
                "width": right - left + 1,
                "height": bottom - top + 1,
                "color": fill,
            }
        )
        self._draw.rectangle(xy, fill=fill)

    def text(
        self,
        xy: tuple[int, int],
        text: str,
        *,
        font: ImageFont.FreeTypeFont,
        anchor: str,
        fill: str,
        stroke_width: int,
        stroke_fill: str,
    ) -> None:
        self._painted.append(
            {
                "kind": "text",
                "text": text,
                "x": xy[0],
                "y": xy[1],
                "anchor": _ANCHOR_NAMES[anchor],
                "fontSizePx": font.size,
                "fill": fill,
                "stroke": stroke_fill,
                "strokeWidthPx": stroke_width,
            }
        )
        self._draw.text(
            xy,
            text,
            font=font,
            anchor=anchor,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )


def _paint_recorded(
    monkeypatch: pytest.MonkeyPatch,
    plan: RenderPlan,
    sheet_index: int,
    images: list[Image.Image | None],
) -> list[dict[str, Any]]:
    painted: list[dict[str, Any]] = []

    def recording_paste(canvas: Image.Image, image: Image.Image, box: tuple[int, int]) -> None:
        width, height = image.size
        painted.append(
            {"kind": "image", "x": box[0], "y": box[1], "width": width, "height": height}
        )
        _REAL_PASTE(canvas, image, box)

    monkeypatch.setattr(ImageDraw, "Draw", lambda canvas: _RecordingDraw(canvas, painted))
    monkeypatch.setattr(Image.Image, "paste", recording_paste)
    render.paint_sheet(plan, plan.sheets[sheet_index], images)
    return painted


def _as_painted(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    painted = []
    for op in ops:
        dropped = _UNPAINTED_TEXT_FIELDS if op["kind"] == "text" else ("cellIndex",)
        painted.append({key: value for key, value in op.items() if key not in dropped})
    return painted


def _sheets_to_paint(path: Path) -> list[tuple[Path, int]]:
    last = len(read_fixture(path)["sheets"]) - 1
    return [(path, index) for index in sorted({0, last})]


@pytest.mark.parametrize(
    ("path", "sheet_index"),
    [case for path in fixture_paths("draw-ops") for case in _sheets_to_paint(path)],
    ids=lambda value: value.stem if isinstance(value, Path) else f"sheet{value}",
)
def test_the_painter_runs_exactly_the_golden_ops(
    path: Path, sheet_index: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan = _render_plan_for(path)
    golden = read_fixture(path)["sheets"][sheet_index]
    cells = plan.sheets[sheet_index].cells
    images: list[Image.Image | None] = [Image.new("RGB", plan.cell.as_tuple()) for _ in cells]

    assert _paint_recorded(monkeypatch, plan, sheet_index, images) == _as_painted(golden)


def test_the_painter_skips_both_ops_of_a_missing_cell(monkeypatch: pytest.MonkeyPatch) -> None:
    path = fixture_paths("draw-ops")[0]
    plan = _render_plan_for(path)
    golden = read_fixture(path)["sheets"][0]
    images: list[Image.Image | None] = [Image.new("RGB", plan.cell.as_tuple())]
    images += [None] * (len(plan.sheets[0].cells) - 1)

    kept = [op for op in golden if op["kind"] == "fillRect" or op["cellIndex"] == 0]
    assert _paint_recorded(monkeypatch, plan, 0, images) == _as_painted(kept)


@pytest.mark.parametrize("path", fixture_paths("frames"), ids=lambda path: path.stem)
def test_capture_picks_the_recorded_source_frames(path: Path) -> None:
    fixture = read_fixture(path)
    video = repo_root() / fixture["video"]
    request = CollagePlanRequest.from_dict(fixture["request"])

    info = probe_video(video, keyframes=request.keyframe_sampling)
    assert info.to_dict() == fixture["info"]

    plan = build_render_plan(request, info)
    assert [(frame.frame_index, frame.timestamp_seconds) for frame in plan.frames] == [
        (frame["frameIndex"], frame["plannedSeconds"]) for frame in fixture["frames"]
    ]

    decoded = [round_to_microseconds(frame.time) for frame in iter_source_frames(video, plan, info)]
    assert decoded == [frame["decodedSeconds"] for frame in fixture["frames"]]
