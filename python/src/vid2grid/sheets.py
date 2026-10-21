import itertools
import time
from collections.abc import Sequence
from contextlib import closing
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .capture import iter_frame_images
from .contract import VID2GRID_VERSION, CollageRequest, PlannedSheet, RenderPlan, VideoInfo
from .errors import NoFramesError
from .planner import build_render_plan, validate_request
from .probe import probe_video
from .render import paint_sheet, save_jpeg

_KEYFRAME_FALLBACK_WARNING = (
    "keyframe_sampling: no keyframes were found in the requested range, sampled by time instead"
)


@dataclass(frozen=True, slots=True, kw_only=True)
class _Rendered:
    info: VideoInfo
    frame_count: int
    first_timestamp_seconds: float | None
    last_timestamp_seconds: float | None
    timings_ms: dict[str, int]
    vid2grid_version: str
    plan: RenderPlan
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class RenderResult(_Rendered):
    sheet_paths: tuple[Path, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class SheetResult(_Rendered):
    sheet_path: Path

    def to_sheet_row(self, sheet_path: str | None = None) -> dict[str, Any]:
        return {
            "sheet_path": str(self.sheet_path) if sheet_path is None else sheet_path,
            "info": {
                "duration_s": self.info.duration_seconds,
                "width": self.info.width,
                "height": self.info.height,
                "fps": self.info.fps,
                "codec": self.info.codec,
                "rotation": self.info.rotation,
            },
            "frame_count": self.frame_count,
            "first_timestamp_s": self.first_timestamp_seconds,
            "last_timestamp_s": self.last_timestamp_seconds,
            "timings_ms": self.timings_ms,
            "vid2grid_version": self.vid2grid_version,
        }


def render_sheets(
    path: str | Path,
    request: CollageRequest,
    out_dir: str | Path,
    *,
    info: VideoInfo | None = None,
) -> RenderResult:
    # Ahead of the planner's own check so a bad request fails before the file is opened.
    validate_request(request)
    directory = Path(out_dir)
    planned = _plan(path, request, info)
    directory.mkdir(parents=True, exist_ok=True)

    written = _write_sheets(
        path, planned, [(sheet, directory / sheet.file_name) for sheet in planned.plan.sheets]
    )

    return RenderResult(
        info=planned.info,
        frame_count=written.frame_count,
        first_timestamp_seconds=written.first_timestamp_seconds,
        last_timestamp_seconds=written.last_timestamp_seconds,
        timings_ms=written.timings_ms,
        vid2grid_version=VID2GRID_VERSION,
        plan=planned.plan,
        warnings=planned.warnings,
        sheet_paths=written.sheet_paths,
    )


def render_single_sheet(
    path: str | Path,
    *,
    out_path: str | Path,
    frames: int = 16,
    output_resolution: int = 1024,
    jpeg_quality: int = 85,
    keyframes: bool = False,
    start_seconds: float = 0.0,
    end_seconds: float | None = None,
) -> SheetResult:
    info = probe_video(path, keyframes=keyframes)
    end = info.duration_seconds if end_seconds is None else end_seconds
    span_seconds = end - start_seconds

    request = CollageRequest(
        start_seconds=start_seconds,
        end_seconds=end,
        # Guarded so an empty range reaches the planner's own check instead of dividing by zero.
        target_fps=frames / span_seconds if span_seconds > 0 else 0.0,
        frames_per_grid=frames,
        output_resolution=output_resolution,
        jpeg_quality=jpeg_quality,
        # Explicit, because a floor of span * target_fps can drop the last frame to float error.
        frame_count=frames,
        keyframe_sampling=keyframes,
        max_keyframes=frames if keyframes else None,
    )

    sheet_path = Path(out_path)
    planned = _plan(path, request, info)
    sheet_path.parent.mkdir(parents=True, exist_ok=True)

    written = _write_sheets(
        path, planned, [(sheet, sheet_path) for sheet in planned.plan.sheets[:1]]
    )
    if not written.sheet_paths:
        raise NoFramesError("no frames could be captured in the requested range")

    return SheetResult(
        info=planned.info,
        frame_count=written.frame_count,
        first_timestamp_seconds=written.first_timestamp_seconds,
        last_timestamp_seconds=written.last_timestamp_seconds,
        timings_ms=written.timings_ms,
        vid2grid_version=VID2GRID_VERSION,
        plan=planned.plan,
        warnings=planned.warnings,
        sheet_path=sheet_path,
    )


@dataclass(frozen=True, slots=True)
class _Planned:
    info: VideoInfo
    plan: RenderPlan
    warnings: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _Written:
    sheet_paths: tuple[Path, ...]
    timestamps: tuple[float, ...]
    timings_ms: dict[str, int]

    @property
    def frame_count(self) -> int:
        return len(self.timestamps)

    @property
    def first_timestamp_seconds(self) -> float | None:
        return self.timestamps[0] if self.timestamps else None

    @property
    def last_timestamp_seconds(self) -> float | None:
        return self.timestamps[-1] if self.timestamps else None


def _plan(path: str | Path, request: CollageRequest, info: VideoInfo | None) -> _Planned:
    video_info = _resolve_video_info(path, request, info)
    plan, warnings = _plan_with_keyframe_fallback(request, video_info)
    return _Planned(info=video_info, plan=plan, warnings=warnings)


# Frames are captured one sheet at a time, so memory scales with a sheet rather than the video.
def _write_sheets(
    path: str | Path, planned: _Planned, targets: Sequence[tuple[PlannedSheet, Path]]
) -> _Written:
    plan = planned.plan
    extracting_seconds = 0.0
    rendering_seconds = 0.0
    sheet_paths: list[Path] = []
    timestamps: list[float] = []

    with closing(iter_frame_images(path, plan, planned.info)) as frame_images:
        for sheet, sheet_path in targets:
            started = time.perf_counter()
            images = list(itertools.islice(frame_images, len(sheet.cells)))
            extracting_seconds += time.perf_counter() - started
            if not images:
                break

            started = time.perf_counter()
            save_jpeg(paint_sheet(plan, sheet, images), sheet_path, plan.jpeg_quality)
            rendering_seconds += time.perf_counter() - started
            sheet_paths.append(sheet_path)
            timestamps.extend(cell.timestamp_seconds for cell in sheet.cells[: len(images)])

    return _Written(
        sheet_paths=tuple(sheet_paths),
        timestamps=tuple(timestamps),
        timings_ms={
            "extracting": _to_ms(extracting_seconds),
            "rendering": _to_ms(rendering_seconds),
        },
    )


# Keyframe times cost a full demux, so a caller's info is taken as it comes and topped up
# only when keyframe mode actually needs the field.
def _resolve_video_info(
    path: str | Path, request: CollageRequest, supplied: VideoInfo | None
) -> VideoInfo:
    if supplied is None:
        return probe_video(path, keyframes=request.keyframe_sampling)
    if not request.keyframe_sampling or supplied.keyframe_timestamps_seconds is not None:
        return supplied

    probed = probe_video(path, keyframes=True)
    if probed.keyframe_timestamps_seconds is None:
        return supplied
    return replace(supplied, keyframe_timestamps_seconds=probed.keyframe_timestamps_seconds)


def _plan_with_keyframe_fallback(
    request: CollageRequest, info: VideoInfo
) -> tuple[RenderPlan, tuple[str, ...]]:
    if request.keyframe_sampling and not _has_keyframes_in_range(request, info):
        sampled = replace(request, keyframe_sampling=False)
        return build_render_plan(sampled, info), (_KEYFRAME_FALLBACK_WARNING,)
    return build_render_plan(request, info), ()


def _has_keyframes_in_range(request: CollageRequest, info: VideoInfo) -> bool:
    keyframes = info.keyframe_timestamps_seconds
    if not keyframes:
        return False
    return any(request.start_seconds <= timestamp <= request.end_seconds for timestamp in keyframes)


def _to_ms(seconds: float) -> int:
    return round(seconds * 1000)
