import warnings
from pathlib import Path

from .capture import capture_frames
from .contract import (
    VID2GRID_VERSION,
    CollageRequest,
    PlannedSheet,
    RenderPlan,
    VideoInfo,
)
from .errors import (
    InternalError,
    InvalidRequestError,
    NoFramesError,
    Vid2GridError,
    Vid2GridErrorCode,
)
from .planner import build_render_plan
from .probe import probe_video
from .render import paint_sheet
from .sheets import RenderResult, SheetResult, render_sheets, render_single_sheet

__version__ = VID2GRID_VERSION


def probe(path: str | Path, *, keyframes: bool = False) -> VideoInfo:
    warnings.warn(
        "vid2grid.probe is deprecated, use vid2grid.probe_video", DeprecationWarning, stacklevel=2
    )
    return probe_video(path, keyframes=keyframes)


__all__ = [
    "CollageRequest",
    "InternalError",
    "InvalidRequestError",
    "NoFramesError",
    "PlannedSheet",
    "RenderPlan",
    "RenderResult",
    "SheetResult",
    "Vid2GridError",
    "Vid2GridErrorCode",
    "VideoInfo",
    "__version__",
    "build_render_plan",
    "capture_frames",
    "paint_sheet",
    "probe",
    "probe_video",
    "render_sheets",
    "render_single_sheet",
]
