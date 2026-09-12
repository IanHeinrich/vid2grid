import math
from dataclasses import replace
from pathlib import Path

import pytest
from PIL import Image

from vid2grid.contract import CollageRequest
from vid2grid.probe import probe
from vid2grid.sheets import render_sheets, render_single_sheet

SHEET_ROW_KEYS = {
    "sheet_path",
    "info",
    "frame_count",
    "first_timestamp_s",
    "last_timestamp_s",
    "timings_ms",
    "vid2grid_version",
}


def _request(**overrides: object) -> CollageRequest:
    fields: dict[str, object] = {
        "start_seconds": 0.0,
        "end_seconds": 3.0,
        "target_fps": 4.0,
        "frames_per_grid": 4,
        "output_resolution": 512,
        "jpeg_quality": 85,
    }
    fields.update(overrides)
    return CollageRequest(**fields)  # type: ignore[arg-type]


def test_render_sheets_writes_one_numbered_jpeg_per_sheet(tiny_video: Path, tmp_path: Path) -> None:
    result = render_sheets(tiny_video, _request(), tmp_path)

    expected = math.ceil(len(result.plan.frames) / 4)
    assert len(result.sheet_paths) == expected
    assert [path.name for path in result.sheet_paths] == [
        f"grid_{index + 1:04d}.jpg" for index in range(expected)
    ]
    for path in result.sheet_paths:
        assert path.read_bytes()[:3] == b"\xff\xd8\xff"
        with Image.open(path) as sheet:
            assert sheet.size == (512, 512)
            assert sheet.format == "JPEG"
    assert result.timings_ms.keys() == {"extracting", "rendering"}
    assert all(isinstance(value, int) for value in result.timings_ms.values())
    assert result.warnings == ()


def test_render_single_sheet_reports_curators_row(tiny_video: Path, tmp_path: Path) -> None:
    out_path = tmp_path / "sheet.jpg"

    result = render_single_sheet(tiny_video, out_path=out_path, frames=16, output_resolution=1024)

    with Image.open(out_path) as sheet:
        assert sheet.size == (1024, 1024)
        assert sheet.format == "JPEG"
    row = result.to_sheet_row(str(out_path))
    assert set(row) == SHEET_ROW_KEYS
    assert set(row["info"]) == {"duration_s", "width", "height", "fps", "codec", "rotation"}
    assert row["frame_count"] == 16
    assert row["first_timestamp_s"] == 0.0
    assert row["last_timestamp_s"] > 0
    assert all(isinstance(value, int) for value in row["timings_ms"].values())
    assert row["vid2grid_version"] == result.vid2grid_version


def test_keyframe_sampling_falls_back_to_time_sampling(tiny_video: Path, tmp_path: Path) -> None:
    probed = probe(tiny_video, keyframes=True)
    without_keyframes = replace(probed, keyframe_timestamps_seconds=())

    result = render_sheets(
        tiny_video, _request(keyframe_sampling=True), tmp_path, info=without_keyframes
    )

    assert len(result.warnings) == 1
    assert "keyframe" in result.warnings[0]
    assert result.plan.frames
    assert result.sheet_paths


def test_keyframes_outside_the_range_fall_back_too(tiny_video: Path, tmp_path: Path) -> None:
    probed = probe(tiny_video)
    only_at_the_start = replace(probed, keyframe_timestamps_seconds=(0.0,))

    result = render_sheets(
        tiny_video,
        _request(start_seconds=1.0, keyframe_sampling=True),
        tmp_path,
        info=only_at_the_start,
    )

    assert len(result.warnings) == 1
    assert result.sheet_paths


def test_a_sheet_whose_frames_were_never_captured_is_dropped(
    tiny_video: Path, tmp_path: Path
) -> None:
    probed = probe(tiny_video)
    # Twice the real duration, so the planner plans a second sheet past the end of the stream.
    overlong = replace(probed, duration_seconds=probed.duration_seconds * 2)

    result = render_sheets(
        tiny_video,
        _request(end_seconds=overlong.duration_seconds, frame_count=8, frames_per_grid=4),
        tmp_path,
        info=overlong,
    )

    assert len(result.plan.sheets) == 2
    assert [path.name for path in result.sheet_paths] == ["grid_0001.jpg"]
    assert result.frame_count == 4
    assert sorted(path.name for path in tmp_path.iterdir()) == ["grid_0001.jpg"]


def test_render_single_sheet_rejects_an_empty_range(tiny_video: Path, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="end_time must be greater than start_time"):
        render_single_sheet(
            tiny_video, out_path=tmp_path / "sheet.jpg", start_seconds=1.0, end_seconds=1.0
        )
