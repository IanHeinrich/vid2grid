import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TypeVar

from .contract import (
    RENDER_PLAN_VERSION,
    CollageRequest,
    PlannedCell,
    PlannedFrame,
    PlannedGridLayout,
    PlannedSheet,
    PlannedWatermark,
    RenderPlan,
    RenderPlanStyle,
    Size,
    TimestampFormat,
    TranscriptWindow,
    VideoInfo,
    WatermarkAnchor,
)

GUTTER_PX = 8
FONT_HEIGHT_DIVISOR = 16
MIN_FONT_SIZE = 8
WATERMARK_INSET_PX = 4

STYLE = RenderPlanStyle(
    background="black",
    text_fill="black",
    text_stroke="white",
    font_family="sans-serif",
    text_baseline="top",
)

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class GridLayout:
    cols: int
    rows: int
    cell_w: int
    cell_h: int
    offset_x: int
    offset_y: int


def compute_optimal_grid(
    frame_count: int,
    source_aspect: float,
    output_resolution: int,
    gutter_px: int,
) -> GridLayout:
    """Pick the column count whose cell area is largest inside the square canvas."""
    if frame_count <= 0:
        raise ValueError("frameCount must be positive")
    if source_aspect <= 0:
        raise ValueError("sourceAspect must be positive")
    if output_resolution <= 0:
        raise ValueError("outputResolution must be positive")
    if gutter_px < 0:
        raise ValueError("gutterPx must not be negative")

    best: GridLayout | None = None
    best_area = -1.0

    for cols in range(1, frame_count + 1):
        rows = math.ceil(frame_count / cols)

        avail_w = output_resolution - (cols + 1) * gutter_px
        avail_h = output_resolution - (rows + 1) * gutter_px
        if avail_w <= 0 or avail_h <= 0:
            continue

        cell_w_by_width = avail_w / cols
        cell_h_by_height = avail_h / rows

        candidate_h = cell_w_by_width / source_aspect
        if candidate_h <= cell_h_by_height:
            cell_w = cell_w_by_width
            cell_h = candidate_h
        else:
            cell_h = cell_h_by_height
            cell_w = cell_h * source_aspect

        area = cell_w * cell_h
        if area > best_area:
            best_area = area
            cell_w_int = math.trunc(cell_w)
            cell_h_int = math.trunc(cell_h)
            grid_w = cols * cell_w_int + (cols + 1) * gutter_px
            grid_h = rows * cell_h_int + (rows + 1) * gutter_px
            best = GridLayout(
                cols=cols,
                rows=rows,
                cell_w=cell_w_int,
                cell_h=cell_h_int,
                # math.floor mirrors the TS Math.floor; int() would truncate toward zero
                # should a future gutter or cell rule ever overflow the canvas.
                offset_x=math.floor((output_resolution - grid_w) / 2),
                offset_y=math.floor((output_resolution - grid_h) / 2),
            )

    if best is None:
        raise ValueError(
            "output_resolution too small to fit frame_count frames with the given gutter"
        )
    return best


# Spelled out because JavaScript's Math.round rounds a half up where Python's round
# rounds a half to even: the two ports would disagree on exact half-microseconds.
def round_to_microseconds(seconds: float) -> float:
    """Quantise a timestamp the way the TypeScript planner does."""
    return math.floor(seconds * 1e6 + 0.5) / 1e6


def subsample_evenly(values: Sequence[T], max_kept: int) -> list[T]:
    """Thin a sequence to at most `max_kept` values, always keeping the first."""
    if max_kept >= len(values):
        return list(values)
    return [values[i * len(values) // max_kept] for i in range(max_kept)]


def plan_frame_timestamps(request: CollageRequest, info: VideoInfo) -> list[PlannedFrame]:
    """The ascending capture list, keyframe-sampled or time-sampled."""
    timestamps = (
        _keyframe_timestamps(request, info)
        if request.keyframe_sampling
        else _sampled_timestamps(request, info)
    )
    return [
        PlannedFrame(frame_index=frame_index, timestamp_seconds=timestamp)
        for frame_index, timestamp in enumerate(timestamps)
    ]


def _keyframe_timestamps(request: CollageRequest, info: VideoInfo) -> list[float]:
    keyframes = info.keyframe_timestamps_seconds
    if keyframes is None:
        raise ValueError(
            "keyframe_sampling needs keyframe_timestamps_seconds, which this video info has none of"
        )
    in_range = [
        timestamp
        for timestamp in keyframes
        if timestamp >= request.start_seconds and timestamp <= request.end_seconds
    ]
    selected = (
        in_range
        if request.max_keyframes is None
        else subsample_evenly(in_range, request.max_keyframes)
    )
    return [round_to_microseconds(timestamp) for timestamp in selected]


def _sampled_timestamps(request: CollageRequest, info: VideoInfo) -> list[float]:
    range_seconds = request.end_seconds - request.start_seconds
    count = (
        max(1, math.floor(range_seconds * request.target_fps))
        if request.frame_count is None
        else request.frame_count
    )
    step = (
        1 / request.target_fps
        if request.frame_count is None
        else range_seconds / request.frame_count
    )

    timestamps: list[float] = []
    for i in range(count):
        timestamp = round_to_microseconds(request.start_seconds + i * step)
        if timestamp >= info.duration_seconds:
            break
        timestamps.append(timestamp)
    return timestamps


# Decided once per batch from its last timestamp, so components stay consistent across
# every sheet instead of flipping mid-batch. No frames means no text.
def choose_timestamp_format(
    last_timestamp_seconds: float | None, target_fps: float
) -> TimestampFormat:
    """Which timestamp components every sheet in this batch burns in."""
    if last_timestamp_seconds is None:
        return TimestampFormat(show_hours=False, show_minutes=False, show_milliseconds=False)
    return TimestampFormat(
        show_hours=last_timestamp_seconds >= 3600,
        show_minutes=last_timestamp_seconds >= 60,
        show_milliseconds=target_fps > 1,
    )


def format_timestamp(seconds: float, timestamp_format: TimestampFormat) -> str:
    """Render a timestamp with the components the batch chose."""
    total_ms = math.floor(seconds * 1000 + 0.5)
    hours = total_ms // 3_600_000
    after_hours_ms = total_ms % 3_600_000
    minutes = after_hours_ms // 60_000
    after_minutes_ms = after_hours_ms % 60_000
    secs = after_minutes_ms // 1000
    ms = after_minutes_ms % 1000

    seconds_text = f"{secs:02d}.{ms:03d}" if timestamp_format.show_milliseconds else f"{secs:02d}"

    if timestamp_format.show_hours:
        return f"{hours:02d}:{minutes:02d}:{seconds_text}"
    if timestamp_format.show_minutes:
        return f"{minutes:02d}:{seconds_text}"
    return seconds_text


# Gaps between sheets are split at their midpoint so every cue in
# [start_seconds, end_seconds] lands in exactly one sheet's transcript.
def compute_sheet_windows(
    sheet_timestamps: Sequence[Sequence[float]],
    start_seconds: float,
    end_seconds: float,
) -> list[TranscriptWindow]:
    """One transcript window per sheet, covering the whole requested range without overlap."""
    firsts = [timestamps[0] for timestamps in sheet_timestamps]
    lasts = [timestamps[-1] for timestamps in sheet_timestamps]
    return [
        TranscriptWindow(
            start_seconds=round_to_microseconds(
                start_seconds if i == 0 else (lasts[i - 1] + firsts[i]) / 2
            ),
            end_seconds=round_to_microseconds(
                end_seconds if i == len(sheet_timestamps) - 1 else (lasts[i] + firsts[i + 1]) / 2
            ),
            file_name=grid_transcript_file_name(i),
        )
        for i in range(len(sheet_timestamps))
    ]


def grid_file_name(index: int) -> str:
    """`grid_0001.jpg` upward."""
    return f"grid_{index + 1:04d}.jpg"


def grid_transcript_file_name(index: int) -> str:
    """Same numbering as `grid_file_name`, so `grid_0001.vtt` sits paired with the sheet."""
    return f"grid_{index + 1:04d}.vtt"


def combined_transcript_file_name() -> str:
    """The single transcript covering the whole range."""
    return "transcript.vtt"


def validate_request(request: CollageRequest) -> None:
    """Raise `ValueError` for a request the planner cannot honour."""
    if request.end_seconds <= request.start_seconds:
        raise ValueError("end_time must be greater than start_time")
    if request.target_fps <= 0:
        raise ValueError("target_fps must be positive")
    if request.frames_per_grid <= 0:
        raise ValueError("frames_per_grid must be positive")
    if request.output_resolution <= 0:
        raise ValueError("output_resolution must be positive")
    if request.jpeg_quality < 1 or request.jpeg_quality > 100:
        raise ValueError("jpeg_quality must be between 1 and 100")
    if request.frame_count is not None and not _is_positive_integer(request.frame_count):
        raise ValueError("frame_count must be a positive integer")
    if request.max_keyframes is not None and not _is_positive_integer(request.max_keyframes):
        raise ValueError("max_keyframes must be a positive integer")


def _is_positive_integer(value: float) -> bool:
    return float(value).is_integer() and value > 0


def build_render_plan(request: CollageRequest, info: VideoInfo) -> RenderPlan:
    """Decide every timestamp, cell rectangle, watermark and file name for one export."""
    validate_request(request)

    layout = compute_optimal_grid(
        request.frames_per_grid,
        info.width / info.height,
        request.output_resolution,
        GUTTER_PX,
    )
    frames = plan_frame_timestamps(request, info)
    timestamp_format = choose_timestamp_format(
        frames[-1].timestamp_seconds if frames else None,
        request.target_fps,
    )

    font_size_px = max(MIN_FONT_SIZE, math.floor(layout.cell_h / FONT_HEIGHT_DIVISOR))
    stroke_width_px = max(1, math.floor(font_size_px / 8))

    sheet_cells = [
        tuple(
            _plan_cell(frame, cell_index, layout, timestamp_format, font_size_px, stroke_width_px)
            for cell_index, frame in enumerate(frames[first : first + request.frames_per_grid])
        )
        for first in range(0, len(frames), request.frames_per_grid)
    ]

    windows: list[TranscriptWindow | None] = [None] * len(sheet_cells)
    if request.transcript_scope == "per-sheet":
        windows = list(
            compute_sheet_windows(
                [[cell.timestamp_seconds for cell in cells] for cells in sheet_cells],
                request.start_seconds,
                request.end_seconds,
            )
        )

    sheets = tuple(
        PlannedSheet(
            sheet_index=sheet_index,
            file_name=grid_file_name(sheet_index),
            cells=cells,
            transcript=windows[sheet_index],
        )
        for sheet_index, cells in enumerate(sheet_cells)
    )

    return RenderPlan(
        version=RENDER_PLAN_VERSION,
        canvas=Size(width=request.output_resolution, height=request.output_resolution),
        cell=Size(width=layout.cell_w, height=layout.cell_h),
        layout=PlannedGridLayout(
            cols=layout.cols,
            rows=layout.rows,
            offset_x=layout.offset_x,
            offset_y=layout.offset_y,
        ),
        style=STYLE,
        jpeg_quality=request.jpeg_quality,
        timestamp_format=timestamp_format,
        frames=tuple(frames),
        sheets=sheets,
        combined_transcript=(
            TranscriptWindow(
                start_seconds=round_to_microseconds(request.start_seconds),
                end_seconds=round_to_microseconds(request.end_seconds),
                file_name=combined_transcript_file_name(),
            )
            if request.transcript_scope == "combined"
            else None
        ),
    )


def _plan_cell(
    frame: PlannedFrame,
    cell_index: int,
    layout: GridLayout,
    timestamp_format: TimestampFormat,
    font_size_px: int,
    stroke_width_px: int,
) -> PlannedCell:
    col = cell_index % layout.cols
    row = math.floor(cell_index / layout.cols)
    x = layout.offset_x + GUTTER_PX + col * (layout.cell_w + GUTTER_PX)
    y = layout.offset_y + GUTTER_PX + row * (layout.cell_h + GUTTER_PX)

    def watermark(text: str, anchor: WatermarkAnchor, watermark_x: int) -> PlannedWatermark:
        return PlannedWatermark(
            text=text,
            anchor=anchor,
            x=watermark_x,
            y=y + WATERMARK_INSET_PX,
            font_size_px=font_size_px,
            stroke_width_px=stroke_width_px,
        )

    return PlannedCell(
        frame_index=frame.frame_index,
        timestamp_seconds=frame.timestamp_seconds,
        x=x,
        y=y,
        width=layout.cell_w,
        height=layout.cell_h,
        watermarks=(
            watermark(
                format_timestamp(frame.timestamp_seconds, timestamp_format),
                "top-left",
                x + WATERMARK_INSET_PX,
            ),
            watermark(str(frame.frame_index), "top-right", x + layout.cell_w - WATERMARK_INSET_PX),
        ),
    )
