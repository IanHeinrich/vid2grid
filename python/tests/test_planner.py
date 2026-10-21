import json
from pathlib import Path
from typing import Any

import pytest

from vid2grid import _core, build_render_plan
from vid2grid.contract import CollagePlanRequest, RenderPlan, VideoInfo


def _fixture_dir() -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "fixtures" / "render-plans"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("fixtures/render-plans/ is not reachable from this checkout")


def _fixture_paths() -> list[Path]:
    return sorted(_fixture_dir().glob("*.json"))


def _fixture(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def test_fixture_directory_is_not_empty() -> None:
    assert _fixture_paths()


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda path: path.stem)
def test_the_embedded_core_reproduces_the_fixture(path: Path) -> None:
    fixture = _fixture(path)
    assert _core.call("buildRenderPlan", fixture["request"], fixture["info"]) == fixture["plan"]


@pytest.mark.parametrize("path", _fixture_paths(), ids=lambda path: path.stem)
def test_build_render_plan_round_trips_the_fixture(path: Path) -> None:
    fixture = _fixture(path)
    request = CollagePlanRequest.from_dict(fixture["request"])
    info = VideoInfo.from_dict(fixture["info"])
    assert request.to_dict() == fixture["request"]
    assert build_render_plan(request, info).to_dict() == fixture["plan"]
    assert RenderPlan.from_dict(fixture["plan"]).to_dict() == fixture["plan"]
