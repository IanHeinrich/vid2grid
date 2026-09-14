from pathlib import Path

import av
import pytest
from PIL import Image, ImageDraw

VIDEO_WIDTH = 320
VIDEO_HEIGHT = 240
VIDEO_FRAME_RATE = 10
VIDEO_FRAME_COUNT = 30


@pytest.fixture(scope="session", params=["mpeg4", "libx264"])
def tiny_video(request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory) -> Path:
    codec = request.param
    path = tmp_path_factory.mktemp("videos") / f"tiny_{codec}.mp4"
    try:
        _write_video(path, codec)
    except (av.FFmpegError, LookupError, ValueError) as exc:
        pytest.skip(f"this PyAV build cannot encode {codec}: {exc}")
    return path


def _write_video(path: Path, codec: str) -> None:
    with av.open(str(path), "w") as container:
        stream = container.add_stream(codec, rate=VIDEO_FRAME_RATE)
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
