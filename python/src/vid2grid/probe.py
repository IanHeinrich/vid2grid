import math
from fractions import Fraction
from pathlib import Path
from typing import Any

import av

from .contract import VideoInfo
from .planner import round_to_microseconds

_QUARTER_TURNS = (90, 270)


def pyav_attr(obj: object, name: str) -> Any:
    """Read a PyAV attribute, naming it if a wheel bump moved it."""
    try:
        return getattr(obj, name)
    except AttributeError as exc:
        raise RuntimeError(f"PyAV {av.__version__} has no {type(obj).__name__}.{name}") from exc


def probe(path: str | Path, *, keyframes: bool = False) -> VideoInfo:
    """Read one video's duration, display-oriented size, frame rate, codec and rotation."""
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        rotation = normalize_rotation_clockwise(_display_rotation_ccw(container, stream))
        width, height = display_size(
            pyav_attr(stream.codec_context, "width"),
            pyav_attr(stream.codec_context, "height"),
            pyav_attr(stream, "sample_aspect_ratio"),
            rotation,
        )
        return VideoInfo(
            duration_seconds=_duration_seconds(container, stream),
            width=width,
            height=height,
            keyframe_timestamps_seconds=(
                _keyframe_timestamps(container, stream) if keyframes else None
            ),
            fps=_frame_rate(stream),
            codec=pyav_attr(stream.codec_context, "name"),
            rotation=rotation,
        )


def display_size(
    coded_width: int,
    coded_height: int,
    sample_aspect_ratio: Fraction | None,
    rotation: int,
) -> tuple[int, int]:
    """The size a player shows, matching the browser's `video.videoWidth/videoHeight`."""
    # ffmpeg's convention stretches the width by the sample aspect ratio, never the height.
    width = (
        coded_width
        if sample_aspect_ratio is None or sample_aspect_ratio == 1
        else round(coded_width * sample_aspect_ratio)
    )
    if rotation in _QUARTER_TURNS:
        return coded_height, width
    return width, coded_height


def normalize_rotation_clockwise(ccw_degrees: float) -> int:
    """Turn ffmpeg's counter-clockwise display rotation into 0, 90, 180 or 270 clockwise."""
    # ffmpeg reports the rotation to apply counter-clockwise while every executor of this
    # contract rotates clockwise, so the sign flips. floor(x + 0.5) is JavaScript's Math.round.
    quarters = math.floor(-ccw_degrees / 90 + 0.5)
    return int(quarters * 90) % 360


def _display_rotation_ccw(container: Any, stream: Any) -> float:
    rotate = stream.metadata.get("rotate")
    if rotate is not None:
        # The container's "rotate" tag is clockwise where a display matrix is counter-clockwise.
        return -float(rotate)
    # PyAV 14+ dropped stream-level side data, so the display matrix is only readable off a
    # decoded frame; rewind afterwards so a keyframe walk still sees the whole stream.
    try:
        frame = next(container.decode(stream), None)
    except av.FFmpegError:
        return 0.0
    finally:
        container.seek(0)
    return 0.0 if frame is None else float(pyav_attr(frame, "rotation"))


def _duration_seconds(container: Any, stream: Any) -> float:
    if container.duration is not None:
        return container.duration / av.time_base
    if stream.duration is not None:
        return float(stream.duration * stream.time_base)
    return 0.0


def _frame_rate(stream: Any) -> float:
    rate = pyav_attr(stream, "average_rate") or pyav_attr(stream, "guessed_rate")
    return 0.0 if rate is None else float(rate)


def _keyframe_timestamps(container: Any, stream: Any) -> tuple[float, ...]:
    # Composition time, so it lines up with the browser demuxer's sample `cts`; demux order
    # is decode order, hence the sort.
    timestamps = [
        round_to_microseconds(float(packet.pts * stream.time_base))
        for packet in container.demux(stream)
        if packet.pts is not None and packet.is_keyframe
    ]
    return tuple(sorted(timestamps))
