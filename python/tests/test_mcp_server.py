import json
from pathlib import Path
from typing import Any

import anyio
import av
import pytest
from helpers import repo_root
from mcp import types
from mcp.shared.memory import create_connected_server_and_client_session

from vid2grid import cli, sheets, transcribe
from vid2grid._core import option_specs, request_from_options
from vid2grid.errors import InvalidRequestError
from vid2grid.mcp_server import PLAN_VIDEO, VIDEO_TO_SHEETS, create_server
from vid2grid.options import host_capabilities, plan_from_options
from vid2grid.probe import probe_video

VALUES: dict[str, object] = {"targetFps": 4, "framesPerGrid": 4, "outputResolution": 512}
BOUNDS = {"min": "minimum", "max": "maximum", "exclusiveMin": "exclusiveMinimum"}


@pytest.fixture
def video() -> Path:
    return repo_root() / "fixtures" / "videos" / "tiny.mp4"


def list_tools() -> dict[str, types.Tool]:
    async def run() -> list[types.Tool]:
        async with create_connected_server_and_client_session(create_server()) as client:
            return (await client.list_tools()).tools

    return {tool.name: tool for tool in anyio.run(run)}


def call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
    async def run() -> types.CallToolResult:
        async with create_connected_server_and_client_session(create_server()) as client:
            return await client.call_tool(name, arguments)

    return anyio.run(run)


def properties(tool: types.Tool) -> dict[str, dict[str, Any]]:
    schema: dict[str, dict[str, Any]] = tool.inputSchema["properties"]
    return schema


def test_the_tool_schemas_are_the_option_specs_with_their_bounds() -> None:
    specs = option_specs(host_capabilities())
    tools = list_tools()

    names = {spec["name"] for spec in specs}
    assert set(properties(tools[VIDEO_TO_SHEETS])) == names | {"path", "outDir"}
    assert set(properties(tools[PLAN_VIDEO])) == names | {"path"}
    for spec in specs:
        schema = properties(tools[VIDEO_TO_SHEETS])[spec["name"]]
        assert schema["description"] == spec["help"]
        for bound, key in BOUNDS.items():
            assert schema.get(key) == spec.get(bound)


@pytest.mark.parametrize(("available", "offered"), [(True, True), (False, False)])
def test_transcript_is_offered_only_with_transcription(
    monkeypatch: pytest.MonkeyPatch, available: bool, offered: bool
) -> None:
    monkeypatch.setattr(transcribe, "available", lambda: available)

    for tool in list_tools().values():
        assert ("transcript" in properties(tool)) is offered


def test_plan_video_returns_the_plan_from_options(video: Path) -> None:
    result = call_tool(PLAN_VIDEO, {"path": str(video), **VALUES})

    assert not result.isError
    assert result.structuredContent == plan_from_options(video, VALUES).to_dict()
    assert result.structuredContent["warnings"] == []


def test_plan_video_returns_the_plans_warnings(
    video: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def unreadable(path: str | Path) -> tuple[float, ...]:
        raise av.InvalidDataError(1094995529, "Invalid data found when processing input")

    monkeypatch.setattr(sheets, "read_keyframe_timestamps", unreadable)
    flags = ["--fps", "4", "--frames-per-grid", "4", "--resolution", "512", "--keyframes"]

    assert cli.main([str(video), *flags, "--plan-only", "--json"]) == 0
    result = call_tool(PLAN_VIDEO, {"path": str(video), "keyframeSampling": True, **VALUES})

    printed = json.loads(capsys.readouterr().out)
    assert not result.isError
    assert result.structuredContent == printed
    assert printed["warnings"][0].startswith("Keyframes unavailable (")


def test_video_to_sheets_writes_the_sheets_and_returns_their_paths(
    video: Path, tmp_path: Path
) -> None:
    result = call_tool(VIDEO_TO_SHEETS, {"path": str(video), "outDir": str(tmp_path), **VALUES})

    assert not result.isError
    assert result.structuredContent is not None
    sheets = result.structuredContent["sheets"]
    assert [Path(sheet["path"]) for sheet in sheets] == sorted(tmp_path.glob("*.jpg"))
    assert sheets[0]["firstTimestampSeconds"] == 0
    assert all(s["firstTimestampSeconds"] <= s["lastTimestampSeconds"] for s in sheets)


def test_video_to_sheets_returns_the_same_dict_as_the_clis_json(
    video: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sheets, "_to_ms", lambda seconds: 0)
    flags = ["--fps", "4", "--frames-per-grid", "4", "--resolution", "512"]

    assert cli.main([str(video), *flags, "--json", "-o", str(tmp_path)]) == 0
    result = call_tool(VIDEO_TO_SHEETS, {"path": str(video), "outDir": str(tmp_path), **VALUES})

    assert not result.isError
    assert result.structuredContent == json.loads(capsys.readouterr().out)


def test_a_missing_video_is_an_invalid_request(tmp_path: Path) -> None:
    missing = tmp_path / "absent.mp4"

    result = call_tool(VIDEO_TO_SHEETS, {"path": str(missing), "outDir": str(tmp_path)})

    assert result.isError
    assert result.structuredContent == {
        "code": "invalid_request",
        "message": f"video not found: {missing}",
    }


@pytest.mark.parametrize("bad", [{"framesPerGrid": 2.5}, {"fps": 2}])
def test_a_bad_option_is_an_error_result_with_cores_message(
    video: Path, bad: dict[str, object]
) -> None:
    with pytest.raises(InvalidRequestError) as raised:
        request_from_options(bad, probe_video(video))

    result = call_tool(PLAN_VIDEO, {"path": str(video), **bad})

    assert result.isError
    assert result.structuredContent == {"code": "invalid_request", "message": str(raised.value)}
    assert str(raised.value) in "".join(
        block.text for block in result.content if isinstance(block, types.TextContent)
    )
