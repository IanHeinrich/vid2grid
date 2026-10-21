import math
from dataclasses import replace
from pathlib import Path

import av
import pytest
from helpers import CURATOR_FRAMES, CURATOR_OUTPUT_RESOLUTION, collage_request
from PIL import Image

import vid2grid
from vid2grid import sheets
from vid2grid.probe import probe_video
from vid2grid.sheets import render_sheets, render_single_sheet

KEYFRAMES_UNAVAILABLE = "Keyframes unavailable; sampled by target FPS instead"

SHEET_ROW_KEYS = {
    "sheet_path",
    "info",
    "frame_count",
    "first_timestamp_s",
    "last_timestamp_s",
    "timings_ms",
    "vid2grid_version",
}


def test_render_sheets_writes_one_numbered_jpeg_per_sheet(tiny_video: Path, tmp_path: Path) -> None:
    request = collage_request()
    result = render_sheets(tiny_video, request, tmp_path)

    expected = math.ceil(len(result.plan.frames) / request.frames_per_grid)
    assert len(result.sheet_paths) == expected
    assert [path.name for path in result.sheet_paths] == [
        f"grid_{index + 1:04d}.jpg" for index in range(expected)
    ]
    for path in result.sheet_paths:
        assert path.read_bytes()[:3] == b"\xff\xd8\xff"
        with Image.open(path) as sheet:
            assert sheet.size == (request.output_resolution, request.output_resolution)
            assert sheet.format == "JPEG"
    assert result.timings_ms.keys() == {"extracting", "rendering"}
    assert all(isinstance(value, int) for value in result.timings_ms.values())
    assert result.warnings == ()


def test_render_single_sheet_reports_curators_row(tiny_video: Path, tmp_path: Path) -> None:
    out_path = tmp_path / "sheet.jpg"

    result = render_single_sheet(
        tiny_video,
        out_path=out_path,
        frames=CURATOR_FRAMES,
        output_resolution=CURATOR_OUTPUT_RESOLUTION,
    )

    with Image.open(out_path) as sheet:
        assert sheet.size == (CURATOR_OUTPUT_RESOLUTION, CURATOR_OUTPUT_RESOLUTION)
        assert sheet.format == "JPEG"
    row = result.to_sheet_row(str(out_path))
    assert set(row) == SHEET_ROW_KEYS
    assert set(row["info"]) == {"duration_s", "width", "height", "fps", "codec", "rotation"}
    assert row["frame_count"] == CURATOR_FRAMES
    assert row["first_timestamp_s"] == 0.0
    assert row["last_timestamp_s"] > 0
    assert all(isinstance(value, int) for value in row["timings_ms"].values())
    assert row["vid2grid_version"] == vid2grid.__version__
    assert result.to_sheet_row()["sheet_path"] == str(out_path)


def test_render_single_sheet_on_curators_mp4(curator_mp4: Path, tmp_path: Path) -> None:
    out_path = tmp_path / "sheet.jpg"

    result = render_single_sheet(
        curator_mp4,
        out_path=out_path,
        frames=CURATOR_FRAMES,
        output_resolution=CURATOR_OUTPUT_RESOLUTION,
        jpeg_quality=85,
    )

    with Image.open(out_path) as sheet:
        assert sheet.format == "JPEG"
    row = result.to_sheet_row()
    assert row["frame_count"] == CURATOR_FRAMES
    assert (row["info"]["width"], row["info"]["height"]) == (160, 120)


def test_keyframe_sampling_falls_back_to_time_sampling(tiny_video: Path, tmp_path: Path) -> None:
    probed = probe_video(tiny_video, keyframes=True)
    without_keyframes = replace(probed, keyframe_timestamps_seconds=())

    result = render_sheets(
        tiny_video, collage_request(keyframe_sampling=True), tmp_path, info=without_keyframes
    )

    assert result.warnings == (KEYFRAMES_UNAVAILABLE,)
    assert result.plan.frames
    assert result.sheet_paths


def test_a_supplied_info_is_topped_up_with_keyframes(tiny_video: Path, tmp_path: Path) -> None:
    without_keyframes = probe_video(tiny_video)
    assert without_keyframes.keyframe_timestamps_seconds is None
    keyframes = probe_video(tiny_video, keyframes=True).keyframe_timestamps_seconds
    assert keyframes is not None

    result = render_sheets(
        tiny_video, collage_request(keyframe_sampling=True), tmp_path, info=without_keyframes
    )

    assert result.warnings == ()
    assert [frame.timestamp_seconds for frame in result.plan.frames] == [
        timestamp for timestamp in keyframes if 0.0 <= timestamp <= 3.0
    ]


def test_render_sheets_validates_before_probing(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="jpeg_quality must be between 1 and 100"):
        render_sheets(tmp_path / "missing.mp4", collage_request(jpeg_quality=0), tmp_path)


def test_keyframes_outside_the_range_fall_back_too(tiny_video: Path, tmp_path: Path) -> None:
    probed = probe_video(tiny_video)
    only_at_the_start = replace(probed, keyframe_timestamps_seconds=(0.0,))

    result = render_sheets(
        tiny_video,
        collage_request(start_seconds=1.0, keyframe_sampling=True),
        tmp_path,
        info=only_at_the_start,
    )

    assert result.warnings == (KEYFRAMES_UNAVAILABLE,)
    assert result.sheet_paths


def test_a_sheet_whose_frames_were_never_captured_is_dropped(
    tiny_video: Path, tmp_path: Path
) -> None:
    probed = probe_video(tiny_video)
    # Twice the real duration, so the planner plans a second sheet past the end of the stream.
    overlong = replace(probed, duration_seconds=probed.duration_seconds * 2)

    result = render_sheets(
        tiny_video,
        collage_request(end_seconds=overlong.duration_seconds, frame_count=8, frames_per_grid=4),
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


def test_unreadable_keyframes_fall_back_with_the_reason(
    tiny_video: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreadable(path: str | Path) -> tuple[float, ...]:
        raise av.InvalidDataError(1094995529, "Invalid data found when processing input")

    monkeypatch.setattr(sheets, "read_keyframe_timestamps", unreadable)

    result = render_sheets(tiny_video, collage_request(keyframe_sampling=True), tmp_path)

    assert result.warnings == (
        "Keyframes unavailable ([Errno 1094995529] Invalid data found when processing input);"
        " sampled by target FPS instead",
    )
    assert result.sheet_paths
