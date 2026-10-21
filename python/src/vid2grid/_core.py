import json
import math
import numbers
import os
import re
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from fractions import Fraction
from importlib.resources import files
from typing import Literal, NotRequired, TypedDict, cast

from py_mini_racer import MiniRacer

from .contract import (
    CollagePlanRequest,
    CollagePlanRequestJson,
    RenderPlan,
    RenderPlanJson,
    SizeJson,
    TranscriptCue,
    TranscriptCueJson,
    VideoInfo,
    WatermarkAnchor,
)
from .errors import (
    InternalError,
    InvalidRequestError,
    NoAudioError,
    NoFramesError,
    Vid2GridError,
    Vid2GridErrorCode,
)


class FillRectOp(TypedDict):
    kind: Literal["fillRect"]
    x: int
    y: int
    width: int
    height: int
    color: str


class ImageOp(TypedDict):
    kind: Literal["image"]
    cellIndex: int
    x: int
    y: int
    width: int
    height: int


class TextOp(TypedDict):
    kind: Literal["text"]
    cellIndex: int
    text: str
    x: int
    y: int
    anchor: WatermarkAnchor
    baseline: Literal["top"]
    fontSizePx: int
    fontFamily: str
    fill: str
    stroke: str
    strokeWidthPx: int


DrawOp = FillRectOp | ImageOp | TextOp


TranscriptOption = Literal["none", "per-sheet", "combined"]
HostCapability = Literal["transcription"]


class _OptionSpecBase(TypedDict):
    name: str
    flag: str
    help: str
    requires: NotRequired[HostCapability]


class NumberOptionSpec(_OptionSpecBase):
    type: Literal["number", "integer"]
    default: NotRequired[float]
    min: NotRequired[float]
    max: NotRequired[float]
    exclusiveMin: NotRequired[float]


class BooleanOptionSpec(_OptionSpecBase):
    type: Literal["boolean"]
    default: bool


class EnumOptionSpec(_OptionSpecBase):
    type: Literal["enum"]
    values: list[TranscriptOption]
    default: TranscriptOption


OptionSpec = NumberOptionSpec | BooleanOptionSpec | EnumOptionSpec


class WarningJson(TypedDict):
    code: str
    message: str


class KeyframeSamplingJson(TypedDict):
    request: CollagePlanRequestJson
    warning: NotRequired[WarningJson]


@dataclass(frozen=True, slots=True)
class KeyframeSampling:
    request: CollagePlanRequest
    warning: str | None = None


class TranscriptSegmentJson(TypedDict):
    start: float
    end: float | None
    text: str


class TranscriptFileJson(TypedDict):
    fileName: str
    vtt: str


@dataclass(frozen=True, slots=True)
class TranscriptFile:
    file_name: str
    vtt: str


class _Success(TypedDict):
    ok: Literal[True]
    value: object


class _Failure(TypedDict):
    ok: Literal[False]
    code: Vid2GridErrorCode
    message: str


_ERRORS: dict[Vid2GridErrorCode, type[Vid2GridError]] = {
    "invalid_request": InvalidRequestError,
    "no_audio": NoAudioError,
    "no_frames": NoFramesError,
    "internal": InternalError,
}


@dataclass
class _EngineSlot:
    lock: threading.Lock = field(default_factory=threading.Lock)
    engine: MiniRacer | None = None
    inherited: list[MiniRacer] = field(default_factory=list)


_slot = _EngineSlot()


def call(name: str, *args: object) -> object:
    for index, arg in enumerate(args):
        _require_finite(arg, f"{name} argument {index + 1}")
    args_json = json.dumps(args, allow_nan=False, default=_json_number)
    with _slot.lock:
        envelope_json = _engine().call("vid2gridCore.call", name, args_json)
    envelope = cast("_Success | _Failure", json.loads(envelope_json))
    if envelope["ok"]:
        return envelope["value"]
    raise _ERRORS.get(envelope["code"], InternalError)(envelope["message"])


def version() -> int:
    return cast("int", call("version"))


def build_render_plan(request: CollagePlanRequest, info: VideoInfo) -> RenderPlan:
    plan = call("buildRenderPlan", request.to_dict(), info.to_dict())
    return RenderPlan.from_dict(cast("RenderPlanJson", plan))


def validate_collage_plan_request(request: CollagePlanRequest) -> None:
    call("validateCollagePlanRequest", request.to_dict())


def sheet_draw_ops(plan: RenderPlan, sheet_index: int) -> list[DrawOp]:
    return cast("list[DrawOp]", call("sheetDrawOps", plan.to_dict(), sheet_index))


def resolve_keyframe_sampling(
    request: CollagePlanRequest, info: VideoInfo, keyframe_failure: str | None = None
) -> KeyframeSampling:
    args: tuple[object, ...] = (request.to_dict(), info.to_dict())
    if keyframe_failure is not None:
        args += (keyframe_failure,)
    decision = cast("KeyframeSamplingJson", call("resolveKeyframeSampling", *args))
    warning = decision.get("warning")
    return KeyframeSampling(
        request=CollagePlanRequest.from_dict(decision["request"]),
        warning=None if warning is None else warning["message"],
    )


def display_size(
    coded_width: int,
    coded_height: int,
    sample_aspect_ratio: Fraction | None,
    rotation: int,
) -> tuple[int, int]:
    ratio = (
        None
        if sample_aspect_ratio is None
        else {
            "numerator": sample_aspect_ratio.numerator,
            "denominator": sample_aspect_ratio.denominator,
        }
    )
    size = cast("SizeJson", call("displaySize", coded_width, coded_height, ratio, rotation))
    return size["width"], size["height"]


def normalize_rotation_clockwise(ccw_degrees: float) -> int:
    return cast("int", call("normalizeRotationClockwise", ccw_degrees))


def grids_folder_name(source_file_name: str, now: datetime) -> str:
    iso = now.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return cast("str", call("gridsFolderName", source_file_name, iso))


def option_specs(capabilities: Sequence[HostCapability] = ()) -> list[OptionSpec]:
    return cast("list[OptionSpec]", call("optionSpecs", list(capabilities)))


# Keyed by the specs' camelCase names; None stands for an unset flag, which core reads as absent.
def request_from_options(
    values: Mapping[str, object], info: VideoInfo, capabilities: Sequence[HostCapability] = ()
) -> CollagePlanRequest:
    given = {name: value for name, value in values.items() if value is not None}
    request = call("requestFromOptions", given, info.to_dict(), list(capabilities))
    return CollagePlanRequest.from_dict(cast("CollagePlanRequestJson", request))


def cues_from_segments(
    segments: Sequence[TranscriptSegmentJson], offset_seconds: float
) -> list[TranscriptCue]:
    cues = cast("list[TranscriptCueJson]", call("cuesFromSegments", list(segments), offset_seconds))
    return [TranscriptCue.from_dict(cue) for cue in cues]


def transcript_files(
    plan: RenderPlan,
    rendered_sheet_count: int,
    end_seconds: float,
    cues: Sequence[TranscriptCue],
) -> list[TranscriptFile]:
    files = cast(
        "list[TranscriptFileJson]",
        call(
            "transcriptFiles",
            plan.to_dict(),
            rendered_sheet_count,
            end_seconds,
            [cue.to_dict() for cue in cues],
        ),
    )
    return [TranscriptFile(file_name=file["fileName"], vtt=file["vtt"]) for file in files]


def transcription_failed_warning(reason: str, error_code: Vid2GridErrorCode | None = None) -> str:
    args: tuple[object, ...] = (reason,) if error_code is None else (reason, error_code)
    return cast("WarningJson", call("transcriptionFailedWarning", *args))["message"]


def no_transcription_port_warning() -> str:
    return cast("WarningJson", call("noTranscriptionPortWarning"))["message"]


def _engine() -> MiniRacer:
    if _slot.engine is None:
        engine = MiniRacer()
        engine.eval(files("vid2grid").joinpath("_core.js").read_text(encoding="utf-8"))
        _slot.engine = engine
    return _slot.engine


# A forked child inherits the engine but not the V8 thread behind it, so it starts afresh;
# the inherited engine stays referenced because its finaliser may wait on that thread.
def _start_afresh_after_fork() -> None:
    if _slot.engine is not None:
        _slot.inherited.append(_slot.engine)
    _slot.engine = None
    _slot.lock = threading.Lock()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_start_afresh_after_fork)


def _json_number(value: object) -> int | float:
    if isinstance(value, numbers.Integral):
        return int(value)
    if isinstance(value, numbers.Real):
        return float(value)
    raise InvalidRequestError(f"{type(value).__name__} is not a number or JSON value core can read")


def _require_finite(value: object, field_name: str) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            _require_finite(item, _snake_case(str(key)))
    elif isinstance(value, list | tuple):
        for item in value:
            _require_finite(item, field_name)
    elif isinstance(value, numbers.Real) and not _is_finite(value):
        raise InvalidRequestError(f"{field_name} must be a finite number")


def _is_finite(value: numbers.Real) -> bool:
    return isinstance(value, numbers.Integral) or math.isfinite(float(value))


def _snake_case(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
