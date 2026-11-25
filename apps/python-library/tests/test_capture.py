from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

import av
import pytest
from helpers import collage_request
from PIL import Image

from vid2grid import build_render_plan, capture
from vid2grid.capture import capture_frames
from vid2grid.contract import PictureArea, PlannedFrame, RenderPlan, Size, VideoInfo
from vid2grid.probe import probe_video


def _plan(info: VideoInfo, *, end_seconds: float, frame_count: int) -> RenderPlan:
    request = collage_request(
        end_seconds=end_seconds,
        target_fps=frame_count / end_seconds,
        frames_per_grid=frame_count,
        frame_count=frame_count,
    )
    return build_render_plan(request, info)


def _plan_at(info: VideoInfo, timestamps: Sequence[float]) -> RenderPlan:
    plan = _plan(info, end_seconds=3.0, frame_count=len(timestamps))
    return replace(
        plan,
        frames=tuple(
            PlannedFrame(frame_index=index, timestamp_seconds=timestamp)
            for index, timestamp in enumerate(timestamps)
        ),
    )


def _decoded_through(path: Path, plan: RenderPlan) -> list[Image.Image]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        return [
            frame.reformat(
                width=plan.cell.width,
                height=plan.cell.height,
                format="rgb24",
                interpolation="BICUBIC",
            ).to_image()
            for frame in container.decode(stream)
            if frame.pts is not None
        ]


def _bytes(images: Sequence[Image.Image | None]) -> list[bytes | None]:
    return [None if image is None else image.tobytes() for image in images]


def test_captures_the_first_frame_at_or_after_each_timestamp(tiny_video: Path) -> None:
    info = probe_video(tiny_video)
    # Against a 10 fps source these want the frames at 0.0, 0.5 and 1.0.
    plan = _plan_at(info, [0.0, 0.45, 1.0])
    reference = _decoded_through(tiny_video, plan)

    images = capture_frames(tiny_video, plan, info)

    assert [image.size for image in images if image is not None] == [
        (plan.cell.width, plan.cell.height)
    ] * 3
    assert _bytes(images) == [
        reference[0].tobytes(),
        reference[5].tobytes(),
        reference[10].tobytes(),
    ]


def test_a_keyframe_plan_captures_every_probed_keyframe(tiny_video: Path) -> None:
    info = probe_video(tiny_video, keyframes=True)
    keyframes = info.keyframe_timestamps_seconds
    assert keyframes is not None
    request = collage_request(
        end_seconds=info.duration_seconds, target_fps=1.0, keyframe_sampling=True
    )
    plan = build_render_plan(request, info)

    images = capture_frames(tiny_video, plan, info)

    assert len(plan.frames) == len(keyframes)
    assert [image is not None for image in images] == [True] * len(keyframes)


def test_a_sparse_plan_reseeks_to_the_same_frames_as_a_decode_through(tiny_video: Path) -> None:
    without_keyframes = probe_video(tiny_video)
    with_keyframes = probe_video(tiny_video, keyframes=True)
    plan = _plan(without_keyframes, end_seconds=5.7, frame_count=2)
    assert [frame.timestamp_seconds for frame in plan.frames] == [0.0, 2.85]

    reference = _decoded_through(tiny_video, plan)
    # The probed keyframe interval shrinks the re-seek threshold below this plan's 2.85 s gap.
    reseeked = capture_frames(tiny_video, plan, with_keyframes)
    straight = capture_frames(tiny_video, plan, without_keyframes)

    assert _bytes(reseeked) == [reference[0].tobytes(), reference[29].tobytes()]
    assert _bytes(straight) == _bytes(reseeked)


# Not whole chroma pixels, and off centre so that a wrong turn moves it.
AREA = PictureArea(left=206, top=304, right=506, bottom=775)


def _first_image_unscaled(
    path: Path, info: VideoInfo, area: PictureArea | None
) -> tuple[RenderPlan, Image.Image]:
    plan = build_render_plan(collage_request(frames_per_grid=1, area=area), info)
    size = Size(info.width, info.height)
    if plan.crop is not None:
        size = Size(plan.crop.width, plan.crop.height)
    plan = replace(plan, cell=size, frames=plan.frames[:1])
    (image,) = capture_frames(path, plan, info)
    assert image is not None
    return plan, image


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_a_crop_is_the_same_pixels_of_the_upright_picture(curator_mp4: Path, rotation: int) -> None:
    info = probe_video(curator_mp4)
    if rotation in (90, 270):
        info = replace(info, width=info.height, height=info.width)
    info = replace(info, rotation=rotation)

    _, whole = _first_image_unscaled(curator_mp4, info, None)
    plan, cropped = _first_image_unscaled(curator_mp4, info, AREA)

    crop = plan.crop
    assert crop is not None
    box = (crop.x, crop.y, crop.x + crop.width, crop.y + crop.height)
    assert cropped.size == (crop.width, crop.height)
    assert cropped.tobytes() == whole.crop(box).tobytes()


def test_a_scaled_crop_takes_nothing_from_outside_itself() -> None:
    info = VideoInfo(duration_seconds=3.0, width=64, height=48)
    area = PictureArea(left=250, top=250, right=500, bottom=500)
    plan = build_render_plan(collage_request(frames_per_grid=1, area=area), info)
    assert plan.crop is not None
    assert plan.cell.width > plan.crop.width
    picture = Image.new("RGB", (64, 48), "red")
    picture.paste("blue", (16, 12, 32, 24))

    image = capture._to_cell_image(av.VideoFrame.from_image(picture), plan, info.rotation)

    assert image.getcolors() == [(plan.cell.width * plan.cell.height, (0, 0, 255))]


def test_a_crop_is_scaled_to_the_cell(tiny_video: Path) -> None:
    info = probe_video(tiny_video)
    plan = build_render_plan(collage_request(area=AREA), info)

    images = capture_frames(tiny_video, plan, info)

    assert {image.size for image in images if image is not None} == {plan.cell.as_tuple()}
