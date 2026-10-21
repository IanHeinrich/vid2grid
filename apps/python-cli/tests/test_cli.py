import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
from collections.abc import Sequence
from pathlib import Path

import av
import pytest
from helpers import repo_root
from vid2grid import (
    InvalidRequestError,
    TranscriptCue,
    host_capabilities,
    option_specs,
    options,
    plan_from_options,
    probe_video,
    render_from_options,
    request_from_options,
    sheets,
    transcribe,
)

from vid2grid_cli import cli

TINY = repo_root() / "fixtures" / "videos" / "tiny.mp4"
RUN_FLAGS = ["--fps", "4", "--frames-per-grid", "4"]
RUN_VALUES: dict[str, object] = {"targetFps": 4, "framesPerGrid": 4}
OPTION_NAME = re.compile(r"(?<![\w-])--?[A-Za-z][\w-]*")


class _Transcriber:
    def __init__(self, fail: bool) -> None:
        self.fail = fail

    def __call__(
        self, path: str | Path, start_seconds: float, end_seconds: float
    ) -> Sequence[TranscriptCue]:
        if self.fail:
            raise RuntimeError("model unavailable")
        return [TranscriptCue(start=0.25, end=0.75, text="hello")]


@pytest.fixture
def with_transcription(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(transcribe, "available", lambda: True)


@pytest.fixture
def without_transcription(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(transcribe, "available", lambda: False)


def _help(capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setenv("COLUMNS", "1000")
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["--help"])
    assert exit_info.value.code == 0
    return capsys.readouterr().out


@pytest.mark.parametrize("transcription", [True, False])
def test_help_lists_exactly_the_spec_flags_and_the_cli_own(
    transcription: bool, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transcribe, "available", lambda: transcription)
    specs = option_specs(host_capabilities())

    names = set(OPTION_NAME.findall(_help(capsys, monkeypatch)))

    assert names == {f"--{spec['flag']}" for spec in specs} | {
        "-h",
        "--help",
        "-o",
        "--plan-only",
        "--json",
    }
    assert ("--transcript" in names) is transcription


@pytest.mark.usefixtures("with_transcription")
def test_help_shows_each_specs_help_and_default(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    text = " ".join(_help(capsys, monkeypatch).split())

    for spec in option_specs(host_capabilities()):
        assert spec["help"] in text
        if "default" in spec and spec["type"] != "boolean":
            assert f"(default: {spec['default']})" in text


@pytest.mark.usefixtures("without_transcription")
def test_transcript_is_rejected_without_the_extra(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        cli.main([str(TINY), "--transcript", "combined"])

    assert exit_info.value.code == 2
    assert "--transcript" in capsys.readouterr().err


def test_plan_only_prints_the_plan_and_writes_nothing(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    out_dir = tmp_path / "out"

    code = cli.main([str(TINY), *RUN_FLAGS, "--plan-only", "-o", str(out_dir)])

    captured = capsys.readouterr()
    assert code == 0
    assert json.loads(captured.out) == plan_from_options(TINY, RUN_VALUES).plan.to_dict()
    assert captured.err == ""
    assert not out_dir.exists()


def test_plan_only_sends_the_plans_warnings_to_stderr(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreadable(path: str | Path) -> tuple[float, ...]:
        raise av.InvalidDataError(1094995529, "Invalid data found when processing input")

    monkeypatch.setattr(sheets, "read_keyframe_timestamps", unreadable)
    planned = plan_from_options(TINY, {**RUN_VALUES, "keyframeSampling": True})

    code = cli.main([str(TINY), *RUN_FLAGS, "--keyframes", "--plan-only"])

    captured = capsys.readouterr()
    assert code == 0
    assert planned.warnings
    assert json.loads(captured.out) == planned.plan.to_dict()
    assert captured.err.splitlines() == [f"vid2grid: warning: {w}" for w in planned.warnings]


def test_plan_only_with_json_prints_the_plan_results_dict(
    capsys: pytest.CaptureFixture[str],
) -> None:
    code = cli.main([str(TINY), *RUN_FLAGS, "--plan-only", "--json"])

    assert code == 0
    assert json.loads(capsys.readouterr().out) == plan_from_options(TINY, RUN_VALUES).to_dict()


def test_plan_only_with_json_carries_the_plans_warnings(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreadable(path: str | Path) -> tuple[float, ...]:
        raise av.InvalidDataError(1094995529, "Invalid data found when processing input")

    monkeypatch.setattr(sheets, "read_keyframe_timestamps", unreadable)
    values = {**RUN_VALUES, "keyframeSampling": True}

    code = cli.main([str(TINY), *RUN_FLAGS, "--keyframes", "--plan-only", "--json"])

    printed = json.loads(capsys.readouterr().out)
    assert code == 0
    assert printed == plan_from_options(TINY, values).to_dict()
    assert printed["warnings"][0].startswith("Keyframes unavailable (")


def test_a_run_writes_the_sheets_core_names(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    expected = [sheet.file_name for sheet in plan_from_options(TINY, RUN_VALUES).plan.sheets]

    code = cli.main([str(TINY), *RUN_FLAGS, "-o", str(tmp_path)])

    assert code == 0
    assert sorted(path.name for path in tmp_path.iterdir()) == sorted(expected)
    lines = capsys.readouterr().out.splitlines()
    assert [line.split("  ")[0] for line in lines] == [str(tmp_path / name) for name in expected]
    assert all(re.search(r"\d+\.\d\ds to \d+\.\d\ds$", line) for line in lines)


def test_each_line_is_the_captured_range_of_its_sheet(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    result = render_from_options(TINY, tmp_path / "expected", RUN_VALUES)

    assert cli.main([str(TINY), *RUN_FLAGS, "-o", str(tmp_path / "expected")]) == 0

    assert capsys.readouterr().out.splitlines() == [
        f"{sheet.path}  {sheet.first_timestamp_seconds:.2f}s to {sheet.last_timestamp_seconds:.2f}s"
        for sheet in result.sheets
    ]


def test_the_default_output_directory_is_beside_the_video(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    video = tmp_path / "clip.mp4"
    shutil.copy(TINY, video)

    assert cli.main([str(video), *RUN_FLAGS]) == 0

    written = Path(capsys.readouterr().out.splitlines()[0].split("  ")[0])
    assert written.parent.parent == tmp_path
    assert written.parent.name.startswith("clip_grids_")


def test_json_prints_the_render_results_dict(
    capsys: pytest.CaptureFixture[str], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sheets, "_to_ms", lambda seconds: 0)
    expected = render_from_options(TINY, tmp_path / "expected", RUN_VALUES).to_dict()

    code = cli.main([str(TINY), *RUN_FLAGS, "--json", "-o", str(tmp_path / "expected")])

    assert code == 0
    assert json.loads(capsys.readouterr().out) == expected


@pytest.mark.usefixtures("with_transcription")
def test_transcript_paths_are_printed_after_the_sheets(
    capsys: pytest.CaptureFixture[str], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(options, "WhisperTranscriber", lambda: _Transcriber(fail=False))

    code = cli.main([str(TINY), *RUN_FLAGS, "--transcript", "combined", "-o", str(tmp_path)])

    assert code == 0
    assert capsys.readouterr().out.splitlines()[-1] == str(tmp_path / "transcript.vtt")


@pytest.mark.usefixtures("with_transcription")
def test_a_failed_transcription_is_a_warning_on_stderr(
    capsys: pytest.CaptureFixture[str], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(options, "WhisperTranscriber", lambda: _Transcriber(fail=True))

    code = cli.main([str(TINY), *RUN_FLAGS, "--transcript", "combined", "-o", str(tmp_path)])

    captured = capsys.readouterr()
    assert code == 0
    assert "model unavailable" in captured.err
    assert captured.err.startswith("vid2grid: warning: ")
    assert "warning" not in captured.out


def test_a_bad_value_exits_2_with_cores_message(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    with pytest.raises(InvalidRequestError) as core_error:
        request_from_options({"framesPerGrid": 2.5}, probe_video(TINY), host_capabilities())

    code = cli.main([str(TINY), "--frames-per-grid", "2.5", "-o", str(tmp_path / "out")])

    captured = capsys.readouterr()
    assert code == 2
    assert captured.err == f"vid2grid: {core_error.value}\n"
    assert captured.out == ""
    assert not (tmp_path / "out").exists()


def test_a_missing_video_exits_2(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    code = cli.main([str(tmp_path / "absent.mp4")])

    assert code == 2
    assert capsys.readouterr().err == f"vid2grid: video not found: {tmp_path / 'absent.mp4'}\n"


def test_an_unreadable_video_exits_1_without_a_traceback(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    notes = tmp_path / "notes.mp4"
    notes.write_text("not a video", encoding="utf-8")

    code = cli.main([str(notes)])

    err = capsys.readouterr().err
    assert code == 1
    assert err.startswith(f"vid2grid: cannot read {notes}")
    assert "Traceback" not in err


# Setting a module to None in sys.modules makes importing it fail and find_spec return None.
BASE_INSTALL = textwrap.dedent(
    """
    import sys

    for name in ("faster_whisper", "numpy"):
        sys.modules[name] = None

    from vid2grid_cli import cli

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
        timeout=60,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert "--frames-per-grid" in completed.stdout
    assert "--transcript" not in completed.stdout
