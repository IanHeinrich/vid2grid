from pathlib import Path

import pytest

from vid2grid.probe import normalize_rotation_clockwise, probe


def test_probe_reads_the_synthesised_video(tiny_video: Path) -> None:
    info = probe(tiny_video)
    assert abs(info.duration_seconds - 3.0) < 0.2
    assert (info.width, info.height) == (320, 240)
    assert abs(info.fps - 10) < 0.1
    assert info.codec
    assert info.rotation == 0
    assert info.keyframe_timestamps_seconds is None


def test_probe_keyframes_are_ascending_and_in_range(tiny_video: Path) -> None:
    info = probe(tiny_video, keyframes=True)
    keyframes = info.keyframe_timestamps_seconds
    assert keyframes
    assert list(keyframes) == sorted(keyframes)
    assert all(0 <= timestamp <= info.duration_seconds for timestamp in keyframes)


@pytest.mark.parametrize(
    ("ccw_degrees", "expected"),
    [
        (0, 0),
        (-90, 90),
        (90, 270),
        (180, 180),
        (-180, 180),
        (270, 90),
        (-270, 270),
        (360, 0),
        (-89.9, 90),
        (-0.4, 0),
    ],
)
def test_normalize_rotation_clockwise(ccw_degrees: float, expected: int) -> None:
    assert normalize_rotation_clockwise(ccw_degrees) == expected
