import base64
import json
from collections.abc import Mapping, Sequence
from typing import Any

import anyio
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from vid2grid import (
    InvalidRequestError,
    OptionSpec,
    Vid2GridError,
    __version__,
    host_capabilities,
    option_specs,
    plan_from_options,
    render_from_options,
)

from .zoom import JPEG_QUALITY, OUTPUT_RESOLUTION, SIDES, zoom_frame

VIDEO_TO_SHEETS = "video_to_sheets"
PLAN_VIDEO = "plan_video"
ZOOM_FRAME = "zoom_frame"

_PATH = "path"
_OUT_DIR = "outDir"
_INCLUDE_IMAGES = "includeImages"
_MAX_INLINE_SHEETS = 10
_TIME_SECONDS = "timeSeconds"
_ZOOM_OPTIONS = (OUTPUT_RESOLUTION, JPEG_QUALITY)
_BOUNDS = (("min", "minimum"), ("max", "maximum"), ("exclusiveMin", "exclusiveMinimum"))
_ITEM_COUNTS = ("minItems", "maxItems")


def create_server() -> Server[Any, Any]:
    server: Server[Any, Any] = Server("vid2grid", __version__)

    # The SDK leaves its handler decorators unannotated.
    @server.list_tools()  # type: ignore[no-untyped-call, untyped-decorator]
    async def list_tools() -> list[types.Tool]:
        specs = option_specs(host_capabilities())
        return [
            types.Tool(
                name=VIDEO_TO_SHEETS,
                description=(
                    "Turn a local video into collage sheets: grid JPEGs of timestamped frames "
                    "sized for a vision model. Returns each sheet's path with the first and last "
                    "timestamp captured on it, any transcript paths, any warnings, the frame "
                    "count, the timings and the vid2grid version, and the sheets themselves as "
                    f"images when there are at most {_MAX_INLINE_SHEETS} and includeImages is not "
                    "false. For a long video, start with a few sheets over all of it by setting "
                    "frameCount, then render the ranges that matter."
                ),
                inputSchema=_input_schema(specs, with_render_options=True),
            ),
            types.Tool(
                name=PLAN_VIDEO,
                description=(
                    "Plan a local video's collage sheets without rendering them. Returns the "
                    "RenderPlan, with every sheet's file name and the timestamp of each frame "
                    "on it, and any warnings, so the sheet count can be checked before calling "
                    "video_to_sheets."
                ),
                inputSchema=_input_schema(specs, with_render_options=False),
            ),
            types.Tool(
                name=ZOOM_FRAME,
                description=(
                    "Look closely at one moment of a local video: one frame, or part of it, as an "
                    "image. Look at sheets from video_to_sheets first to find the moment, then "
                    "zoom into it. left, top, right and bottom choose the part to show, in "
                    "thousandths from the top left: 0 to 1000 across and down the whole frame, "
                    "not the sheet it was seen on. Give all four, or none for the whole frame at "
                    "full size. Returns the image with the timestamp really captured, the area, "
                    "the image's size in pixels and any warnings. No files are written."
                ),
                inputSchema=_zoom_schema(specs),
            ),
        ]

    # Core is the one validator, so a bad value gets its message rather than jsonschema's.
    @server.call_tool(validate_input=False)  # type: ignore[untyped-decorator]
    async def call_tool(
        name: str, arguments: dict[str, Any]
    ) -> dict[str, object] | types.CallToolResult:
        try:
            if name == VIDEO_TO_SHEETS:
                return await anyio.to_thread.run_sync(_video_to_sheets, arguments)
            if name == PLAN_VIDEO:
                return await anyio.to_thread.run_sync(_plan_video, arguments)
            if name == ZOOM_FRAME:
                return await anyio.to_thread.run_sync(_zoom_frame, arguments)
        except Vid2GridError as error:
            return _error_result(error)
        raise ValueError(f"unknown tool: {name}")

    return server


def main() -> None:
    anyio.run(_serve)


async def _serve() -> None:
    server = create_server()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def _input_schema(specs: Sequence[OptionSpec], *, with_render_options: bool) -> dict[str, object]:
    properties: dict[str, object] = {_PATH: _path_property()}
    if with_render_options:
        properties[_OUT_DIR] = {
            "type": "string",
            "description": "folder for the sheets, a new folder beside the video when omitted",
        }
        properties[_INCLUDE_IMAGES] = {
            "type": "boolean",
            "default": True,
            "description": (
                "return the sheets as images as well as paths; past "
                f"{_MAX_INLINE_SHEETS} sheets only the paths come back"
            ),
        }
    properties.update({spec["name"]: _option_property(spec) for spec in specs})
    return _object_schema(properties, required=[_PATH])


def _zoom_schema(specs: Sequence[OptionSpec]) -> dict[str, object]:
    options = {
        spec["name"]: _option_property(spec) for spec in specs if spec["name"] in _ZOOM_OPTIONS
    }
    resolution = options[OUTPUT_RESOLUTION]
    resolution.pop("default", None)
    resolution["description"] = (
        "side in pixels of a square the image fits inside; when omitted, the whole frame keeps its "
        "own size and an area is shown at up to twice its size"
    )
    return _object_schema(
        {
            _PATH: _path_property(),
            _TIME_SECONDS: {
                "type": "number",
                "minimum": 0,
                "description": "time in seconds; the first frame at or after it is shown",
            },
            **{side: _side_property(side) for side in SIDES},
            **options,
        },
        required=[_PATH, _TIME_SECONDS],
    )


def _side_property(side: str) -> dict[str, object]:
    direction = "across" if side in ("left", "right") else "down"
    return {
        "type": "number",
        "minimum": 0,
        "maximum": 1000,
        "description": f"{side} edge of the area, 0 to 1000 {direction} the whole frame",
    }


def _path_property() -> dict[str, object]:
    return {"type": "string", "description": "path to the video file"}


def _object_schema(properties: Mapping[str, object], *, required: list[str]) -> dict[str, object]:
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def _option_property(spec: OptionSpec) -> dict[str, object]:
    fields: Mapping[str, object] = spec
    schema = _option_type(spec)
    schema.update({key: fields[name] for name, key in _BOUNDS if name in fields})
    schema["description"] = spec["help"]
    if "default" in fields:
        schema["default"] = fields["default"]
    return schema


def _option_type(spec: OptionSpec) -> dict[str, object]:
    if spec["type"] == "enum":
        return {"type": "string", "enum": spec["values"]}
    if spec["type"] == "numberList":
        fields: Mapping[str, object] = spec
        item_fields: Mapping[str, object] = spec["items"]
        items = {key: item_fields[name] for name, key in _BOUNDS if name in item_fields}
        counts = {name: fields[name] for name in _ITEM_COUNTS if name in fields}
        return {"type": "array", "items": {"type": "number", **items}, **counts}
    return {"type": spec["type"]}


def _video_to_sheets(arguments: Mapping[str, object]) -> types.CallToolResult:
    arguments = _without_nulls(arguments)
    path = _string_argument(arguments, _PATH)
    out_dir = _string_argument(arguments, _OUT_DIR) if _OUT_DIR in arguments else None
    include_images = (
        _boolean_argument(arguments, _INCLUDE_IMAGES) if _INCLUDE_IMAGES in arguments else True
    )
    mcp_only = (_PATH, _OUT_DIR, _INCLUDE_IMAGES)
    values = {name: value for name, value in arguments.items() if name not in mcp_only}
    result = render_from_options(path, out_dir, values)
    structured = result.to_dict()
    content: list[types.ContentBlock] = [
        types.TextContent(type="text", text=json.dumps(structured, indent=2))
    ]
    if include_images and len(result.sheets) > _MAX_INLINE_SHEETS:
        content.append(types.TextContent(type="text", text=_too_many_to_inline(len(result.sheets))))
    elif include_images:
        content.extend(_jpeg_image(sheet.path.read_bytes()) for sheet in result.sheets)
    return types.CallToolResult(content=content, structuredContent=structured)


def _too_many_to_inline(sheet_count: int) -> str:
    return (
        f"{sheet_count} sheets are more than the {_MAX_INLINE_SHEETS} returned as images. They are "
        "saved at the paths above. To see them here, set frameCount or render a shorter range."
    )


def _jpeg_image(jpeg: bytes) -> types.ImageContent:
    data = base64.b64encode(jpeg).decode("ascii")
    return types.ImageContent(type="image", data=data, mimeType="image/jpeg")


def _plan_video(arguments: Mapping[str, object]) -> dict[str, object]:
    path = _string_argument(arguments, _PATH)
    values = {name: value for name, value in arguments.items() if name != _PATH}
    return plan_from_options(path, values).to_dict()


def _zoom_frame(arguments: Mapping[str, object]) -> types.CallToolResult:
    arguments = _without_nulls(arguments)
    path = _string_argument(arguments, _PATH)
    time_seconds = _number_argument(arguments, _TIME_SECONDS)
    options = {name: value for name, value in arguments.items() if name in _ZOOM_OPTIONS}
    for name in arguments:
        if name not in (_PATH, _TIME_SECONDS, *SIDES, *_ZOOM_OPTIONS):
            raise InvalidRequestError(f'unknown option "{name}"')
    zoomed = zoom_frame(path, time_seconds, _area_argument(arguments), options)
    structured = zoomed.to_dict()
    text = types.TextContent(type="text", text=json.dumps(structured, indent=2))
    return types.CallToolResult(
        content=[text, _jpeg_image(zoomed.jpeg)], structuredContent=structured
    )


def _area_argument(arguments: Mapping[str, object]) -> list[float] | None:
    given = [side for side in SIDES if side in arguments]
    if not given:
        return None
    if len(given) < len(SIDES):
        raise InvalidRequestError("left, top, right and bottom must be given together")
    return [_number_argument(arguments, side) for side in SIDES]


def _without_nulls(arguments: Mapping[str, object]) -> dict[str, object]:
    return {name: value for name, value in arguments.items() if value is not None}


def _string_argument(arguments: Mapping[str, object], name: str) -> str:
    value = arguments.get(name)
    if not isinstance(value, str) or not value:
        raise InvalidRequestError(f"{name} must be a non-empty string")
    return value


def _boolean_argument(arguments: Mapping[str, object], name: str) -> bool:
    value = arguments.get(name)
    if not isinstance(value, bool):
        raise InvalidRequestError(f"{name} must be a boolean")
    return value


def _number_argument(arguments: Mapping[str, object], name: str) -> float:
    value = arguments.get(name)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise InvalidRequestError(f"{name} must be a number")
    return value


def _error_result(error: Vid2GridError) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=f"{error.code}: {error}")],
        structuredContent={"code": error.code, "message": str(error)},
        isError=True,
    )
