import io
from pathlib import Path

import av
import pytest
from av.video.stream import VideoStream
from PIL import Image

from vid2grid_mcp.zoom import zoom_frame


def write_video(path: Path, width: int, height: int) -> None:
    with av.open(str(path), "w") as container:
        stream = container.add_stream("mpeg4", rate=10)
        assert isinstance(stream, VideoStream)
        stream.width = width
        stream.height = height
        stream.pix_fmt = "yuv420p"
        picture = av.VideoFrame.from_image(Image.new("RGB", (width, height), "teal"))
        for packet in [*stream.encode(picture), *stream.encode()]:
            container.mux(packet)


@pytest.mark.parametrize(
    ("size", "area", "expected"),
    [
        ((1920, 1080), None, (1920, 1080)),
        ((3840, 2160), None, (3840, 2160)),
        ((480, 854), None, (480, 854)),
        ((1920, 886), None, (1920, 886)),
        ((1920, 1080), [0, 0, 100, 100], (384, 216)),
        ((1920, 1080), [0, 0, 100, 1000], (361, 2032)),
        ((1920, 1080), [0, 0, 900, 900], (2032, 1143)),
        ((3840, 2160), [0, 0, 600, 440], (2304, 950)),
        ((3840, 2160), [0, 500, 1000, 500.4], (3840, 1)),
        ((3840, 2160), [500, 0, 500.2, 1000], (1, 2160)),
        ((1920, 1080), [500, 500, 500.1, 500.1], (2, 2)),
    ],
)
def test_the_picture_is_never_shrunk_and_an_area_at_most_doubled(
    tmp_path: Path,
    size: tuple[int, int],
    area: list[float] | None,
    expected: tuple[int, int],
) -> None:
    video = tmp_path / "video.mp4"
    write_video(video, *size)

    zoomed = zoom_frame(str(video), 0, area, {})

    assert Image.open(io.BytesIO(zoomed.jpeg)).size == expected
    assert (zoomed.width, zoomed.height) == expected


def test_an_output_resolution_keeps_cores_limit_on_thin_areas(tmp_path: Path) -> None:
    video = tmp_path / "video.mp4"
    write_video(video, 3840, 2160)

    with pytest.raises(ValueError, match="too thin"):
        zoom_frame(str(video), 0, [0, 500, 1000, 500.4], {"outputResolution": 512})
