import json
from pathlib import Path

import pytest
from conftest import collage_request

from vid2grid.contract import CollageRequest, RenderPlan, TimestampFormat, VideoInfo
from vid2grid.planner import (
    GUTTER_PX,
    build_render_plan,
    choose_timestamp_format,
    combined_transcript_file_name,
    compute_optimal_grid,
    compute_sheet_windows,
    format_timestamp,
    grid_file_name,
    grid_transcript_file_name,
    round_to_microseconds,
    subsample_evenly,
    validate_request,
)


def _fixture_dir() -> Path | None:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "fixtures" / "render-plans"
        if candidate.is_dir():
            return candidate
    return None


def _fixture_paths() -> list[Path]:
    directory = _fixture_dir()
    return [] if directory is None else sorted(directory.glob("*.json"))


def test_fixture_directory_is_not_empty() -> None:
    directory = _fixture_dir()
    if directory is None:
        pytest.skip("fixtures/render-plans/ is not reachable from this checkout")
    assert list(directory.glob("*.json"))


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda path: path.stem)
def test_fixture_plan_is_reproduced(path: Path) -> None:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    request = CollageRequest.from_dict(fixture["request"])
    info = VideoInfo.from_dict(fixture["info"])
    assert build_render_plan(request, info).to_dict() == fixture["plan"]
    assert RenderPlan.from_dict(fixture["plan"]).to_dict() == fixture["plan"]


def test_compute_optimal_grid_matches_the_worked_example() -> None:
    layout = compute_optimal_grid(4, 320 / 240, 512, GUTTER_PX)
    assert (layout.cols, layout.rows) == (2, 2)
    assert (layout.cell_w, layout.cell_h) == (244, 183)
    assert (layout.offset_x, layout.offset_y) == (0, 61)


def test_compute_optimal_grid_centres_an_odd_leftover() -> None:
    layout = compute_optimal_grid(3, 16 / 9, 500, GUTTER_PX)
    grid_height = layout.rows * layout.cell_h + (layout.rows + 1) * GUTTER_PX
    assert layout.offset_y == (500 - grid_height) // 2


@pytest.mark.parametrize(
    ("frame_count", "aspect", "resolution", "gutter", "message"),
    [
        (0, 1.0, 512, 8, "frameCount must be positive"),
        (4, 0.0, 512, 8, "sourceAspect must be positive"),
        (4, 1.0, 0, 8, "outputResolution must be positive"),
        (4, 1.0, 512, -1, "gutterPx must not be negative"),
        (4, 1.0, 16, 8, "output_resolution too small"),
    ],
)
def test_compute_optimal_grid_rejects_impossible_inputs(
    frame_count: int, aspect: float, resolution: int, gutter: int, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        compute_optimal_grid(frame_count, aspect, resolution, gutter)


@pytest.mark.parametrize(
    ("seconds", "show_hours", "show_minutes", "show_milliseconds", "expected"),
    [
        (0, False, False, False, "00"),
        (0, False, False, True, "00.000"),
        (7.5, False, False, True, "07.500"),
        (65, False, True, False, "01:05"),
        (65.25, False, True, True, "01:05.250"),
        (3661, True, False, False, "01:01:01"),
        (3661, True, True, False, "01:01:01"),
        (7199.999, True, True, True, "01:59:59.999"),
    ],
)
def test_format_timestamp(
    seconds: float,
    show_hours: bool,
    show_minutes: bool,
    show_milliseconds: bool,
    expected: str,
) -> None:
    timestamp_format = TimestampFormat(
        show_hours=show_hours, show_minutes=show_minutes, show_milliseconds=show_milliseconds
    )
    assert format_timestamp(seconds, timestamp_format) == expected


def test_format_timestamp_rounds_a_half_millisecond_up() -> None:
    # Python's round() would take 0.0005 to 0.000 (half to even) where JavaScript takes it to 1.
    assert (
        format_timestamp(
            0.0005, TimestampFormat(show_hours=False, show_minutes=False, show_milliseconds=True)
        )
        == "00.001"
    )


@pytest.mark.parametrize(
    ("last_timestamp", "target_fps", "expected"),
    [
        (None, 2, (False, False, False)),
        (59.9, 1, (False, False, False)),
        (60, 1, (False, True, False)),
        (3599, 2, (False, True, True)),
        (3600, 0.5, (True, True, False)),
    ],
)
def test_choose_timestamp_format(
    last_timestamp: float | None, target_fps: float, expected: tuple[bool, bool, bool]
) -> None:
    chosen = choose_timestamp_format(last_timestamp, target_fps)
    assert (chosen.show_hours, chosen.show_minutes, chosen.show_milliseconds) == expected


@pytest.mark.parametrize(
    ("values", "max_kept", "expected"),
    [
        ([1, 2, 3], 5, [1, 2, 3]),
        ([1, 2, 3], 3, [1, 2, 3]),
        (list(range(10)), 4, [0, 2, 5, 7]),
        (list(range(9)), 2, [0, 4]),
        (list(range(24)), 8, [0, 3, 6, 9, 12, 15, 18, 21]),
    ],
)
def test_subsample_evenly(values: list[int], max_kept: int, expected: list[int]) -> None:
    assert subsample_evenly(values, max_kept) == expected


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [
        (0, 0),
        (1 / 3, 0.333333),
        (2 / 3, 0.666667),
        (0.0000005, 0.000001),
        (2.0000004, 2.0),
    ],
)
def test_round_to_microseconds(seconds: float, expected: float) -> None:
    assert round_to_microseconds(seconds) == expected


def test_round_to_microseconds_floors_a_negative_timestamp() -> None:
    # int() truncates toward zero, so it would give -1e-06 where Math.floor gives -2e-06.
    assert round_to_microseconds(-0.0000016) == -2e-06


def test_compute_sheet_windows_splits_gaps_at_their_midpoint() -> None:
    windows = compute_sheet_windows([[0.0, 0.5, 1.0, 1.5], [2.0, 2.5]], 0.0, 3.0)
    assert [(window.start_seconds, window.end_seconds) for window in windows] == [
        (0.0, 1.75),
        (1.75, 3.0),
    ]
    assert [window.file_name for window in windows] == ["grid_0001.vtt", "grid_0002.vtt"]


def test_file_names() -> None:
    assert grid_file_name(0) == "grid_0001.jpg"
    assert grid_file_name(9999) == "grid_10000.jpg"
    assert grid_transcript_file_name(1) == "grid_0002.vtt"
    assert combined_transcript_file_name() == "transcript.vtt"


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"end_seconds": 0.0}, "end_time must be greater than start_time"),
        ({"target_fps": 0}, "target_fps must be positive"),
        ({"frames_per_grid": 0}, "frames_per_grid must be positive"),
        ({"output_resolution": 0}, "output_resolution must be positive"),
        ({"jpeg_quality": 0}, "jpeg_quality must be between 1 and 100"),
        ({"jpeg_quality": 101}, "jpeg_quality must be between 1 and 100"),
        ({"frame_count": 0}, "frame_count must be a positive integer"),
        ({"frame_count": 2.5}, "frame_count must be a positive integer"),
        ({"max_keyframes": -1}, "max_keyframes must be a positive integer"),
    ],
)
def test_validate_request_rejects(overrides: dict[str, object], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        validate_request(collage_request(**overrides))


def test_keyframe_sampling_without_probed_keyframes_raises() -> None:
    request = collage_request(keyframe_sampling=True)
    info = VideoInfo(duration_seconds=10.0, width=640, height=480)
    with pytest.raises(ValueError, match="keyframe_sampling needs keyframe_timestamps_seconds"):
        build_render_plan(request, info)


def test_a_trailing_partial_sheet_keeps_the_full_layout() -> None:
    plan = build_render_plan(
        collage_request(end_seconds=7.0, target_fps=1.0),
        VideoInfo(duration_seconds=7.0, width=640, height=480),
    )
    assert len(plan.sheets) == 2
    assert len(plan.sheets[0].cells) == 4
    assert len(plan.sheets[1].cells) == 3
    assert plan.sheets[1].cells[0].width == plan.cell.width
