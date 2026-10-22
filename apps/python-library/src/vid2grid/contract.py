from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from typing import Literal, NotRequired, TypedDict

from .errors import InvalidRequestError

try:
    VID2GRID_VERSION = version("vid2grid")
except PackageNotFoundError:
    VID2GRID_VERSION = "0.0.0+unknown"

WatermarkAnchor = Literal["top-left", "top-right"]
TranscriptScope = Literal["per-sheet", "combined"]

ROTATIONS = (0, 90, 180, 270)


def is_quarter_turn(rotation: int) -> bool:
    return rotation in ROTATIONS[1::2]


class TranscriptRequestJson(TypedDict):
    scope: TranscriptScope


class CollagePlanRequestJson(TypedDict):
    startSeconds: float
    endSeconds: float
    targetFps: float
    frameCount: NotRequired[int]
    keyframeSampling: NotRequired[bool]
    maxKeyframes: NotRequired[int]
    framesPerGrid: int
    outputResolution: int
    jpegQuality: int
    transcript: NotRequired[TranscriptRequestJson]


class VideoInfoJson(TypedDict):
    durationSeconds: float
    width: int
    height: int
    keyframeTimestampsSeconds: NotRequired[list[float]]


class SizeJson(TypedDict):
    width: int
    height: int


class PlannedFrameJson(TypedDict):
    frameIndex: int
    timestampSeconds: float


class PlannedGridLayoutJson(TypedDict):
    cols: int
    rows: int
    offsetX: int
    offsetY: int


class PlannedWatermarkJson(TypedDict):
    text: str
    anchor: WatermarkAnchor
    x: int
    y: int
    fontSizePx: int
    strokeWidthPx: int


class PlannedCellJson(TypedDict):
    frameIndex: int
    timestampSeconds: float
    x: int
    y: int
    width: int
    height: int
    watermarks: list[PlannedWatermarkJson]


class TranscriptCueJson(TypedDict):
    start: float
    end: float
    text: str


class TranscriptWindowJson(TypedDict):
    startSeconds: float
    endSeconds: float
    fileName: str


class PlannedSheetJson(TypedDict):
    sheetIndex: int
    fileName: str
    cells: list[PlannedCellJson]
    transcript: NotRequired[TranscriptWindowJson]


class RenderPlanStyleJson(TypedDict):
    background: str
    textFill: str
    textStroke: str
    fontFamily: str
    textBaseline: str


class TimestampFormatJson(TypedDict):
    showHours: bool
    showMinutes: bool
    showMilliseconds: bool


class RenderPlanJson(TypedDict):
    version: int
    canvas: SizeJson
    cell: SizeJson
    layout: PlannedGridLayoutJson
    style: RenderPlanStyleJson
    jpegQuality: int
    timestampFormat: TimestampFormatJson
    frames: list[PlannedFrameJson]
    sheets: list[PlannedSheetJson]
    combinedTranscript: NotRequired[TranscriptWindowJson]


# Display-oriented source dimensions: any container rotation is already applied.
@dataclass(frozen=True, slots=True)
class VideoInfo:
    duration_seconds: float
    width: int
    height: int
    keyframe_timestamps_seconds: tuple[float, ...] | None = None
    # Executor-only: the plan contract knows nothing of these, so to_dict drops them.
    fps: float = 0.0
    codec: str = ""
    rotation: int = 0

    def __post_init__(self) -> None:
        if self.rotation not in ROTATIONS:
            raise InvalidRequestError(f"rotation must be 0, 90, 180 or 270, got {self.rotation}")

    def to_dict(self) -> VideoInfoJson:
        info: VideoInfoJson = {
            "durationSeconds": self.duration_seconds,
            "width": self.width,
            "height": self.height,
        }
        if self.keyframe_timestamps_seconds is not None:
            info["keyframeTimestampsSeconds"] = list(self.keyframe_timestamps_seconds)
        return info

    @classmethod
    def from_dict(cls, data: VideoInfoJson) -> "VideoInfo":
        keyframes = data.get("keyframeTimestampsSeconds")
        return cls(
            duration_seconds=float(data["durationSeconds"]),
            width=data["width"],
            height=data["height"],
            keyframe_timestamps_seconds=(
                None if keyframes is None else tuple(float(k) for k in keyframes)
            ),
        )


@dataclass(frozen=True, slots=True)
class CollagePlanRequest:
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

    def to_dict(self) -> CollagePlanRequestJson:
        request: CollagePlanRequestJson = {
            "startSeconds": self.start_seconds,
            "endSeconds": self.end_seconds,
            "targetFps": self.target_fps,
            "framesPerGrid": self.frames_per_grid,
            "outputResolution": self.output_resolution,
            "jpegQuality": self.jpeg_quality,
        }
        if self.frame_count is not None:
            request["frameCount"] = self.frame_count
        if self.keyframe_sampling:
            request["keyframeSampling"] = True
        if self.max_keyframes is not None:
            request["maxKeyframes"] = self.max_keyframes
        if self.transcript_scope is not None:
            request["transcript"] = {"scope": self.transcript_scope}
        return request

    @classmethod
    def from_dict(cls, data: CollagePlanRequestJson) -> "CollagePlanRequest":
        transcript = data.get("transcript")
        return cls(
            start_seconds=float(data["startSeconds"]),
            end_seconds=float(data["endSeconds"]),
            target_fps=float(data["targetFps"]),
            frames_per_grid=data["framesPerGrid"],
            output_resolution=data["outputResolution"],
            jpeg_quality=data["jpegQuality"],
            frame_count=data.get("frameCount"),
            keyframe_sampling=data.get("keyframeSampling", False),
            max_keyframes=data.get("maxKeyframes"),
            transcript_scope=None if transcript is None else transcript["scope"],
        )


CollageRequest = CollagePlanRequest


@dataclass(frozen=True, slots=True)
class Size:
    width: int
    height: int

    def to_dict(self) -> SizeJson:
        return {"width": self.width, "height": self.height}

    @classmethod
    def from_dict(cls, data: SizeJson) -> "Size":
        return cls(width=data["width"], height=data["height"])

    def as_tuple(self) -> tuple[int, int]:
        return (self.width, self.height)


@dataclass(frozen=True, slots=True)
class PlannedFrame:
    frame_index: int
    timestamp_seconds: float

    def to_dict(self) -> PlannedFrameJson:
        return {"frameIndex": self.frame_index, "timestampSeconds": self.timestamp_seconds}

    @classmethod
    def from_dict(cls, data: PlannedFrameJson) -> "PlannedFrame":
        return cls(
            frame_index=data["frameIndex"], timestamp_seconds=float(data["timestampSeconds"])
        )


@dataclass(frozen=True, slots=True)
class PlannedGridLayout:
    cols: int
    rows: int
    offset_x: int
    offset_y: int

    def to_dict(self) -> PlannedGridLayoutJson:
        return {
            "cols": self.cols,
            "rows": self.rows,
            "offsetX": self.offset_x,
            "offsetY": self.offset_y,
        }

    @classmethod
    def from_dict(cls, data: PlannedGridLayoutJson) -> "PlannedGridLayout":
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
    # Left edge for "top-left", right edge for "top-right": core has no font metrics, so
    # the painter measures the text itself (Pillow anchor="ra").
    x: int
    y: int
    font_size_px: int
    stroke_width_px: int

    def to_dict(self) -> PlannedWatermarkJson:
        return {
            "text": self.text,
            "anchor": self.anchor,
            "x": self.x,
            "y": self.y,
            "fontSizePx": self.font_size_px,
            "strokeWidthPx": self.stroke_width_px,
        }

    @classmethod
    def from_dict(cls, data: PlannedWatermarkJson) -> "PlannedWatermark":
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

    def to_dict(self) -> PlannedCellJson:
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
    def from_dict(cls, data: PlannedCellJson) -> "PlannedCell":
        return cls(
            frame_index=data["frameIndex"],
            timestamp_seconds=float(data["timestampSeconds"]),
            x=data["x"],
            y=data["y"],
            width=data["width"],
            height=data["height"],
            watermarks=tuple(PlannedWatermark.from_dict(w) for w in data["watermarks"]),
        )


@dataclass(frozen=True, slots=True)
class TranscriptCue:
    start: float
    end: float
    text: str

    def to_dict(self) -> TranscriptCueJson:
        return {"start": self.start, "end": self.end, "text": self.text}

    @classmethod
    def from_dict(cls, data: TranscriptCueJson) -> "TranscriptCue":
        return cls(start=float(data["start"]), end=float(data["end"]), text=data["text"])


@dataclass(frozen=True, slots=True)
class TranscriptWindow:
    start_seconds: float
    end_seconds: float
    file_name: str

    def to_dict(self) -> TranscriptWindowJson:
        return {
            "startSeconds": self.start_seconds,
            "endSeconds": self.end_seconds,
            "fileName": self.file_name,
        }

    @classmethod
    def from_dict(cls, data: TranscriptWindowJson) -> "TranscriptWindow":
        return cls(
            start_seconds=float(data["startSeconds"]),
            end_seconds=float(data["endSeconds"]),
            file_name=data["fileName"],
        )


@dataclass(frozen=True, slots=True)
class PlannedSheet:
    sheet_index: int
    file_name: str
    cells: tuple[PlannedCell, ...]
    transcript: TranscriptWindow | None = None

    def to_dict(self) -> PlannedSheetJson:
        sheet: PlannedSheetJson = {
            "sheetIndex": self.sheet_index,
            "fileName": self.file_name,
            "cells": [cell.to_dict() for cell in self.cells],
        }
        if self.transcript is not None:
            sheet["transcript"] = self.transcript.to_dict()
        return sheet

    @classmethod
    def from_dict(cls, data: PlannedSheetJson) -> "PlannedSheet":
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

    def to_dict(self) -> RenderPlanStyleJson:
        return {
            "background": self.background,
            "textFill": self.text_fill,
            "textStroke": self.text_stroke,
            "fontFamily": self.font_family,
            "textBaseline": self.text_baseline,
        }

    @classmethod
    def from_dict(cls, data: RenderPlanStyleJson) -> "RenderPlanStyle":
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

    def to_dict(self) -> TimestampFormatJson:
        return {
            "showHours": self.show_hours,
            "showMinutes": self.show_minutes,
            "showMilliseconds": self.show_milliseconds,
        }

    @classmethod
    def from_dict(cls, data: TimestampFormatJson) -> "TimestampFormat":
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

    def to_dict(self) -> RenderPlanJson:
        plan: RenderPlanJson = {
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
    def from_dict(cls, data: RenderPlanJson) -> "RenderPlan":
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
