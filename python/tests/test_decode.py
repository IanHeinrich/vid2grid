from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

import av
from PIL import Image

from vid2grid.contract import CollageRequest, PlannedFrame, RenderPlan, VideoInfo
from vid2grid.decode import capture_frames
from vid2grid.planner import build_render_plan
from vid2grid.probe import probe


def _plan(info: VideoInfo, *, end_seconds: float, frame_count: int) -> RenderPlan:
    request = CollageRequest(
        start_seconds=0.0,
        end_seconds=end_seconds,
        target_fps=frame_count / end_seconds,
        frames_per_grid=frame_count,
        output_resolution=512,
        jpeg_quality=85,
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
    info = probe(tiny_video)
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
    info = probe(tiny_video, keyframes=True)
    keyframes = info.keyframe_timestamps_seconds
    assert keyframes is not None
    request = CollageRequest(
        start_seconds=0.0,
        end_seconds=info.duration_seconds,
        target_fps=1.0,
        frames_per_grid=4,
        output_resolution=512,
        jpeg_quality=85,
        keyframe_sampling=True,
    )
    plan = build_render_plan(request, info)

    images = capture_frames(tiny_video, plan, info)

    assert len(plan.frames) == len(keyframes)
    assert [image is not None for image in images] == [True] * len(keyframes)


def test_a_sparse_plan_reseeks_to_the_same_frames_as_a_decode_through(tiny_video: Path) -> None:
    without_keyframes = probe(tiny_video)
    with_keyframes = probe(tiny_video, keyframes=True)
    plan = _plan(without_keyframes, end_seconds=5.7, frame_count=2)
    assert [frame.timestamp_seconds for frame in plan.frames] == [0.0, 2.85]

    reference = _decoded_through(tiny_video, plan)
    # The probed keyframe interval shrinks the re-seek threshold below this plan's 2.85 s gap.
    reseeked = capture_frames(tiny_video, plan, with_keyframes)
    straight = capture_frames(tiny_video, plan, without_keyframes)

    assert _bytes(reseeked) == [reference[0].tobytes(), reference[29].tobytes()]
    assert _bytes(straight) == _bytes(reseeked)
