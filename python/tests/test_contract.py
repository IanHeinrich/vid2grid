from dataclasses import replace

import pytest

import vid2grid
from vid2grid.contract import CollagePlanRequest, CollageRequest, VideoInfo
from vid2grid.errors import InvalidRequestError


def test_collage_request_is_an_alias_of_collage_plan_request() -> None:
    assert CollageRequest is CollagePlanRequest
    assert vid2grid.CollageRequest is CollagePlanRequest
    assert vid2grid.CollagePlanRequest is CollagePlanRequest


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_a_quarter_turn_rotation_is_accepted(rotation: int) -> None:
    assert (
        VideoInfo(duration_seconds=1.0, width=4, height=3, rotation=rotation).rotation == rotation
    )


@pytest.mark.parametrize("rotation", [45, -90, 360])
def test_any_other_rotation_is_an_invalid_request(rotation: int) -> None:
    with pytest.raises(InvalidRequestError, match="rotation must be 0, 90, 180 or 270"):
        VideoInfo(duration_seconds=1.0, width=4, height=3, rotation=rotation)


def test_replacing_the_rotation_is_validated_too() -> None:
    info = VideoInfo(duration_seconds=3.0, width=320, height=240)
    with pytest.raises(InvalidRequestError):
        replace(info, rotation=45)
