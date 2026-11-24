import base64
import io
import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

import anyio
import av
import pytest
from helpers import repo_root
from mcp import types
from mcp.shared.memory import create_connected_server_and_client_session
from PIL import Image
from vid2grid import (
    InvalidRequestError,
    capture_frames,
    host_capabilities,
    option_specs,
    plan_from_options,
    probe_video,
    render_from_options,
    request_from_options,
    sheets,
    transcribe,
)

from vid2grid_mcp import mcp_server, zoom
from vid2grid_mcp.mcp_server import PLAN_VIDEO, VIDEO_TO_SHEETS, ZOOM_FRAME, create_server

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
    assert set(properties(tools[VIDEO_TO_SHEETS])) == names | {"path", "outDir", "includeImages"}
    assert set(properties(tools[PLAN_VIDEO])) == names | {"path"}
    for spec in specs:
        schema = properties(tools[VIDEO_TO_SHEETS])[spec["name"]]
        assert schema["description"] == spec["help"]
        for bound, key in BOUNDS.items():
            assert schema.get(key) == spec.get(bound)


def test_a_list_of_numbers_is_an_array_schema() -> None:
    schema = properties(list_tools()[VIDEO_TO_SHEETS])["timestampsSeconds"]

    assert schema["type"] == "array"
    assert schema["items"] == {"type": "number", "minimum": 0}
    assert schema["minItems"] == 1

    area = properties(list_tools()[VIDEO_TO_SHEETS])["area"]
    assert area["items"] == {"type": "number", "minimum": 0, "maximum": 1000}
    assert (area["minItems"], area["maxItems"]) == (4, 4)


def test_include_images_is_offered_on_video_to_sheets_only() -> None:
    tools = list_tools()

    assert properties(tools[VIDEO_TO_SHEETS])["includeImages"]["type"] == "boolean"
    assert properties(tools[VIDEO_TO_SHEETS])["includeImages"]["default"] is True
    assert "includeImages" not in properties(tools[PLAN_VIDEO])


@pytest.mark.parametrize(("available", "offered"), [(True, True), (False, False)])
def test_transcript_is_offered_only_with_transcription(
    monkeypatch: pytest.MonkeyPatch, available: bool, offered: bool
) -> None:
    monkeypatch.setattr(transcribe, "available", lambda: available)

    tools = list_tools()
    for name in (VIDEO_TO_SHEETS, PLAN_VIDEO):
        assert ("transcript" in properties(tools[name])) is offered


def test_plan_video_returns_the_plan_from_options(video: Path) -> None:
    result = call_tool(PLAN_VIDEO, {"path": str(video), **VALUES})

    assert not result.isError
    assert result.structuredContent == plan_from_options(video, VALUES).to_dict()
    assert result.structuredContent["warnings"] == []


def test_plan_video_returns_the_plans_warnings(
    video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreadable(path: str | Path) -> tuple[float, ...]:
        raise av.InvalidDataError(1094995529, "Invalid data found when processing input")

    monkeypatch.setattr(sheets, "read_keyframe_timestamps", unreadable)
    values = {"keyframeSampling": True, **VALUES}

    result = call_tool(PLAN_VIDEO, {"path": str(video), **values})

    assert not result.isError
    assert result.structuredContent == plan_from_options(video, values).to_dict()
    assert result.structuredContent["warnings"][0].startswith("Keyframes unavailable (")


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


def test_video_to_sheets_returns_the_render_results_dict(
    video: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sheets, "_to_ms", lambda seconds: 0)
    expected = render_from_options(video, tmp_path, VALUES).to_dict()

    result = call_tool(VIDEO_TO_SHEETS, {"path": str(video), "outDir": str(tmp_path), **VALUES})

    assert not result.isError
    assert result.structuredContent == expected


def test_video_to_sheets_returns_each_sheet_as_a_jpeg_image(video: Path, tmp_path: Path) -> None:
    result = call_tool(VIDEO_TO_SHEETS, {"path": str(video), "outDir": str(tmp_path), **VALUES})

    assert not result.isError
    assert result.structuredContent is not None
    text, *images = result.content
    assert isinstance(text, types.TextContent)
    assert json.loads(text.text) == result.structuredContent
    sheet_paths = [Path(sheet["path"]) for sheet in result.structuredContent["sheets"]]
    assert len(images) == len(sheet_paths) > 0
    for image, sheet_path in zip(images, sheet_paths, strict=True):
        assert isinstance(image, types.ImageContent)
        assert image.mimeType == "image/jpeg"
        assert base64.b64decode(image.data) == sheet_path.read_bytes()
        assert base64.b64decode(image.data).startswith(b"\xff\xd8")


def test_include_images_false_returns_no_image_blocks(video: Path, tmp_path: Path) -> None:
    arguments = {"path": str(video), "outDir": str(tmp_path), "includeImages": False, **VALUES}

    result = call_tool(VIDEO_TO_SHEETS, arguments)

    assert not result.isError
    assert result.structuredContent is not None
    assert result.structuredContent["sheets"]
    assert [block.type for block in result.content] == ["text"]


def test_past_the_inline_limit_only_the_paths_and_a_note_come_back(
    video: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mcp_server, "_MAX_INLINE_SHEETS", 1)
    arguments = {"path": str(video), "outDir": str(tmp_path), **VALUES, "framesPerGrid": 1}

    result = call_tool(VIDEO_TO_SHEETS, arguments)

    assert not result.isError
    assert result.structuredContent is not None
    count = len(result.structuredContent["sheets"])
    assert count > 1
    _, note = result.content
    assert isinstance(note, types.TextContent)
    assert note.text.startswith(f"{count} sheets are more than the 1 returned as images")


def test_a_non_boolean_include_images_is_an_error_result(video: Path, tmp_path: Path) -> None:
    arguments = {"path": str(video), "outDir": str(tmp_path), "includeImages": "no"}

    result = call_tool(VIDEO_TO_SHEETS, arguments)

    assert result.isError
    assert result.structuredContent == {
        "code": "invalid_request",
        "message": "includeImages must be a boolean",
    }
    assert not list(tmp_path.glob("*.jpg"))


def test_video_to_sheets_takes_a_null_as_not_given(video: Path, tmp_path: Path) -> None:
    copy = shutil.copy(video, tmp_path)
    nulls = {"outDir": None, "includeImages": None, "endSeconds": None}

    result = call_tool(VIDEO_TO_SHEETS, {"path": str(copy), **VALUES, **nulls})

    assert not result.isError
    assert result.structuredContent is not None
    sheet_paths = [Path(sheet["path"]) for sheet in result.structuredContent["sheets"]]
    assert all(sheet_path.parent.parent == tmp_path for sheet_path in sheet_paths)
    assert len(result.content) == 1 + len(sheet_paths) > 1


def test_plan_video_takes_a_null_as_not_given(video: Path) -> None:
    nulls = {"endSeconds": None, "timestampsSeconds": None, "area": None}

    result = call_tool(PLAN_VIDEO, {"path": str(video), **VALUES, **nulls})

    assert not result.isError
    assert result.structuredContent == plan_from_options(video, VALUES).to_dict()


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


def zoomed_image(result: types.CallToolResult) -> Image.Image:
    assert not result.isError
    text, image = result.content
    assert isinstance(text, types.TextContent)
    assert json.loads(text.text) == result.structuredContent
    assert isinstance(image, types.ImageContent)
    assert image.mimeType == "image/jpeg"
    return Image.open(io.BytesIO(base64.b64decode(image.data)))


def test_the_zoom_schema_takes_its_options_from_the_specs() -> None:
    specs = {spec["name"]: spec for spec in option_specs(host_capabilities())}
    schema = list_tools()[ZOOM_FRAME].inputSchema

    options = {"outputResolution", "jpegQuality"}
    sides = {"left", "top", "right", "bottom"}
    assert set(schema["properties"]) == {"path", "timeSeconds"} | sides | options
    assert schema["required"] == ["path", "timeSeconds"]
    for name in options:
        for bound, key in BOUNDS.items():
            assert schema["properties"][name].get(key) == specs[name].get(bound)
    assert "default" not in schema["properties"]["outputResolution"]


def test_zoom_frame_returns_the_whole_frame_at_its_own_size(video: Path) -> None:
    result = call_tool(ZOOM_FRAME, {"path": str(video), "timeSeconds": 1.25})

    assert zoomed_image(result).size == (160, 120)
    assert result.structuredContent == {
        "timestampSeconds": 1.3,
        "area": {"left": 0, "top": 0, "right": 1000, "bottom": 1000},
        "width": 160,
        "height": 120,
        "warnings": [],
    }


def test_zoom_frame_returns_an_area_at_twice_its_size_without_black_bars(video: Path) -> None:
    area = {"left": 0, "top": 400, "right": 1000, "bottom": 600}

    result = call_tool(ZOOM_FRAME, {"path": str(video), "timeSeconds": 1.25, **area})

    image = zoomed_image(result)
    assert image.size == (320, 48)
    assert result.structuredContent is not None
    assert result.structuredContent["area"] == area
    assert (result.structuredContent["width"], result.structuredContent["height"]) == image.size
    brightness = image.convert("L")
    for left, top in ((0, 0), (319, 0), (0, 47), (319, 47)):
        assert brightness.crop((left, top, left + 1, top + 1)).tobytes()[0] > 40


def test_zoom_frame_fits_the_image_to_an_output_resolution(video: Path) -> None:
    area = {"left": 100, "top": 100, "right": 300, "bottom": 300}
    arguments = {"path": str(video), "timeSeconds": 1, "outputResolution": 512, **area}

    image = zoomed_image(call_tool(ZOOM_FRAME, arguments))

    assert 480 < max(image.size) <= 512


def test_zoom_frame_saves_at_the_jpeg_quality(video: Path) -> None:
    def size(quality: int) -> int:
        arguments = {"path": str(video), "timeSeconds": 1, "jpegQuality": quality}
        _, image = call_tool(ZOOM_FRAME, arguments).content
        assert isinstance(image, types.ImageContent)
        return len(image.data)

    assert size(10) < size(95)


def test_zoom_frame_draws_nothing_over_the_picture(video: Path) -> None:
    values: dict[str, object] = {"timestampsSeconds": [1.25], "framesPerGrid": 1}
    planned = plan_from_options(video, {**values, "outputResolution": 176})
    [picture] = capture_frames(video, planned.plan, planned.info)
    assert picture is not None

    image = zoomed_image(call_tool(ZOOM_FRAME, {"path": str(video), "timeSeconds": 1.25}))

    encoded = io.BytesIO()
    picture.save(encoded, format="JPEG", quality=planned.plan.jpeg_quality)
    assert image.tobytes() == Image.open(encoded).tobytes()


def test_an_unreadable_frame_is_an_internal_error(
    video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreadable(*args: object) -> None:
        raise av.InvalidDataError(1094995529, "Invalid data found when processing input")

    monkeypatch.setattr(zoom, "capture_frames", unreadable)

    result = call_tool(ZOOM_FRAME, {"path": str(video), "timeSeconds": 1})

    assert result.isError
    assert result.structuredContent is not None
    assert result.structuredContent["code"] == "internal"
    assert result.structuredContent["message"].startswith(f"cannot read {video}: ")


def test_zoom_frame_leaves_no_files_behind(
    video: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    beside, temporary = tmp_path / "beside", tmp_path / "temporary"
    beside.mkdir()
    temporary.mkdir()
    copy = Path(shutil.copy(video, beside))
    monkeypatch.setattr(tempfile, "tempdir", str(temporary))

    result = call_tool(ZOOM_FRAME, {"path": str(copy), "timeSeconds": 1})

    assert not result.isError
    assert list(beside.iterdir()) == [copy]
    assert list(temporary.iterdir()) == []


@pytest.mark.parametrize(
    "nulls",
    [
        {"outputResolution": None, "jpegQuality": None},
        {"left": None, "top": None, "right": None, "bottom": None},
    ],
)
def test_zoom_frame_takes_a_null_as_not_given(video: Path, nulls: dict[str, object]) -> None:
    arguments = {"path": str(video), "timeSeconds": 1}

    assert call_tool(ZOOM_FRAME, {**arguments, **nulls}) == call_tool(ZOOM_FRAME, arguments)


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        ({"timeSeconds": None}, "timeSeconds must be a number"),
        (
            {"left": None, "top": 0, "right": 500, "bottom": 500},
            "left, top, right and bottom must be given together",
        ),
        ({"timeSeconds": "1"}, "timeSeconds must be a number"),
        ({"left": 100, "right": 300}, "left, top, right and bottom must be given together"),
        ({"fps": 2}, 'unknown option "fps"'),
        ({"area": [0, 0, 500, 500]}, 'unknown option "area"'),
    ],
)
def test_a_bad_zoom_argument_is_an_error_result(
    video: Path, bad: dict[str, object], message: str
) -> None:
    result = call_tool(ZOOM_FRAME, {"path": str(video), "timeSeconds": 1, **bad})

    assert result.isError
    assert result.structuredContent == {"code": "invalid_request", "message": message}


@pytest.mark.parametrize(
    ("bad", "option"),
    [
        ({"timeSeconds": 99}, {"timestampsSeconds": [99]}),
        ({"timeSeconds": -1}, {"timestampsSeconds": [-1]}),
        ({"left": 9, "top": 0, "right": 5, "bottom": 9}, {"area": [9, 0, 5, 9]}),
        ({"left": 0, "top": 0, "right": 1001, "bottom": 9}, {"area": [0, 0, 1001, 9]}),
        ({"jpegQuality": 0}, {"jpegQuality": 0}),
        ({"outputResolution": 2.5}, {"outputResolution": 2.5}),
    ],
)
def test_a_bad_zoom_value_is_an_error_result_with_cores_message(
    video: Path, bad: dict[str, object], option: dict[str, object]
) -> None:
    with pytest.raises(InvalidRequestError) as raised:
        plan_from_options(video, {"timestampsSeconds": [1], **option})

    result = call_tool(ZOOM_FRAME, {"path": str(video), "timeSeconds": 1, **bad})

    assert result.isError
    assert result.structuredContent == {"code": "invalid_request", "message": str(raised.value)}


def test_a_time_after_the_last_frame_is_a_no_frames_error(video: Path) -> None:
    result = call_tool(ZOOM_FRAME, {"path": str(video), "timeSeconds": 2.99})

    assert result.isError
    assert result.structuredContent == {
        "code": "no_frames",
        "message": "no frame could be captured at 2.99 seconds",
    }
