from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import av

from . import transcribe
from ._core import HostCapability, grids_folder_name, request_from_options
from .contract import CollagePlanRequest, VideoInfo
from .errors import InternalError, InvalidRequestError
from .probe import probe_video
from .sheets import PlanResult, RenderResult, _plan, render_sheets
from .transcribe import Transcriber, WhisperTranscriber


def host_capabilities() -> tuple[HostCapability, ...]:
    return ("transcription",) if transcribe.available() else ()


# Beside the video and named as the web app names its download folder.
def default_out_dir(path: str | Path, now: datetime | None = None) -> Path:
    video = Path(path)
    return video.parent / grids_folder_name(video.name, now or datetime.now().astimezone())


def plan_from_options(path: str | Path, values: Mapping[str, object]) -> PlanResult:
    with _reading(path):
        request, info = _request(path, values)
        return _plan(path, request, info)


def render_from_options(
    path: str | Path,
    out_dir: str | Path | None,
    values: Mapping[str, object],
    *,
    transcriber: Transcriber | None = None,
) -> RenderResult:
    with _reading(path):
        request, info = _request(path, values)
        if request.transcript_scope is not None and transcriber is None:
            transcriber = WhisperTranscriber()
        directory = default_out_dir(path) if out_dir is None else out_dir
        return render_sheets(path, request, directory, info=info, transcriber=transcriber)


def _request(
    path: str | Path, values: Mapping[str, object]
) -> tuple[CollagePlanRequest, VideoInfo]:
    # _plan reads keyframes itself, so a failed read takes core's fallback rather than raising.
    info = probe_video(path)
    return request_from_options(values, info, host_capabilities()), info


@contextmanager
def _reading(path: str | Path) -> Iterator[None]:
    if not Path(path).is_file():
        raise InvalidRequestError(f"video not found: {path}")
    try:
        yield
    except av.FFmpegError as exc:
        raise InternalError(f"cannot read {path}: {exc}") from exc
