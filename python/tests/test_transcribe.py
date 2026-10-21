import importlib.util
import os
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

import av
import numpy as np
import pytest
from av.audio.stream import AudioStream

from vid2grid import transcribe
from vid2grid.contract import TranscriptCue
from vid2grid.errors import NoAudioError
from vid2grid.transcribe import DEFAULT_MODEL, SAMPLE_RATE, WhisperTranscriber, decode_audio

SOURCE_RATE = 48_000
SOURCE_FRAME_SIZE = 4_800
ONSET_SECONDS = 1.5


class _FakeWhisper:
    def __init__(self, segments: list[SimpleNamespace]) -> None:
        self.segments = segments
        self.sample_counts: list[int] = []

    def transcribe(self, samples: np.ndarray) -> tuple[list[SimpleNamespace], None]:
        self.sample_counts.append(len(samples))
        return self.segments, None


def test_available_says_whether_faster_whisper_is_installed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert transcribe.available() == (importlib.util.find_spec("faster_whisper") is not None)
    monkeypatch.setattr(importlib.util, "find_spec", lambda _name: object())
    assert transcribe.available()
    monkeypatch.setattr(importlib.util, "find_spec", lambda _name: None)
    assert not transcribe.available()


def test_decode_audio_gives_16khz_mono_float32_for_the_range(audio_video: Path) -> None:
    samples = decode_audio(audio_video, 0.0, 3.0)

    assert samples.dtype == np.float32
    assert samples.ndim == 1
    assert abs(len(samples) - 3 * SAMPLE_RATE) <= SAMPLE_RATE // 100
    assert float(np.abs(samples).max()) > 0.1


# Silence, then a tone from ONSET_SECONDS, in 0.1 s frames of lossless PCM starting at
# stream_start_seconds, so where the tone lands in the decoded range is exact.
def _write_onset_audio(path: Path, stream_start_seconds: float) -> None:
    with av.open(str(path), "w") as container:
        stream = container.add_stream("pcm_s16le", rate=SOURCE_RATE)
        assert isinstance(stream, AudioStream)
        stream.layout = "mono"
        first_sample = round(stream_start_seconds * SOURCE_RATE)
        seconds = (first_sample + np.arange(3 * SOURCE_RATE)) / SOURCE_RATE
        tone = np.sin(2 * np.pi * 440 * seconds) * (seconds >= ONSET_SECONDS) / 2
        signal = tone.astype(np.float32)
        for start in range(0, len(signal), SOURCE_FRAME_SIZE):
            frame = av.AudioFrame.from_ndarray(
                signal[start : start + SOURCE_FRAME_SIZE].reshape(1, -1),
                format="flt",
                layout="mono",
            )
            frame.sample_rate = SOURCE_RATE
            frame.time_base = Fraction(1, SOURCE_RATE)
            frame.pts = first_sample + start
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


@pytest.mark.parametrize(
    ("stream_start_seconds", "start_seconds"),
    [
        pytest.param(0.0, 0.0, id="from-zero"),
        # The stream starts after the range does, so the decoded audio is padded in front.
        pytest.param(1.0, 0.25, id="lead-padded"),
        # The seek lands on the frame at 1.0 s, so its first 0.05 s is trimmed off.
        pytest.param(0.0, 1.05, id="trimmed"),
    ],
)
def test_decode_audio_puts_the_ranges_start_at_sample_zero(
    tmp_path: Path, stream_start_seconds: float, start_seconds: float
) -> None:
    path = tmp_path / "onset.mkv"
    _write_onset_audio(path, stream_start_seconds)
    end_seconds = 2.5

    samples = decode_audio(path, start_seconds, end_seconds)

    onset = int(np.argmax(np.abs(samples) > 0.05))
    assert len(samples) == round((end_seconds - start_seconds) * SAMPLE_RATE)
    assert abs(onset - round((ONSET_SECONDS - start_seconds) * SAMPLE_RATE)) <= 2
    assert float(np.abs(samples[: onset - 2]).max()) < 0.05


def test_decode_audio_raises_no_audio_for_a_silent_container(curator_mp4: Path) -> None:
    with pytest.raises(NoAudioError) as raised:
        decode_audio(curator_mp4, 0.0, 3.0)
    assert raised.value.code == "no_audio"


def test_whisper_segments_go_through_cores_mapping(
    audio_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    whisper = _FakeWhisper(
        [
            SimpleNamespace(start=0.0, end=0.5, text=" hello "),
            SimpleNamespace(start=0.75, end=1.0, text="there"),
        ]
    )
    loaded: list[tuple[str, str, str]] = []

    def fake_model(model: str, device: str, compute_type: str) -> _FakeWhisper:
        loaded.append((model, device, compute_type))
        return whisper

    monkeypatch.setattr(transcribe, "_whisper_model", fake_model)

    cues = WhisperTranscriber()(audio_video, 1.0, 2.0)

    assert cues == [
        TranscriptCue(start=1.0, end=1.5, text="hello"),
        TranscriptCue(start=1.75, end=2.0, text="there"),
    ]
    assert loaded == [("tiny.en", "cpu", "int8")]
    assert whisper.sample_counts == [SAMPLE_RATE]


def test_whisper_transcriber_raises_no_audio_before_loading_a_model(
    curator_mp4: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_model(model: str, device: str, compute_type: str) -> None:
        raise AssertionError("a model was loaded for a video with no audio")

    monkeypatch.setattr(transcribe, "_whisper_model", no_model)

    with pytest.raises(NoAudioError):
        WhisperTranscriber("tiny")(curator_mp4, 0.0, 3.0)


@pytest.mark.skipif(
    os.environ.get("VID2GRID_WHISPER_TEST") != "1",
    reason="downloads a Whisper model; set VID2GRID_WHISPER_TEST=1 to run it",
)
def test_real_whisper_transcribes_a_tone_into_cues_in_range(audio_video: Path) -> None:
    cues = WhisperTranscriber(DEFAULT_MODEL)(audio_video, 0.5, 3.0)

    assert all(isinstance(cue, TranscriptCue) for cue in cues)
    assert all(0.5 <= cue.start <= cue.end for cue in cues)
