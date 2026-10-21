# Writes fixtures/videos/keyframes-20s.mp4. Run by hand, from apps/python-library/:
#   uv run python ../../scripts/makeKeyframeVideo.py
from pathlib import Path

import av
from av.video.stream import VideoStream
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "videos" / "keyframes-20s.mp4"
WIDTH = 160
HEIGHT = 120
FRAME_RATE = 10
SECONDS = 20
BAR_WIDTH = WIDTH // FRAME_RATE


# Background colour changes each second and a bar steps across each tenth, so any frame can be
# told apart by eye.
def _source_image(index: int) -> Image.Image:
    second, tenth = divmod(index, FRAME_RATE)
    image = Image.new("RGB", (WIDTH, HEIGHT), (second * 12, 120, 240 - second * 12))
    left = tenth * BAR_WIDTH
    ImageDraw.Draw(image).rectangle((left, 0, left + BAR_WIDTH - 1, HEIGHT - 1), fill="white")
    return image


def main() -> None:
    with av.open(str(OUT), "w", options={"fflags": "+bitexact"}) as container:
        stream = container.add_stream(
            "libx264",
            rate=FRAME_RATE,
            options={
                "crf": "30",
                "threads": "1",
                "x264-params": f"keyint={FRAME_RATE}:min-keyint={FRAME_RATE}:scenecut=0",
            },
        )
        assert isinstance(stream, VideoStream)
        stream.width = WIDTH
        stream.height = HEIGHT
        stream.pix_fmt = "yuv420p"
        for index in range(SECONDS * FRAME_RATE):
            for packet in stream.encode(av.VideoFrame.from_image(_source_image(index))):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    print(f"wrote {OUT.relative_to(OUT.parents[2]).as_posix()} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
