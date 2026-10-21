import math
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

import av
import pytest
from helpers import CURATOR_FRAMES, CURATOR_OUTPUT_RESOLUTION, collage_request
from PIL import Image

import vid2grid
from vid2grid import sheets
from vid2grid._core import transcript_files
from vid2grid.contract import TranscriptCue
from vid2grid.errors import NoAudioError
from vid2grid.probe import probe_video
from vid2grid.sheets import WrittenSheet, render_sheets, render_single_sheet
from vid2grid.transcribe import WhisperTranscriber

KEYFRAMES_UNAVAILABLE = "Keyframes unavailable; sampled by target FPS instead"

CUES = (
    TranscriptCue(start=0.25, end=0.75, text="hello"),
    TranscriptCue(start=2.5, end=2.9, text="goodbye"),
)

SHEET_ROW_KEYS = {
    "sheet_path",
    "info",
    "frame_count",
    "first_timestamp_s",
    "last_timestamp_s",
    "timings_ms",
    "vid2grid_version",
}


def test_render_sheets_writes_one_numbered_jpeg_per_sheet(tiny_video: Path, tmp_path: Path) -> None:
    request = collage_request()
    result = render_sheets(tiny_video, request, tmp_path)

    expected = math.ceil(len(result.plan.frames) / request.frames_per_grid)
    assert len(result.sheet_paths) == expected
    assert [path.name for path in result.sheet_paths] == [
        f"grid_{index + 1:04d}.jpg" for index in range(expected)
    ]
    for path in result.sheet_paths:
        assert path.read_bytes()[:3] == b"\xff\xd8\xff"
        with Image.open(path) as sheet:
            assert sheet.size == (request.output_resolution, request.output_resolution)
            assert sheet.format == "JPEG"
    assert result.timings_ms.keys() == {"extracting", "rendering"}
    assert all(isinstance(value, int) for value in result.timings_ms.values())
    assert result.warnings == ()


def test_render_single_sheet_reports_curators_row(tiny_video: Path, tmp_path: Path) -> None:
    out_path = tmp_path / "sheet.jpg"

    result = render_single_sheet(
        tiny_video,
        out_path=out_path,
        frames=CURATOR_FRAMES,
        output_resolution=CURATOR_OUTPUT_RESOLUTION,
    )

    with Image.open(out_path) as sheet:
        assert sheet.size == (CURATOR_OUTPUT_RESOLUTION, CURATOR_OUTPUT_RESOLUTION)
        assert sheet.format == "JPEG"
    row = result.to_sheet_row(str(out_path))
    assert set(row) == SHEET_ROW_KEYS
    assert set(row["info"]) == {"duration_s", "width", "height", "fps", "codec", "rotation"}
    assert row["frame_count"] == CURATOR_FRAMES
    assert row["first_timestamp_s"] == 0.0
    assert row["last_timestamp_s"] > 0
    assert all(isinstance(value, int) for value in row["timings_ms"].values())
    assert row["vid2grid_version"] == vid2grid.__version__
    assert result.to_sheet_row()["sheet_path"] == str(out_path)


def test_render_single_sheet_on_curators_mp4(curator_mp4: Path, tmp_path: Path) -> None:
    out_path = tmp_path / "sheet.jpg"

    result = render_single_sheet(
        curator_mp4,
        out_path=out_path,
        frames=CURATOR_FRAMES,
        output_resolution=CURATOR_OUTPUT_RESOLUTION,
        jpeg_quality=85,
    )

    with Image.open(out_path) as sheet:
        assert sheet.format == "JPEG"
    row = result.to_sheet_row()
    assert row["frame_count"] == CURATOR_FRAMES
    assert (row["info"]["width"], row["info"]["height"]) == (160, 120)


def test_keyframe_sampling_falls_back_to_time_sampling(tiny_video: Path, tmp_path: Path) -> None:
    probed = probe_video(tiny_video, keyframes=True)
    without_keyframes = replace(probed, keyframe_timestamps_seconds=())

    result = render_sheets(
        tiny_video, collage_request(keyframe_sampling=True), tmp_path, info=without_keyframes
    )

    assert result.warnings == (KEYFRAMES_UNAVAILABLE,)
    assert result.plan.frames
    assert result.sheet_paths


def test_a_supplied_info_is_topped_up_with_keyframes(tiny_video: Path, tmp_path: Path) -> None:
    without_keyframes = probe_video(tiny_video)
    assert without_keyframes.keyframe_timestamps_seconds is None
    keyframes = probe_video(tiny_video, keyframes=True).keyframe_timestamps_seconds
    assert keyframes is not None

    result = render_sheets(
        tiny_video, collage_request(keyframe_sampling=True), tmp_path, info=without_keyframes
    )

    assert result.warnings == ()
    assert [frame.timestamp_seconds for frame in result.plan.frames] == [
        timestamp for timestamp in keyframes if 0.0 <= timestamp <= 3.0
    ]


def test_render_sheets_validates_before_probing(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="jpeg_quality must be between 1 and 100"):
        render_sheets(tmp_path / "missing.mp4", collage_request(jpeg_quality=0), tmp_path)


def test_keyframes_outside_the_range_fall_back_too(tiny_video: Path, tmp_path: Path) -> None:
    probed = probe_video(tiny_video)
    only_at_the_start = replace(probed, keyframe_timestamps_seconds=(0.0,))

    result = render_sheets(
        tiny_video,
        collage_request(start_seconds=1.0, keyframe_sampling=True),
        tmp_path,
        info=only_at_the_start,
    )

    assert result.warnings == (KEYFRAMES_UNAVAILABLE,)
    assert result.sheet_paths


def test_a_sheet_whose_frames_were_never_captured_is_dropped(
    tiny_video: Path, tmp_path: Path
) -> None:
    probed = probe_video(tiny_video)
    # Twice the real duration, so the planner plans a second sheet past the end of the stream.
    overlong = replace(probed, duration_seconds=probed.duration_seconds * 2)

    result = render_sheets(
        tiny_video,
        collage_request(end_seconds=overlong.duration_seconds, frame_count=8, frames_per_grid=4),
        tmp_path,
        info=overlong,
    )

    assert len(result.plan.sheets) == 2
    assert [path.name for path in result.sheet_paths] == ["grid_0001.jpg"]
    assert result.frame_count == 4
    assert sorted(path.name for path in tmp_path.iterdir()) == ["grid_0001.jpg"]


def test_a_cut_short_sheet_reports_the_range_it_captured(tiny_video: Path, tmp_path: Path) -> None:
    probed = probe_video(tiny_video)
    overlong = replace(probed, duration_seconds=probed.duration_seconds * 2)

    result = render_sheets(
        tiny_video,
        collage_request(end_seconds=overlong.duration_seconds, frame_count=12, frames_per_grid=4),
        tmp_path,
        info=overlong,
    )

    planned_second = [cell.timestamp_seconds for cell in result.plan.sheets[1].cells]
    assert planned_second == [2.0, 2.5, 3.0, 3.5]
    assert result.sheets == (
        WrittenSheet(tmp_path / "grid_0001.jpg", 0.0, 1.5),
        WrittenSheet(tmp_path / "grid_0002.jpg", 2.0, 2.5),
    )
    assert result.frame_count == 6
    assert (result.first_timestamp_seconds, result.last_timestamp_seconds) == (0.0, 2.5)


def test_a_render_results_dict_is_its_sheets_transcripts_and_run(
    tiny_video: Path, tmp_path: Path
) -> None:
    result = render_sheets(
        tiny_video,
        collage_request(transcript_scope="combined"),
        tmp_path,
        transcriber=_FakeTranscriber(),
    )

    assert result.to_dict() == {
        "sheets": [
            {
                "path": str(sheet.path),
                "firstTimestampSeconds": sheet.first_timestamp_seconds,
                "lastTimestampSeconds": sheet.last_timestamp_seconds,
            }
            for sheet in result.sheets
        ],
        "transcriptPaths": [str(tmp_path / "transcript.vtt")],
        "warnings": [],
        "frameCount": result.frame_count,
        "timingsMs": result.timings_ms,
        "vid2gridVersion": vid2grid.__version__,
    }


def test_render_single_sheet_rejects_an_empty_range(tiny_video: Path, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="end_time must be greater than start_time"):
        render_single_sheet(
            tiny_video, out_path=tmp_path / "sheet.jpg", start_seconds=1.0, end_seconds=1.0
        )


def test_unreadable_keyframes_fall_back_with_the_reason(
    tiny_video: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreadable(path: str | Path) -> tuple[float, ...]:
        raise av.InvalidDataError(1094995529, "Invalid data found when processing input")

    monkeypatch.setattr(sheets, "read_keyframe_timestamps", unreadable)

    result = render_sheets(tiny_video, collage_request(keyframe_sampling=True), tmp_path)

    assert result.warnings == (
        "Keyframes unavailable ([Errno 1094995529] Invalid data found when processing input);"
        " sampled by target FPS instead",
    )
    assert result.sheet_paths


class _FakeTranscriber:
    def __init__(self, cues: Sequence[TranscriptCue] = CUES) -> None:
        self.cues = cues
        self.calls: list[tuple[Path, float, float]] = []

    def __call__(
        self, path: str | Path, start_seconds: float, end_seconds: float
    ) -> Sequence[TranscriptCue]:
        self.calls.append((Path(path), start_seconds, end_seconds))
        return self.cues


class _FailingTranscriber:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def __call__(
        self, path: str | Path, start_seconds: float, end_seconds: float
    ) -> Sequence[TranscriptCue]:
        raise self.error


def test_per_sheet_transcripts_are_cores_files(tiny_video: Path, tmp_path: Path) -> None:
    transcriber = _FakeTranscriber()
    request = collage_request(start_seconds=0.5, transcript_scope="per-sheet")

    result = render_sheets(tiny_video, request, tmp_path, transcriber=transcriber)

    assert transcriber.calls == [(tiny_video, 0.5, 3.0)]
    expected = transcript_files(result.plan, len(result.sheet_paths), 3.0, CUES)
    assert [path.name for path in result.transcript_paths] == [
        f"grid_{index + 1:04d}.vtt" for index in range(len(result.sheet_paths))
    ]
    assert [path.name for path in result.transcript_paths] == [file.file_name for file in expected]
    assert [path.read_bytes() for path in result.transcript_paths] == [
        file.vtt.encode("utf-8") for file in expected
    ]
    assert result.transcript_paths[-1].read_bytes() == (
        b"WEBVTT\n\n00:00:02.500 --> 00:00:02.900\ngoodbye\n"
    )
    assert result.warnings == ()
    assert result.timings_ms.keys() == {"extracting", "rendering", "transcribing"}


def test_a_combined_transcript_is_one_file(tiny_video: Path, tmp_path: Path) -> None:
    request = collage_request(transcript_scope="combined")

    result = render_sheets(tiny_video, request, tmp_path, transcriber=_FakeTranscriber())

    assert [path.name for path in result.transcript_paths] == ["transcript.vtt"]
    assert result.transcript_paths[0].read_text(encoding="utf-8") == (
        "WEBVTT\n\n00:00:00.250 --> 00:00:00.750\nhello\n\n00:00:02.500 --> 00:00:02.900\ngoodbye\n"
    )


def test_no_transcript_is_written_unless_requested(tiny_video: Path, tmp_path: Path) -> None:
    transcriber = _FakeTranscriber()

    result = render_sheets(tiny_video, collage_request(), tmp_path, transcriber=transcriber)

    assert transcriber.calls == []
    assert result.transcript_paths == ()
    assert not list(tmp_path.glob("*.vtt"))


def test_a_failed_transcription_is_cores_warning_and_keeps_the_sheets(
    tiny_video: Path, tmp_path: Path
) -> None:
    result = render_sheets(
        tiny_video,
        collage_request(transcript_scope="per-sheet"),
        tmp_path,
        transcriber=_FailingTranscriber(RuntimeError("decoder crashed")),
    )

    assert result.warnings == ("Transcript generation failed: decoder crashed",)
    assert result.sheet_paths
    assert result.transcript_paths == ()
    assert "transcribing" not in result.timings_ms


def test_no_audio_is_cores_warning(tiny_video: Path, tmp_path: Path) -> None:
    result = render_sheets(
        tiny_video,
        collage_request(transcript_scope="combined"),
        tmp_path,
        transcriber=_FailingTranscriber(NoAudioError("no audio track")),
    )

    assert result.warnings == ("Transcript generation failed: no audio track",)


def test_the_whisper_transcriber_on_a_silent_video_warns_of_no_audio(
    curator_mp4: Path, tmp_path: Path
) -> None:
    result = render_sheets(
        curator_mp4,
        collage_request(transcript_scope="combined"),
        tmp_path,
        transcriber=WhisperTranscriber(),
    )

    assert result.warnings == ("Transcript generation failed: the video has no audio track",)
    assert result.sheet_paths


def test_a_transcript_without_a_transcriber_is_cores_warning(
    tiny_video: Path, tmp_path: Path
) -> None:
    result = render_sheets(tiny_video, collage_request(transcript_scope="per-sheet"), tmp_path)

    assert result.warnings == (
        "Transcript generation failed: this host has no transcription support",
    )
    assert result.sheet_paths
    assert result.transcript_paths == ()
