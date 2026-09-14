from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Literal

RENDER_PLAN_VERSION = 1

try:
    VID2GRID_VERSION = version("vid2grid")
except PackageNotFoundError:
    VID2GRID_VERSION = "0.0.0+unknown"

WatermarkAnchor = Literal["top-left", "top-right"]
TranscriptScope = Literal["per-sheet", "combined"]


@dataclass(frozen=True, slots=True)
class VideoInfo:
    """Display-oriented source dimensions: any container rotation is already applied."""

    duration_seconds: float
    width: int
    height: int
    keyframe_timestamps_seconds: tuple[float, ...] | None = None
    # Executor-only: the plan contract knows nothing of these, so to_dict drops them.
    fps: float = 0.0
    codec: str = ""
    rotation: int = 0

    def to_dict(self) -> dict[str, Any]:
        """The contract's `VideoInfo` JSON, without the executor-only fields."""
        info: dict[str, Any] = {
            "durationSeconds": self.duration_seconds,
            "width": self.width,
            "height": self.height,
        }
        if self.keyframe_timestamps_seconds is not None:
            info["keyframeTimestampsSeconds"] = list(self.keyframe_timestamps_seconds)
        return info

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "VideoInfo":
        """Read the contract's `VideoInfo` JSON; executor-only fields take their defaults."""
        keyframes = data.get("keyframeTimestampsSeconds")
        return cls(
            duration_seconds=data["durationSeconds"],
            width=data["width"],
            height=data["height"],
            keyframe_timestamps_seconds=None if keyframes is None else tuple(keyframes),
        )


@dataclass(frozen=True, slots=True)
class CollageRequest:
    start_seconds: float
    end_seconds: float
    target_fps: float
    frames_per_grid: int
    output_resolution: int
    jpeg_quality: int
    frame_count: int | None = None
    keyframe_sampling: bool = False
    max_keyframes: int | None = None
    transcript_scope: TranscriptScope | None = None

    def to_dict(self) -> dict[str, Any]:
        """The contract's `CollagePlanRequest` JSON, omitting the fields left unset."""
        request: dict[str, Any] = {
            "startSeconds": self.start_seconds,
            "endSeconds": self.end_seconds,
            "targetFps": self.target_fps,
        }
        if self.frame_count is not None:
            request["frameCount"] = self.frame_count
        if self.keyframe_sampling:
            request["keyframeSampling"] = True
        if self.max_keyframes is not None:
            request["maxKeyframes"] = self.max_keyframes
        request["framesPerGrid"] = self.frames_per_grid
        request["outputResolution"] = self.output_resolution
        request["jpegQuality"] = self.jpeg_quality
        if self.transcript_scope is not None:
            request["transcript"] = {"scope": self.transcript_scope}
        return request

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CollageRequest":
        """Read the contract's `CollagePlanRequest` JSON."""
        transcript = data.get("transcript")
        return cls(
            start_seconds=data["startSeconds"],
            end_seconds=data["endSeconds"],
            target_fps=data["targetFps"],
            frames_per_grid=data["framesPerGrid"],
            output_resolution=data["outputResolution"],
            jpeg_quality=data["jpegQuality"],
            frame_count=data.get("frameCount"),
            keyframe_sampling=bool(data.get("keyframeSampling", False)),
            max_keyframes=data.get("maxKeyframes"),
            transcript_scope=None if transcript is None else transcript["scope"],
        )


@dataclass(frozen=True, slots=True)
class Size:
    width: int
    height: int

    def to_dict(self) -> dict[str, Any]:
        return {"width": self.width, "height": self.height}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Size":
        return cls(width=data["width"], height=data["height"])

    def as_tuple(self) -> tuple[int, int]:
        return (self.width, self.height)


@dataclass(frozen=True, slots=True)
class PlannedFrame:
    frame_index: int
    timestamp_seconds: float

    def to_dict(self) -> dict[str, Any]:
        return {"frameIndex": self.frame_index, "timestampSeconds": self.timestamp_seconds}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlannedFrame":
        return cls(frame_index=data["frameIndex"], timestamp_seconds=data["timestampSeconds"])


@dataclass(frozen=True, slots=True)
class PlannedGridLayout:
    cols: int
    rows: int
    offset_x: int
    offset_y: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "cols": self.cols,
            "rows": self.rows,
            "offsetX": self.offset_x,
            "offsetY": self.offset_y,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlannedGridLayout":
        return cls(
            cols=data["cols"],
            rows=data["rows"],
            offset_x=data["offsetX"],
            offset_y=data["offsetY"],
        )


@dataclass(frozen=True, slots=True)
class PlannedWatermark:
    text: str
    anchor: WatermarkAnchor
    # Left edge for "top-left", right edge for "top-right": the planner has no font
    # metrics, so the executor measures the text itself (Pillow anchor="ra").
    x: int
    y: int
    font_size_px: int
    stroke_width_px: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "anchor": self.anchor,
            "x": self.x,
            "y": self.y,
            "fontSizePx": self.font_size_px,
            "strokeWidthPx": self.stroke_width_px,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlannedWatermark":
        return cls(
            text=data["text"],
            anchor=data["anchor"],
            x=data["x"],
            y=data["y"],
            font_size_px=data["fontSizePx"],
            stroke_width_px=data["strokeWidthPx"],
        )


@dataclass(frozen=True, slots=True)
class PlannedCell:
    frame_index: int
    timestamp_seconds: float
    x: int
    y: int
    width: int
    height: int
    watermarks: tuple[PlannedWatermark, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "frameIndex": self.frame_index,
            "timestampSeconds": self.timestamp_seconds,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "watermarks": [watermark.to_dict() for watermark in self.watermarks],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlannedCell":
        return cls(
            frame_index=data["frameIndex"],
            timestamp_seconds=data["timestampSeconds"],
            x=data["x"],
            y=data["y"],
            width=data["width"],
            height=data["height"],
            watermarks=tuple(PlannedWatermark.from_dict(w) for w in data["watermarks"]),
        )


@dataclass(frozen=True, slots=True)
class TranscriptWindow:
    start_seconds: float
    end_seconds: float
    file_name: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "startSeconds": self.start_seconds,
            "endSeconds": self.end_seconds,
            "fileName": self.file_name,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TranscriptWindow":
        return cls(
            start_seconds=data["startSeconds"],
            end_seconds=data["endSeconds"],
            file_name=data["fileName"],
        )


@dataclass(frozen=True, slots=True)
class PlannedSheet:
    sheet_index: int
    file_name: str
    cells: tuple[PlannedCell, ...]
    transcript: TranscriptWindow | None = None

    def to_dict(self) -> dict[str, Any]:
        sheet: dict[str, Any] = {
            "sheetIndex": self.sheet_index,
            "fileName": self.file_name,
            "cells": [cell.to_dict() for cell in self.cells],
        }
        if self.transcript is not None:
            sheet["transcript"] = self.transcript.to_dict()
        return sheet

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlannedSheet":
        transcript = data.get("transcript")
        return cls(
            sheet_index=data["sheetIndex"],
            file_name=data["fileName"],
            cells=tuple(PlannedCell.from_dict(cell) for cell in data["cells"]),
            transcript=None if transcript is None else TranscriptWindow.from_dict(transcript),
        )


@dataclass(frozen=True, slots=True)
class RenderPlanStyle:
    background: str
    text_fill: str
    text_stroke: str
    font_family: str
    text_baseline: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "background": self.background,
            "textFill": self.text_fill,
            "textStroke": self.text_stroke,
            "fontFamily": self.font_family,
            "textBaseline": self.text_baseline,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RenderPlanStyle":
        return cls(
            background=data["background"],
            text_fill=data["textFill"],
            text_stroke=data["textStroke"],
            font_family=data["fontFamily"],
            text_baseline=data["textBaseline"],
        )


@dataclass(frozen=True, slots=True)
class TimestampFormat:
    show_hours: bool
    show_minutes: bool
    show_milliseconds: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "showHours": self.show_hours,
            "showMinutes": self.show_minutes,
            "showMilliseconds": self.show_milliseconds,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TimestampFormat":
        return cls(
            show_hours=data["showHours"],
            show_minutes=data["showMinutes"],
            show_milliseconds=data["showMilliseconds"],
        )


@dataclass(frozen=True, slots=True)
class RenderPlan:
    version: int
    canvas: Size
    cell: Size
    layout: PlannedGridLayout
    style: RenderPlanStyle
    jpeg_quality: int
    timestamp_format: TimestampFormat
    frames: tuple[PlannedFrame, ...]
    sheets: tuple[PlannedSheet, ...]
    combined_transcript: TranscriptWindow | None = None

    def to_dict(self) -> dict[str, Any]:
        """The contract's `RenderPlan` JSON, byte-comparable with the repo's fixtures."""
        plan: dict[str, Any] = {
            "version": self.version,
            "canvas": self.canvas.to_dict(),
            "cell": self.cell.to_dict(),
            "layout": self.layout.to_dict(),
            "style": self.style.to_dict(),
            "jpegQuality": self.jpeg_quality,
            "timestampFormat": self.timestamp_format.to_dict(),
            "frames": [frame.to_dict() for frame in self.frames],
            "sheets": [sheet.to_dict() for sheet in self.sheets],
        }
        if self.combined_transcript is not None:
            plan["combinedTranscript"] = self.combined_transcript.to_dict()
        return plan

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RenderPlan":
        """Read the contract's `RenderPlan` JSON."""
        combined = data.get("combinedTranscript")
        return cls(
            version=data["version"],
            canvas=Size.from_dict(data["canvas"]),
            cell=Size.from_dict(data["cell"]),
            layout=PlannedGridLayout.from_dict(data["layout"]),
            style=RenderPlanStyle.from_dict(data["style"]),
            jpeg_quality=data["jpegQuality"],
            timestamp_format=TimestampFormat.from_dict(data["timestampFormat"]),
            frames=tuple(PlannedFrame.from_dict(frame) for frame in data["frames"]),
            sheets=tuple(PlannedSheet.from_dict(sheet) for sheet in data["sheets"]),
            combined_transcript=None if combined is None else TranscriptWindow.from_dict(combined),
        )
