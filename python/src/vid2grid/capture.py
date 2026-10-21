import itertools
import statistics
from collections.abc import Generator, Iterator, Sequence
from contextlib import closing
from pathlib import Path

import av
from av.container import InputContainer
from av.video.codeccontext import VideoCodecContext
from av.video.frame import VideoFrame
from av.video.stream import VideoStream
from PIL import Image

from ._core import is_keyframe_plan
from .contract import RenderPlan, Size, VideoInfo, is_quarter_turn
from .errors import InternalError
from .probe import round_to_microseconds, stream_time_base

_DEFAULT_KEYFRAME_INTERVAL_SECONDS = 2.0
_RESEEK_AFTER_KEYFRAME_INTERVALS = 2
_MIN_RESEEK_GAP_SECONDS = 1.0

_Matches = Iterator[tuple[int, VideoFrame]]


def capture_frames(path: str | Path, plan: RenderPlan, info: VideoInfo) -> list[Image.Image | None]:
    images: list[Image.Image | None] = list(iter_frame_images(path, plan, info))
    return images + [None] * (len(plan.frames) - len(images))


# Yields one cell-sized image per `plan.frames` entry in order, stopping early where the
# stream ends, so a caller can hold one sheet's images at a time.
def iter_frame_images(
    path: str | Path, plan: RenderPlan, info: VideoInfo
) -> Generator[Image.Image, None, None]:
    with closing(iter_source_frames(path, plan, info)) as frames:
        for frame in frames:
            yield _to_cell_image(frame, plan.cell, info.rotation)


# The decoded source frame each planned frame picks, before scaling; conformance tests read
# its presentation time.
def iter_source_frames(
    path: str | Path, plan: RenderPlan, info: VideoInfo
) -> Generator[VideoFrame, None, None]:
    wanted = [frame.timestamp_seconds for frame in plan.frames]
    if not wanted:
        return

    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        matches = (
            _match_keyframes(container, stream, wanted)
            if is_keyframe_plan(plan, info.keyframe_timestamps_seconds)
            else _match_sampled(container, stream, wanted, info)
        )
        for _, frame in matches:
            yield frame


def _match_keyframes(
    container: InputContainer, stream: VideoStream, wanted: Sequence[float]
) -> _Matches:
    _skip_non_keyframes(stream.codec_context)
    next_index = 0
    for frame in _decoded_frames(container, stream):
        next_index = yield from _reached_by(frame, wanted, next_index)
        if next_index >= len(wanted):
            return


def _skip_non_keyframes(codec_context: VideoCodecContext) -> None:
    try:
        codec_context.skip_frame = "NONKEY"
    except (AttributeError, ValueError) as exc:
        raise InternalError(f"PyAV {av.__version__} rejects skip_frame='NONKEY'") from exc


def _match_sampled(
    container: InputContainer, stream: VideoStream, wanted: Sequence[float], info: VideoInfo
) -> _Matches:
    gap_seconds = max(
        _RESEEK_AFTER_KEYFRAME_INTERVALS * _keyframe_interval_seconds(info),
        _MIN_RESEEK_GAP_SECONDS,
    )
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
        next_index = yield from _reached_by(frame, wanted, next_index)


def _reached_by(
    frame: VideoFrame, wanted: Sequence[float], next_index: int
) -> Generator[tuple[int, VideoFrame], None, int]:
    # Rounded because the browser matches against whole-microsecond VideoFrame timestamps.
    while next_index < len(wanted) and round_to_microseconds(frame.time) >= wanted[next_index]:
        yield next_index, frame
        next_index += 1
    return next_index


def _seeked_frames(
    container: InputContainer, stream: VideoStream, target: float
) -> Iterator[VideoFrame]:
    container.seek(int(target / stream_time_base(stream)), stream=stream)
    frames = _decoded_frames(container, stream)
    first = next(frames, None)
    if first is not None:
        return itertools.chain([first], frames)
    # Seeking past the last keyframe can leave nothing to decode even though the file has frames.
    container.seek(0, stream=stream)
    return _decoded_frames(container, stream)


def _decoded_frames(container: InputContainer, stream: VideoStream) -> Iterator[VideoFrame]:
    return (frame for frame in container.decode(stream) if frame.pts is not None)


def _keyframe_interval_seconds(info: VideoInfo) -> float:
    keyframes = info.keyframe_timestamps_seconds
    if keyframes is None or len(keyframes) < 2:
        return _DEFAULT_KEYFRAME_INTERVAL_SECONDS
    deltas = [later - earlier for earlier, later in itertools.pairwise(keyframes)]
    return statistics.median(deltas)


def _to_cell_image(frame: VideoFrame, cell: Size, rotation: int) -> Image.Image:
    turned = is_quarter_turn(rotation)
    scaled = frame.reformat(
        width=cell.height if turned else cell.width,
        height=cell.width if turned else cell.height,
        format="rgb24",
        interpolation="BICUBIC",
    )
    image: Image.Image = scaled.to_image()
    # Pillow's rotate turns counter-clockwise; VideoInfo.rotation is clockwise. At whole quarter
    # turns with expand=True it is a lossless transpose.
    return image if rotation == 0 else image.rotate(-rotation, expand=True)
