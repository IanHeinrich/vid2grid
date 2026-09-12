import itertools
import statistics
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

import av
from PIL import Image

from .contract import RenderPlan, Size, VideoInfo
from .probe import pyav_attr

_DEFAULT_KEYFRAME_INTERVAL_SECONDS = 2.0

# Planned timestamps are rounded to microseconds, so the very frame a timestamp was derived
# from can sit a fraction of a microsecond below it and fail a bare at-or-after test.
_TIMESTAMP_EPSILON = 1e-6

# Pillow's ROTATE_n turns counter-clockwise; VideoInfo.rotation is clockwise.
_ROTATION_TRANSPOSE = {
    90: Image.Transpose.ROTATE_270,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_90,
}


def capture_frames(path: str | Path, plan: RenderPlan, info: VideoInfo) -> list[Image.Image | None]:
    """One cell-sized image per `plan.frames` entry, `None` where the stream ended first."""
    wanted = [frame.timestamp_seconds for frame in plan.frames]
    images: list[Image.Image | None] = [None] * len(wanted)
    if not wanted:
        return images

    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        matches = (
            _match_keyframes(container, stream, wanted)
            if _is_keyframe_plan(wanted, info)
            else _match_sampled(container, stream, wanted, info)
        )
        for index, frame in matches:
            images[index] = _to_cell_image(frame, plan.cell, info.rotation)
    return images


def _is_keyframe_plan(wanted: Sequence[float], info: VideoInfo) -> bool:
    keyframes = info.keyframe_timestamps_seconds
    return keyframes is not None and set(wanted) <= set(keyframes)


def _match_keyframes(
    container: Any, stream: Any, wanted: Sequence[float]
) -> Iterator[tuple[int, Any]]:
    _skip_non_keyframes(stream.codec_context)
    return _match_in_order(_decoded_frames(container, stream), wanted)


def _skip_non_keyframes(codec_context: Any) -> None:
    try:
        codec_context.skip_frame = "NONKEY"
    except (AttributeError, ValueError) as exc:
        raise RuntimeError(f"PyAV {av.__version__} rejects skip_frame='NONKEY'") from exc


def _match_sampled(
    container: Any, stream: Any, wanted: Sequence[float], info: VideoInfo
) -> Iterator[tuple[int, Any]]:
    gap_seconds = max(2 * _keyframe_interval_seconds(info), 1.0)
    frames = _seeked_frames(container, stream, wanted[0])
    seeked_at_index = 0
    last_time: float | None = None
    next_index = 0

    while next_index < len(wanted):
        if (
            last_time is not None
            and seeked_at_index != next_index
            and wanted[next_index] - last_time > gap_seconds
        ):
            frames = _seeked_frames(container, stream, wanted[next_index])
            seeked_at_index = next_index
            last_time = None

        frame = next(frames, None)
        if frame is None:
            return
        last_time = frame.time
        while next_index < len(wanted) and frame.time >= wanted[next_index] - _TIMESTAMP_EPSILON:
            yield next_index, frame
            next_index += 1


def _match_in_order(frames: Iterator[Any], wanted: Sequence[float]) -> Iterator[tuple[int, Any]]:
    next_index = 0
    for frame in frames:
        while next_index < len(wanted) and frame.time >= wanted[next_index] - _TIMESTAMP_EPSILON:
            yield next_index, frame
            next_index += 1
        if next_index >= len(wanted):
            return


def _seeked_frames(container: Any, stream: Any, target: float) -> Iterator[Any]:
    container.seek(int(target / stream.time_base), stream=stream)
    frames = _decoded_frames(container, stream)
    first = next(frames, None)
    if first is not None:
        return itertools.chain([first], frames)
    # Seeking past the last keyframe can leave nothing to decode even though the file has frames.
    container.seek(0, stream=stream)
    return _decoded_frames(container, stream)


def _decoded_frames(container: Any, stream: Any) -> Iterator[Any]:
    return (frame for frame in container.decode(stream) if frame.pts is not None)


def _keyframe_interval_seconds(info: VideoInfo) -> float:
    keyframes = info.keyframe_timestamps_seconds
    if keyframes is None or len(keyframes) < 2:
        return _DEFAULT_KEYFRAME_INTERVAL_SECONDS
    deltas = [later - earlier for earlier, later in zip(keyframes, keyframes[1:], strict=False)]
    return statistics.median(deltas)


def _to_cell_image(frame: Any, cell: Size, rotation: int) -> Image.Image:
    turned = rotation in (90, 270)
    scaled = pyav_attr(frame, "reformat")(
        width=cell.height if turned else cell.width,
        height=cell.width if turned else cell.height,
        format="rgb24",
        interpolation="BICUBIC",
    )
    image = scaled.to_image()
    transpose = _ROTATION_TRANSPOSE.get(rotation)
    return image if transpose is None else image.transpose(transpose)
