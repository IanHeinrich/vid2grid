import os
import subprocess
import sys
import textwrap
import wave
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import av
import pytest
from helpers import repo_root

from vid2grid import options, sheets, transcribe
from vid2grid._core import build_render_plan, option_specs, request_from_options
from vid2grid.contract import TranscriptCue
from vid2grid.errors import InvalidRequestError
from vid2grid.options import host_capabilities, plan_from_options, render_from_options
from vid2grid.probe import probe_video

VALUES: dict[str, object] = {"targetFps": 4, "framesPerGrid": 4, "outputResolution": 512}
KEYFRAMES_UNREADABLE = (
    "Keyframes unavailable ([Errno 1094995529] Invalid data found when processing input);"
    " sampled by target FPS instead"
)


class _FakeTranscriber:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(
        self, path: str | Path, start_seconds: float, end_seconds: float
    ) -> Sequence[TranscriptCue]:
        self.calls += 1
        return [TranscriptCue(start=0.25, end=0.75, text="hello")]


@pytest.fixture
def with_transcription(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(transcribe, "available", lambda: True)


@pytest.fixture
def without_transcription(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(transcribe, "available", lambda: False)


@pytest.mark.usefixtures("with_transcription")
def test_a_host_with_the_extra_offers_transcription() -> None:
    assert host_capabilities() == ("transcription",)
    assert "transcript" in {spec["name"] for spec in option_specs(host_capabilities())}


@pytest.mark.usefixtures("without_transcription")
def test_a_host_without_the_extra_offers_no_transcription() -> None:
    assert host_capabilities() == ()
    assert "transcript" not in {spec["name"] for spec in option_specs(host_capabilities())}


def test_plan_from_options_is_cores_plan_for_the_probed_video(tiny_video: Path) -> None:
    info = probe_video(tiny_video)

    planned = plan_from_options(tiny_video, VALUES)

    assert planned.plan == build_render_plan(request_from_options(VALUES, info), info)
    assert planned.warnings == ()


def test_plan_from_options_reads_keyframes_for_keyframe_sampling() -> None:
    video = repo_root() / "fixtures" / "videos" / "keyframes-20s.mp4"

    planned = plan_from_options(video, {"keyframeSampling": True, "endSeconds": 5.5})

    assert [frame.timestamp_seconds for frame in planned.plan.frames] == [
        0.0,
        1.0,
        2.0,
        3.0,
        4.0,
        5.0,
    ]


@pytest.fixture
def unreadable_keyframes(monkeypatch: pytest.MonkeyPatch) -> None:
    def unreadable(path: str | Path) -> tuple[float, ...]:
        raise av.InvalidDataError(1094995529, "Invalid data found when processing input")

    monkeypatch.setattr(sheets, "read_keyframe_timestamps", unreadable)


@pytest.mark.usefixtures("unreadable_keyframes")
def test_unreadable_keyframes_take_cores_fallback_and_warn(
    tiny_video: Path, tmp_path: Path
) -> None:
    keyframe_values = {**VALUES, "keyframeSampling": True}

    planned = plan_from_options(tiny_video, keyframe_values)
    result = render_from_options(tiny_video, tmp_path, keyframe_values)

    assert planned.warnings == result.warnings == (KEYFRAMES_UNREADABLE,)
    assert planned.plan == result.plan
    assert result.sheets


def test_a_file_without_a_video_stream_is_an_invalid_request(tmp_path: Path) -> None:
    song = tmp_path / "song.wav"
    with wave.open(str(song), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(bytes(8000 * 2))

    with pytest.raises(InvalidRequestError, match="has no video stream"):
        plan_from_options(song, VALUES)
    with pytest.raises(InvalidRequestError, match="has no video stream"):
        render_from_options(song, tmp_path / "out", VALUES)
    assert not (tmp_path / "out").exists()


def test_a_missing_video_is_an_invalid_request(tmp_path: Path) -> None:
    with pytest.raises(InvalidRequestError, match="video not found"):
        plan_from_options(tmp_path / "absent.mp4", VALUES)


# Setting a module to None in sys.modules makes importing it fail and find_spec return None.
BASE_INSTALL = textwrap.dedent(
    """
    import sys

    for name in ("faster_whisper", "numpy", "mcp"):
        sys.modules[name] = None

    import vid2grid
    from vid2grid import cli

    assert vid2grid.options.host_capabilities() == ()
    try:
        cli.main(["--help"])
    except SystemExit as exit_info:
        assert exit_info.code == 0
    """
)


def test_the_base_install_works_without_the_extras() -> None:
    completed = subprocess.run(
        [sys.executable, "-c", BASE_INSTALL],
        capture_output=True,
        text=True,
        env={**os.environ, "COLUMNS": "1000"},
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert "--frames-per-grid" in completed.stdout
    assert "--transcript" not in completed.stdout


@pytest.mark.usefixtures("with_transcription")
def test_render_from_options_writes_the_requested_transcript(
    tiny_video: Path, tmp_path: Path
) -> None:
    transcriber = _FakeTranscriber()

    result = render_from_options(
        tiny_video, tmp_path, {**VALUES, "transcript": "combined"}, transcriber=transcriber
    )

    assert transcriber.calls == 1
    assert [path.name for path in result.transcript_paths] == ["transcript.vtt"]
    assert result.sheet_paths


@pytest.mark.usefixtures("with_transcription")
def test_render_from_options_defaults_to_whisper_when_a_transcript_is_requested(
    tiny_video: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    made: list[_FakeTranscriber] = []

    def fake_whisper() -> _FakeTranscriber:
        made.append(_FakeTranscriber())
        return made[-1]

    monkeypatch.setattr(options, "WhisperTranscriber", fake_whisper)

    render_from_options(tiny_video, tmp_path / "none", VALUES)
    assert made == []

    result = render_from_options(
        tiny_video, tmp_path / "per-sheet", {**VALUES, "transcript": "per-sheet"}
    )
    assert [transcriber.calls for transcriber in made] == [1]
    assert len(result.transcript_paths) == len(result.sheet_paths)


@pytest.mark.usefixtures("without_transcription")
def test_render_from_options_rejects_a_transcript_without_the_extra(
    tiny_video: Path, tmp_path: Path
) -> None:
    with pytest.raises(InvalidRequestError):
        render_from_options(tiny_video, tmp_path, {**VALUES, "transcript": "combined"})


def test_default_out_dir_sits_beside_the_video_named_as_the_web_app_names_it() -> None:
    now = datetime(2026, 10, 21, 9, 8, 7, tzinfo=UTC)
    assert options.default_out_dir(Path("videos/my clip.mp4"), now) == Path(
        "videos/my clip_grids_2026-10-21_090807"
    )
