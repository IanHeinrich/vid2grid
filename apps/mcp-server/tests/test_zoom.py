import pytest
from vid2grid import PlanResult, VideoInfo, build_render_plan, request_from_options

from vid2grid_mcp.zoom import _sheet_side

BORDER = 16


def planned(width: int, height: int, area: list[float] | None) -> PlanResult:
    info = VideoInfo(duration_seconds=10, width=width, height=height)
    values: dict[str, object] = {"timestampsSeconds": [1], "framesPerGrid": 1}
    if area is not None:
        values["area"] = area
    return PlanResult(info=info, plan=build_render_plan(request_from_options(values, info), info))


@pytest.mark.parametrize(
    ("size", "area", "longest_side"),
    [
        ((1920, 1080), None, 1920),
        ((1080, 1920), None, 1920),
        ((3840, 2160), None, 3840),
        ((1920, 1080), [0, 0, 100, 100], 384),
        ((1920, 1080), [0, 0, 100, 1000], 2032),
        ((1920, 1080), [0, 0, 900, 900], 2032),
        ((3840, 2160), [0, 0, 900, 900], 3456),
    ],
)
def test_the_picture_is_never_shrunk_and_an_area_at_most_doubled(
    size: tuple[int, int], area: list[float] | None, longest_side: int
) -> None:
    assert _sheet_side(planned(*size, area)) == longest_side + BORDER
