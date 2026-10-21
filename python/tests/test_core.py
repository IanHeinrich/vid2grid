import json
import math
import multiprocessing
import numbers
import os
import subprocess
import sys
from fractions import Fraction

import pytest
from helpers import collage_request

from vid2grid import _core
from vid2grid.contract import VideoInfo
from vid2grid.errors import (
    InternalError,
    InvalidRequestError,
    NoAudioError,
    NoFramesError,
    Vid2GridError,
)

INFO = VideoInfo(duration_seconds=10.0, width=640, height=480)


class _EnvelopeEngine:
    def __init__(self, envelope: dict[str, object]) -> None:
        self.envelope = envelope

    def call(self, expr: str, name: str, args_json: str) -> str:
        return json.dumps(self.envelope)


def test_version_is_the_render_plan_version() -> None:
    assert _core.version() == 1


def test_an_unknown_function_is_an_internal_error() -> None:
    with pytest.raises(InternalError, match=r'^unknown function "nope"$'):
        _core.call("nope")


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
def test_an_invalid_request_keeps_cores_message(overrides: dict[str, object], message: str) -> None:
    request = collage_request(**overrides)
    with pytest.raises(InvalidRequestError) as raised:
        _core.validate_collage_plan_request(request)
    assert str(raised.value) == message
    assert isinstance(raised.value, ValueError)


def test_a_valid_request_passes_validation() -> None:
    _core.validate_collage_plan_request(collage_request())


@pytest.mark.parametrize(
    ("code", "error"),
    [
        ("invalid_request", InvalidRequestError),
        ("no_audio", NoAudioError),
        ("no_frames", NoFramesError),
        ("internal", InternalError),
    ],
)
def test_each_error_code_maps_to_its_class(
    code: str, error: type[Vid2GridError], monkeypatch: pytest.MonkeyPatch
) -> None:
    envelope = {"ok": False, "code": code, "message": f"core said {code}"}
    monkeypatch.setattr(_core, "_engine", lambda: _EnvelopeEngine(envelope))

    with pytest.raises(error) as raised:
        _core.call("version")

    assert type(raised.value) is error
    assert raised.value.code == code
    assert str(raised.value) == f"core said {code}"


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_a_non_finite_request_value_names_its_field(value: float) -> None:
    with pytest.raises(InvalidRequestError, match=r"^start_seconds must be a finite number$"):
        _core.build_render_plan(collage_request(start_seconds=value), INFO)


def test_a_non_finite_keyframe_time_names_its_field() -> None:
    info = VideoInfo(
        duration_seconds=10.0, width=640, height=480, keyframe_timestamps_seconds=(math.nan,)
    )
    with pytest.raises(InvalidRequestError, match=r"^keyframe_timestamps_seconds must be"):
        _core.build_render_plan(collage_request(keyframe_sampling=True), info)


def test_a_non_finite_positional_argument_names_the_function() -> None:
    with pytest.raises(InvalidRequestError, match=r"^normalizeRotationClockwise argument 1 must"):
        _core.normalize_rotation_clockwise(math.nan)


class _Count:
    def __init__(self, value: int) -> None:
        self.value = value

    def __int__(self) -> int:
        return self.value


numbers.Integral.register(_Count)


class _Frames(int):
    pass


def test_fractions_and_other_integral_types_are_sent_as_numbers() -> None:
    as_numbers = collage_request(
        end_seconds=Fraction(3), target_fps=Fraction(4), frames_per_grid=_Count(4)
    )
    as_int_subclass = collage_request(frames_per_grid=_Frames(4))

    expected = _core.build_render_plan(collage_request(), INFO)
    assert _core.build_render_plan(as_numbers, INFO) == expected
    assert _core.build_render_plan(as_int_subclass, INFO) == expected


def test_an_unsupported_value_is_an_invalid_request() -> None:
    with pytest.raises(InvalidRequestError, match=r"^object is not a number"):
        _core.build_render_plan(collage_request(frames_per_grid=object()), INFO)


def _version_in_child() -> int:
    return _core.version()


@pytest.mark.skipif(not hasattr(os, "fork"), reason="this platform has no fork start method")
# V8 runs its own threads, so Python warns about forking at all; that is the case under test.
@pytest.mark.filterwarnings("ignore:This process:DeprecationWarning")
def test_a_forked_child_gets_its_own_engine() -> None:
    assert _core.version() == 1
    # Pool's exit terminates a hung child, so a regression fails here instead of hanging.
    with multiprocessing.get_context("fork").Pool(1) as pool:
        assert pool.apply_async(_version_in_child).get(timeout=30) == 1


def test_a_process_that_used_the_engine_exits() -> None:
    # Unfixed, Python 3.13 hung here on every run and 3.11 on about one in ten.
    for _ in range(5):
        completed = subprocess.run(
            [sys.executable, "-c", "from vid2grid import _core; _core.version()"],
            capture_output=True,
            timeout=30,
            check=False,
        )
        assert completed.returncode == 0, completed.stderr


def test_keyframe_sampling_without_keyframes_is_an_invalid_request() -> None:
    with pytest.raises(InvalidRequestError, match="keyframe"):
        _core.build_render_plan(collage_request(keyframe_sampling=True), INFO)


def test_an_integral_float_is_accepted_as_an_integer_as_core_does() -> None:
    as_float = _core.build_render_plan(collage_request(frames_per_grid=4.0, frame_count=8.0), INFO)
    as_int = _core.build_render_plan(collage_request(frames_per_grid=4, frame_count=8), INFO)
    assert as_float == as_int
    assert len(as_float.sheets) == 2


def test_keyframe_sampling_falls_back_with_cores_warning() -> None:
    request = collage_request(keyframe_sampling=True)

    resolved = _core.resolve_keyframe_sampling(request, INFO)
    with_reason = _core.resolve_keyframe_sampling(request, INFO, "demux failed")

    assert resolved.request == collage_request()
    assert resolved.warning == "Keyframes unavailable; sampled by target FPS instead"
    assert with_reason.warning == (
        "Keyframes unavailable (demux failed); sampled by target FPS instead"
    )


def test_keyframes_in_range_keep_keyframe_sampling() -> None:
    request = collage_request(keyframe_sampling=True)
    info = VideoInfo(
        duration_seconds=10.0, width=640, height=480, keyframe_timestamps_seconds=(1.0,)
    )

    resolved = _core.resolve_keyframe_sampling(request, info)

    assert resolved.request == request
    assert resolved.warning is None
