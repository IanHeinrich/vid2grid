import functools
import importlib
import importlib.util
from collections.abc import Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

import av

from ._core import TranscriptSegmentJson, cues_from_segments
from .contract import TranscriptCue
from .errors import NoAudioError
from .probe import stream_time_base

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt

SAMPLE_RATE = 16_000
# The English-only tiny model, like the browser's Xenova/whisper-tiny.en.
DEFAULT_MODEL = "tiny.en"


class Transcriber(Protocol):
    def __call__(
        self, path: str | Path, start_seconds: float, end_seconds: float
    ) -> Sequence[TranscriptCue]: ...


def available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def decode_audio(
    path: str | Path, start_seconds: float, end_seconds: float
) -> "npt.NDArray[np.float32]":
    import numpy as np

    with av.open(str(path)) as container:
        if not container.streams.audio:
            raise NoAudioError("the video has no audio track")
        stream = container.streams.audio[0]
        if start_seconds > 0:
            container.seek(int(start_seconds / stream_time_base(stream)), stream=stream)
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
        chunks: list[npt.NDArray[np.float32]] = []
        first_seconds: float | None = None
        for frame in container.decode(stream):
            frame_seconds = frame.time
            if frame_seconds is None:
                continue
            if frame_seconds >= end_seconds:
                break
            if frame_seconds + frame.samples / frame.sample_rate <= start_seconds:
                continue
            if first_seconds is None:
                first_seconds = frame_seconds
            chunks.extend(_mono(resampled) for resampled in resampler.resample(frame))
        chunks.extend(_mono(resampled) for resampled in resampler.resample(None))

    wanted = max(0, round((end_seconds - start_seconds) * SAMPLE_RATE))
    if first_seconds is None or not chunks:
        return np.zeros(0, dtype=np.float32)
    samples = np.concatenate(chunks)
    # Audio that starts after start_seconds is padded so sample 0 stays at start_seconds,
    # which is the offset cues are put back on the video's timeline with.
    lead = round((first_seconds - start_seconds) * SAMPLE_RATE)
    if lead > 0:
        samples = np.concatenate([np.zeros(lead, dtype=np.float32), samples])
    else:
        samples = samples[-lead:]
    return samples[:wanted]


class WhisperTranscriber:
    def __init__(
        self, model: str = DEFAULT_MODEL, *, device: str = "cpu", compute_type: str = "int8"
    ) -> None:
        self.model = model
        self.device = device
        self.compute_type = compute_type

    def __call__(
        self, path: str | Path, start_seconds: float, end_seconds: float
    ) -> list[TranscriptCue]:
        samples = decode_audio(path, start_seconds, end_seconds)
        if samples.size == 0:
            return []
        whisper = _whisper_model(self.model, self.device, self.compute_type)
        segments, _ = whisper.transcribe(samples)
        return cues_from_segments([_segment_json(segment) for segment in segments], start_seconds)


def _segment_json(segment: Any) -> TranscriptSegmentJson:
    return {"start": float(segment.start), "end": float(segment.end), "text": str(segment.text)}


# Loading the weights is the slow part, so one model serves every call that names it.
@functools.cache
def _whisper_model(model: str, device: str, compute_type: str) -> Any:
    faster_whisper = importlib.import_module("faster_whisper")
    return faster_whisper.WhisperModel(model, device=device, compute_type=compute_type)


def _mono(frame: av.AudioFrame) -> "npt.NDArray[np.float32]":
    import numpy as np

    return np.asarray(frame.to_ndarray(), dtype=np.float32).reshape(-1)
