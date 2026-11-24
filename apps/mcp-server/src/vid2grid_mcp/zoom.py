import io
from collections.abc import Mapping, Sequence
from contextlib import closing
from dataclasses import dataclass, replace

import av
from PIL import Image
from vid2grid import InternalError, NoFramesError, PlanResult, capture_frames, plan_from_options
from vid2grid.capture import iter_source_frames

SIDES = ("left", "top", "right", "bottom")
OUTPUT_RESOLUTION = "outputResolution"
JPEG_QUALITY = "jpegQuality"

_WHOLE_FRAME = (0.0, 0.0, 1000.0, 1000.0)
_MAX_ENLARGEMENT = 2


@dataclass(frozen=True, slots=True, kw_only=True)
class ZoomedFrame:
    jpeg: bytes
    timestamp_seconds: float
    area: Sequence[float]
    width: int
    height: int
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "timestampSeconds": self.timestamp_seconds,
            "area": dict(zip(SIDES, self.area, strict=True)),
            "width": self.width,
            "height": self.height,
            "warnings": list(self.warnings),
        }


def zoom_frame(
    path: str, time_seconds: float, area: Sequence[float] | None, options: Mapping[str, object]
) -> ZoomedFrame:
    planned = _plan(path, time_seconds, area, options)
    try:
        [picture] = capture_frames(path, planned.plan, planned.info)
        if picture is None:
            raise NoFramesError(f"no frame could be captured at {time_seconds} seconds")
        captured_seconds = _captured_seconds(path, planned)
    except av.FFmpegError as exc:
        raise InternalError(f"cannot read {path}: {exc}") from exc

    return ZoomedFrame(
        jpeg=_jpeg(picture, planned.plan.jpeg_quality),
        timestamp_seconds=captured_seconds,
        area=_WHOLE_FRAME if area is None else area,
        width=picture.width,
        height=picture.height,
        warnings=planned.warnings,
    )


def _plan(
    path: str, time_seconds: float, area: Sequence[float] | None, options: Mapping[str, object]
) -> PlanResult:
    whole_frame = {**options, "timestampsSeconds": [time_seconds], "framesPerGrid": 1}
    values = whole_frame if area is None else {**whole_frame, "area": list(area)}
    if OUTPUT_RESOLUTION in options:
        return plan_from_options(path, values)

    planned = plan_from_options(path, whole_frame)
    default_side = max(planned.plan.cell.as_tuple())
    if area is None:
        return _with_cell(planned, planned.info.width, planned.info.height)
    # Core rejects an area too thin for its cell, and no area is too thin for a cell this long.
    roomy = planned.plan.canvas.width + 2 * max(planned.info.width, planned.info.height)
    planned = plan_from_options(path, {**values, OUTPUT_RESOLUTION: roomy})
    shown = planned.plan.crop or planned.info
    scale = max(1.0, min(_MAX_ENLARGEMENT, default_side / max(shown.width, shown.height)))
    return _with_cell(planned, round(shown.width * scale), round(shown.height * scale))


# Core's grid maths can truncate a pixel off a cell.
def _with_cell(planned: PlanResult, width: int, height: int) -> PlanResult:
    cell = replace(planned.plan.cell, width=width, height=height)
    return replace(planned, plan=replace(planned.plan, cell=cell))


# The plan's timestamp is the one asked for; the frame shown is the first at or after it.
def _captured_seconds(path: str, planned: PlanResult) -> float:
    with closing(iter_source_frames(path, planned.plan, planned.info)) as frames:
        return round(next(frames).time, 6)


def _jpeg(picture: Image.Image, quality: int) -> bytes:
    encoded = io.BytesIO()
    picture.save(encoded, format="JPEG", quality=quality)
    return encoded.getvalue()
