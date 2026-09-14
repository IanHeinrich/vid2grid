from fractions import Fraction
from pathlib import Path

import av
import pytest

from vid2grid.planner import round_to_microseconds
from vid2grid.probe import display_size, normalize_rotation_clockwise, probe


def _decoded_keyframe_seconds(path: Path) -> set[float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        return {
            round_to_microseconds(frame.time)
            for frame in container.decode(stream)
            if frame.key_frame and frame.time is not None
        }


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

    assert keyframes[0] == 0.0
    assert all(later > earlier for earlier, later in zip(keyframes, keyframes[1:], strict=False))
    assert all(0 <= timestamp <= info.duration_seconds for timestamp in keyframes)
    assert set(keyframes) <= _decoded_keyframe_seconds(tiny_video)


@pytest.mark.parametrize(
    ("coded", "sample_aspect_ratio", "rotation", "expected"),
    [
        ((320, 240), None, 0, (320, 240)),
        ((320, 240), Fraction(1, 1), 0, (320, 240)),
        ((720, 480), Fraction(32, 27), 0, (853, 480)),
        ((720, 480), Fraction(32, 27), 90, (480, 853)),
        ((720, 480), Fraction(32, 27), 270, (480, 853)),
        ((720, 480), Fraction(32, 27), 180, (853, 480)),
        ((320, 240), None, 90, (240, 320)),
    ],
)
def test_display_size(
    coded: tuple[int, int],
    sample_aspect_ratio: Fraction | None,
    rotation: int,
    expected: tuple[int, int],
) -> None:
    assert display_size(coded[0], coded[1], sample_aspect_ratio, rotation) == expected


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
