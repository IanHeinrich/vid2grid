import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .contract import VID2GRID_VERSION, CollageRequest, RenderPlan, VideoInfo
from .decode import capture_frames
from .paint import paint_sheet, save_jpeg
from .planner import build_render_plan, validate_request
from .probe import probe

_KEYFRAME_FALLBACK_WARNING = (
    "keyframe_sampling: no keyframes were found in the requested range, sampled by time instead"
)


@dataclass(frozen=True, slots=True)
class RenderResult:
    sheet_paths: tuple[Path, ...]
    info: VideoInfo
    frame_count: int
    first_timestamp_seconds: float | None
    last_timestamp_seconds: float | None
    timings_ms: dict[str, int]
    vid2grid_version: str
    plan: RenderPlan
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SheetResult:
    sheet_path: Path
    info: VideoInfo
    frame_count: int
    first_timestamp_seconds: float | None
    last_timestamp_seconds: float | None
    timings_ms: dict[str, int]
    vid2grid_version: str
    plan: RenderPlan
    warnings: tuple[str, ...] = ()

    def to_sheet_row(self, sheet_path: str | None = None) -> dict[str, Any]:
        """Curator's `sheet` row, whose key names are the only place `_s` suffixes appear."""
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
    """Write one JPEG per planned sheet into `out_dir` and report what went onto them."""
    validate_request(request)
    video_info = _resolve_video_info(path, request, info)
    plan, warnings = _plan_with_keyframe_fallback(request, video_info)

    directory = Path(out_dir)
    directory.mkdir(parents=True, exist_ok=True)

    started = time.perf_counter()
    images = capture_frames(path, plan, video_info)
    extracting_ms = _elapsed_ms(started)

    started = time.perf_counter()
    sheet_paths = []
    for sheet in plan.sheets:
        cell_images = [images[cell.frame_index] for cell in sheet.cells]
        if not cell_images or cell_images[0] is None:
            continue
        sheet_path = directory / sheet.file_name
        save_jpeg(paint_sheet(plan, sheet, cell_images), sheet_path, plan.jpeg_quality)
        sheet_paths.append(sheet_path)
    rendering_ms = _elapsed_ms(started)

    captured = _captured_timestamps(plan, images)
    return RenderResult(
        sheet_paths=tuple(sheet_paths),
        info=video_info,
        frame_count=len(captured),
        first_timestamp_seconds=captured[0] if captured else None,
        last_timestamp_seconds=captured[-1] if captured else None,
        timings_ms={"extracting": extracting_ms, "rendering": rendering_ms},
        vid2grid_version=VID2GRID_VERSION,
        plan=plan,
        warnings=warnings,
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
    """Write one sheet of `frames` frames spread across the range and report it."""
    info = probe(path, keyframes=keyframes)
    end = info.duration_seconds if end_seconds is None else end_seconds
    span_seconds = end - start_seconds
    if span_seconds <= 0:
        raise ValueError("end_time must be greater than start_time")

    request = CollageRequest(
        start_seconds=start_seconds,
        end_seconds=end,
        target_fps=frames / span_seconds,
        frames_per_grid=frames,
        output_resolution=output_resolution,
        jpeg_quality=jpeg_quality,
        # Explicit, because a floor of span * target_fps can drop the last frame to float error.
        frame_count=frames,
        keyframe_sampling=keyframes,
        max_keyframes=frames if keyframes else None,
    )
    plan, warnings = _plan_with_keyframe_fallback(request, info)

    sheet_path = Path(out_path)
    sheet_path.parent.mkdir(parents=True, exist_ok=True)

    started = time.perf_counter()
    images = capture_frames(path, plan, info)
    extracting_ms = _elapsed_ms(started)

    if not plan.sheets or not images or images[0] is None:
        raise ValueError("no frames could be captured in the requested range")

    started = time.perf_counter()
    sheet = plan.sheets[0]
    cell_images = [images[cell.frame_index] for cell in sheet.cells]
    save_jpeg(paint_sheet(plan, sheet, cell_images), sheet_path, plan.jpeg_quality)
    rendering_ms = _elapsed_ms(started)

    captured = _captured_timestamps(plan, images)
    return SheetResult(
        sheet_path=sheet_path,
        info=info,
        frame_count=len(captured),
        first_timestamp_seconds=captured[0] if captured else None,
        last_timestamp_seconds=captured[-1] if captured else None,
        timings_ms={"extracting": extracting_ms, "rendering": rendering_ms},
        vid2grid_version=VID2GRID_VERSION,
        plan=plan,
        warnings=warnings,
    )


# Keyframe times cost a full demux, so a caller's info is taken as it comes and topped up
# only when keyframe mode actually needs the field.
def _resolve_video_info(
    path: str | Path, request: CollageRequest, supplied: VideoInfo | None
) -> VideoInfo:
    if supplied is None:
        return probe(path, keyframes=request.keyframe_sampling)
    if not request.keyframe_sampling or supplied.keyframe_timestamps_seconds is not None:
        return supplied

    probed = probe(path, keyframes=True)
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


def _captured_timestamps(plan: RenderPlan, images: list[Any]) -> list[float]:
    return [
        frame.timestamp_seconds
        for frame, image in zip(plan.frames, images, strict=False)
        if image is not None
    ]


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)
