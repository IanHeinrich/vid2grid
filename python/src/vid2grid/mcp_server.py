from collections.abc import Mapping, Sequence
from typing import Any

import anyio
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server

from ._core import OptionSpec, option_specs
from .contract import VID2GRID_VERSION
from .errors import InvalidRequestError, Vid2GridError
from .options import host_capabilities, plan_from_options, render_from_options

VIDEO_TO_SHEETS = "video_to_sheets"
PLAN_VIDEO = "plan_video"

_PATH = "path"
_OUT_DIR = "outDir"
_BOUNDS = (("min", "minimum"), ("max", "maximum"), ("exclusiveMin", "exclusiveMinimum"))


def create_server() -> Server[Any, Any]:
    server: Server[Any, Any] = Server("vid2grid", VID2GRID_VERSION)

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
                    "count, the timings and the vid2grid version."
                ),
                inputSchema=_input_schema(specs, with_out_dir=True),
            ),
            types.Tool(
                name=PLAN_VIDEO,
                description=(
                    "Plan a local video's collage sheets without rendering them. Returns the "
                    "RenderPlan, with every sheet's file name and the timestamp of each frame "
                    "on it, and any warnings, so the sheet count can be checked before calling "
                    "video_to_sheets."
                ),
                inputSchema=_input_schema(specs, with_out_dir=False),
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


def _input_schema(specs: Sequence[OptionSpec], *, with_out_dir: bool) -> dict[str, object]:
    properties: dict[str, object] = {
        _PATH: {"type": "string", "description": "path to the video file"}
    }
    if with_out_dir:
        properties[_OUT_DIR] = {
            "type": "string",
            "description": "folder for the sheets, a new folder beside the video when omitted",
        }
    properties.update({spec["name"]: _option_property(spec) for spec in specs})
    return {
        "type": "object",
        "properties": properties,
        "required": [_PATH],
        "additionalProperties": False,
    }


def _option_property(spec: OptionSpec) -> dict[str, object]:
    schema: dict[str, object] = (
        {"type": "string", "enum": spec["values"]}
        if spec["type"] == "enum"
        else {"type": spec["type"]}
    )
    fields: Mapping[str, object] = spec
    schema.update({key: fields[name] for name, key in _BOUNDS if name in fields})
    schema["description"] = spec["help"]
    if "default" in fields:
        schema["default"] = fields["default"]
    return schema


def _video_to_sheets(arguments: Mapping[str, object]) -> dict[str, object]:
    path = _string_argument(arguments, _PATH)
    out_dir = _string_argument(arguments, _OUT_DIR) if _OUT_DIR in arguments else None
    values = {name: value for name, value in arguments.items() if name not in (_PATH, _OUT_DIR)}
    return render_from_options(path, out_dir, values).to_dict()


def _plan_video(arguments: Mapping[str, object]) -> dict[str, object]:
    path = _string_argument(arguments, _PATH)
    values = {name: value for name, value in arguments.items() if name != _PATH}
    return plan_from_options(path, values).to_dict()


def _string_argument(arguments: Mapping[str, object], name: str) -> str:
    value = arguments.get(name)
    if not isinstance(value, str) or not value:
        raise InvalidRequestError(f"{name} must be a non-empty string")
    return value


def _error_result(error: Vid2GridError) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=f"{error.code}: {error}")],
        structuredContent={"code": error.code, "message": str(error)},
        isError=True,
    )
