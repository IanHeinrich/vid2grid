import io
from collections.abc import Mapping, Sequence
from contextlib import closing
from dataclasses import dataclass

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
    values: dict[str, object] = {
        **options,
        "timestampsSeconds": [time_seconds],
        "framesPerGrid": 1,
        **({} if area is None else {"area": list(area)}),
    }
    planned = plan_from_options(path, values)
    if OUTPUT_RESOLUTION not in values:
        planned = plan_from_options(path, {**values, OUTPUT_RESOLUTION: _sheet_side(planned)})

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


# Never below the source's own pixels: an area may be enlarged, the whole frame never is.
def _sheet_side(planned: PlanResult) -> int:
    plan = planned.plan
    planned_side = max(plan.cell.as_tuple())
    border = plan.canvas.width - planned_side
    if plan.crop is None:
        return max(planned.info.width, planned.info.height) + border
    source_side = max(plan.crop.width, plan.crop.height)
    return max(source_side, min(_MAX_ENLARGEMENT * source_side, planned_side)) + border


# The plan's timestamp is the one asked for; the frame shown is the first at or after it.
def _captured_seconds(path: str, planned: PlanResult) -> float:
    with closing(iter_source_frames(path, planned.plan, planned.info)) as frames:
        return round(next(frames).time, 6)


def _jpeg(picture: Image.Image, quality: int) -> bytes:
    encoded = io.BytesIO()
    picture.save(encoded, format="JPEG", quality=quality)
    return encoded.getvalue()
