from pathlib import Path

import pytest
from helpers import fixture_paths, read_fixture

from vid2grid import _core, build_render_plan
from vid2grid.contract import CollagePlanRequest, RenderPlan, VideoInfo


@pytest.mark.parametrize("path", fixture_paths("render-plans"), ids=lambda path: path.stem)
def test_the_embedded_core_reproduces_the_fixture(path: Path) -> None:
    fixture = read_fixture(path)
    assert _core.call("buildRenderPlan", fixture["request"], fixture["info"]) == fixture["plan"]


@pytest.mark.parametrize("path", fixture_paths("render-plans"), ids=lambda path: path.stem)
def test_build_render_plan_round_trips_the_fixture(path: Path) -> None:
    fixture = read_fixture(path)
    request = CollagePlanRequest.from_dict(fixture["request"])
    info = VideoInfo.from_dict(fixture["info"])
    assert request.to_dict() == fixture["request"]
    assert build_render_plan(request, info).to_dict() == fixture["plan"]
    assert RenderPlan.from_dict(fixture["plan"]).to_dict() == fixture["plan"]
