from pathlib import Path

import av
import numpy as np
import pytest
from av.audio.stream import AudioStream
from av.video.stream import VideoStream
from PIL import Image, ImageDraw

VIDEO_WIDTH = 320
VIDEO_HEIGHT = 240
VIDEO_FRAME_RATE = 10
VIDEO_FRAME_COUNT = 30
AUDIO_SAMPLE_RATE = 44_100
AUDIO_FRAME_SIZE = 1024


@pytest.fixture(scope="session")
def curator_mp4() -> Path:
    # Curator's own test asset: 160x120 h264 that never wrote a sample aspect ratio.
    return Path(__file__).resolve().parents[2] / "fixtures" / "videos" / "tiny.mp4"


@pytest.fixture(scope="session", params=["mpeg4", "libx264"])
def tiny_video(request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory) -> Path:
    codec = request.param
    path = tmp_path_factory.mktemp("videos") / f"tiny_{codec}.mp4"
    try:
        _write_video(path, codec)
    except (av.FFmpegError, LookupError, ValueError) as exc:
        pytest.skip(f"this PyAV build cannot encode {codec}: {exc}")
    return path


# fixtures/videos/ has no audio track, so a clip with a tone is made here.
@pytest.fixture(scope="session")
def audio_video(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("videos") / "tone.mp4"
    try:
        _write_video_with_tone(path)
    except (av.FFmpegError, LookupError, ValueError) as exc:
        pytest.skip(f"this PyAV build cannot encode mpeg4 with aac: {exc}")
    return path


def _write_video_with_tone(path: Path) -> None:
    with av.open(str(path), "w") as container:
        video = container.add_stream("mpeg4", rate=VIDEO_FRAME_RATE)
        assert isinstance(video, VideoStream)
        video.width = VIDEO_WIDTH
        video.height = VIDEO_HEIGHT
        video.pix_fmt = "yuv420p"
        audio = container.add_stream("aac", rate=AUDIO_SAMPLE_RATE)
        assert isinstance(audio, AudioStream)
        audio.layout = "mono"
        for index in range(VIDEO_FRAME_COUNT):
            for packet in video.encode(av.VideoFrame.from_image(_source_image(index))):
                container.mux(packet)
        sample_count = AUDIO_SAMPLE_RATE * VIDEO_FRAME_COUNT // VIDEO_FRAME_RATE
        seconds = np.arange(sample_count) / AUDIO_SAMPLE_RATE
        tone = (0.5 * np.sin(2 * np.pi * 440 * seconds)).astype(np.float32)
        for start in range(0, sample_count, AUDIO_FRAME_SIZE):
            frame = av.AudioFrame.from_ndarray(
                tone[start : start + AUDIO_FRAME_SIZE].reshape(1, -1), format="fltp", layout="mono"
            )
            frame.sample_rate = AUDIO_SAMPLE_RATE
            frame.pts = start
            for packet in audio.encode(frame):
                container.mux(packet)
        for packet in video.encode():
            container.mux(packet)
        for packet in audio.encode():
            container.mux(packet)


def _write_video(path: Path, codec: str) -> None:
    with av.open(str(path), "w") as container:
        stream = container.add_stream(codec, rate=VIDEO_FRAME_RATE)
        assert isinstance(stream, VideoStream)
        stream.width = VIDEO_WIDTH
        stream.height = VIDEO_HEIGHT
        stream.pix_fmt = "yuv420p"
        for index in range(VIDEO_FRAME_COUNT):
            for packet in stream.encode(av.VideoFrame.from_image(_source_image(index))):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def _source_image(index: int) -> Image.Image:
    image = Image.new("RGB", (VIDEO_WIDTH, VIDEO_HEIGHT), (index * 8 % 256, 90, 220 - index * 6))
    ImageDraw.Draw(image).text((30, 90), f"frame {index}", fill=(255, 255, 255))
    return image
