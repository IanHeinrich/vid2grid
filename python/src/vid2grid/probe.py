import logging
import math
import warnings
from fractions import Fraction
from pathlib import Path

import av
from av.container import InputContainer
from av.video.stream import VideoStream

from ._core import display_size as display_size
from ._core import normalize_rotation_clockwise as normalize_rotation_clockwise
from .contract import VideoInfo
from .errors import InternalError

_log = logging.getLogger(__name__)


def probe_video(path: str | Path, *, keyframes: bool = False) -> VideoInfo:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        rotation = normalize_rotation_clockwise(_display_rotation_ccw(container, stream))
        width, height = display_size(
            stream.codec_context.width,
            stream.codec_context.height,
            _sample_aspect_ratio(stream),
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
            codec=stream.codec_context.name,
            rotation=rotation,
        )


def probe(path: str | Path, *, keyframes: bool = False) -> VideoInfo:
    warnings.warn(
        "vid2grid.probe is deprecated, use vid2grid.probe_video", DeprecationWarning, stacklevel=2
    )
    return probe_video(path, keyframes=keyframes)


def read_keyframe_timestamps(path: str | Path) -> tuple[float, ...]:
    with av.open(str(path)) as container:
        return _keyframe_timestamps(container, container.streams.video[0])


def stream_time_base(stream: VideoStream) -> Fraction:
    if stream.time_base is None:
        raise InternalError("the video stream has no time base")
    return Fraction(stream.time_base.numerator, stream.time_base.denominator)


# Per-frame calls into V8 would be slow, so core's rule, floor(x * 1e6 + 0.5), is mirrored here.
def round_to_microseconds(seconds: float) -> float:
    return math.floor(seconds * 1e6 + 0.5) / 1e6


def _sample_aspect_ratio(stream: VideoStream) -> Fraction | None:
    # PyAV 19 reports an unset ratio as ffmpeg's 0/1 where PyAV 18 gave None.
    ratio = getattr(stream, "sample_aspect_ratio", None)
    if ratio is None or ratio.numerator == 0:
        return None
    return Fraction(ratio.numerator, ratio.denominator)


def _display_rotation_ccw(container: InputContainer, stream: VideoStream) -> float:
    rotate = stream.metadata.get("rotate")
    if rotate is not None:
        # The container's "rotate" tag is clockwise where a display matrix is counter-clockwise.
        return -float(rotate)
    # PyAV 14+ dropped stream-level side data, so the display matrix is only readable off a
    # decoded frame; rewind afterwards so a keyframe walk still sees the whole stream.
    try:
        frame = next(container.decode(stream), None)
    except av.FFmpegError as exc:
        _log.warning(
            "could not decode a frame to read the display rotation, assuming none: %s", exc
        )
        return 0.0
    finally:
        container.seek(0)
    return 0.0 if frame is None else float(frame.rotation)


def _duration_seconds(container: InputContainer, stream: VideoStream) -> float:
    if container.duration is not None:
        return float(container.duration / av.time_base)
    if stream.duration is not None and stream.time_base is not None:
        return float(stream.duration * stream.time_base)
    return 0.0


def _frame_rate(stream: VideoStream) -> float:
    rate = stream.average_rate or stream.guessed_rate
    return 0.0 if rate is None else float(rate)


def _keyframe_timestamps(container: InputContainer, stream: VideoStream) -> tuple[float, ...]:
    # Composition time, so it lines up with the browser demuxer's sample `cts`; demux order
    # is decode order, hence the sort.
    time_base = stream_time_base(stream)
    timestamps = [
        round_to_microseconds(float(packet.pts * time_base))
        for packet in container.demux(stream)
        if packet.pts is not None and packet.is_keyframe
    ]
    return tuple(sorted(timestamps))
