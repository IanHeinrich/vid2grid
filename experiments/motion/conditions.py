import json
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from itertools import pairwise
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from vid2grid import (
    capture_frames,
    plan_from_options,
    probe_video,
    render_from_options,
    render_single_sheet,
)

from motion import (
    DOWNSCALE,
    LUMA,
    Point,
    Rgb,
    blobs,
    colour_diff,
    downscale,
    grid_digits,
    link_tracks,
    motion_step,
    quantise,
    shift_words,
    shifts_to_last,
    undo_shift,
)

LONGEST_EDGE = 1024
JPEG_QUALITY = 90
TRAIL_GHOSTS = 6
ONION_PREVIOUS = 7
TRACK_STEP_SECONDS = 0.5
MAX_TRACK_STEPS = 20
DECODE_WIDTH = 640
MAX_DECODED_FRAMES = 300
GRID_MAX_CELLS = 16
FRAME_EDGE = 768
MAX_TRACKS = 4
TRACK1_FLOOR = 0.05
GAP = 8
RED = (255, 40, 40)
# Viridis stops: dark purple for the oldest ghost through to yellow for the newest.
RAMP = [(68, 1, 84), (65, 68, 135), (42, 120, 142), (34, 168, 132), (122, 209, 81), (253, 231, 37)]
LINE_SAMPLES = 12
LINE_COLOURS = [(255, 255, 255), (255, 220, 0), (0, 230, 255), (255, 120, 255)]
OUTLINE = (20, 20, 20)
BLOB_THRESHOLD = 40.0
# At the motion downscale a ball covers about 250 pixels; this drops codec specks.
BLOB_MIN_AREA = 30
MIN_PATH_PX = 10
NATIVE_FPS = {"native_1fps": 1.0, "native_8fps": 8.0, "native_24fps": 24.0}


@dataclass(frozen=True)
class Rendered:
    images: list[Path]
    track: str
    video_fps: float | None = None


# Real footage is scaled to the synthetic clips' width and thinned to a frame budget, with the
# frame rate scaled to match, so every condition sees the same kind of input.
@lru_cache(maxsize=1)
def decode(clip_path: Path) -> tuple[list[Rgb], float]:
    with av.open(str(clip_path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 30)
        width = stream.width or DECODE_WIDTH
        scale = min(1.0, DECODE_WIDTH / width)
        size = (round(width * scale / 2) * 2, round((stream.height or 360) * scale / 2) * 2)
        frames = [
            frame.to_ndarray(format="rgb24")
            if scale == 1
            else frame.reformat(width=size[0], height=size[1]).to_ndarray(format="rgb24")
            for frame in container.decode(stream)
        ]
    stride = max(1, -(-len(frames) // MAX_DECODED_FRAMES))
    return frames[::stride], fps / stride


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def corner_label(image: Image.Image, text: str, size: int = 22) -> None:
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = draw.textbbox((8, 6), text, font=font(size))
    draw.rectangle((left - 4, top - 3, right + 4, bottom + 3), fill=(0, 0, 0))
    draw.text((8, 6), text, fill=RED, font=font(size))


def fit(image: Image.Image) -> Image.Image:
    scale = LONGEST_EDGE / max(image.size)
    if scale >= 1:
        return image
    size = (round(image.width * scale), round(image.height * scale))
    return image.resize(size, Image.Resampling.LANCZOS)


def save(image: Image.Image, out_dir: Path, name: str = "image_1.jpg") -> Path:
    path = out_dir / name
    fit(image.convert("RGB")).save(path, quality=JPEG_QUALITY)
    return path


def pair(left: Rgb, right: Rgb, left_label: str, right_label: str) -> Image.Image:
    a, b = Image.fromarray(left), Image.fromarray(right)
    corner_label(a, left_label)
    corner_label(b, right_label)
    canvas = Image.new("RGB", (a.width + GAP + b.width, a.height), (255, 255, 255))
    canvas.paste(a, (0, 0))
    canvas.paste(b, (a.width + GAP, 0))
    return canvas


def with_strip(panels: Image.Image, strip: Image.Image) -> Image.Image:
    canvas = Image.new("RGB", (panels.width, panels.height + strip.height), (255, 255, 255))
    canvas.paste(panels, (0, 0))
    canvas.paste(strip, (panels.width - strip.width, panels.height))
    return canvas


def ramp_strip(width: int, times: list[float]) -> Image.Image:
    strip = Image.new("RGB", (width, 44), (24, 24, 24))
    draw = ImageDraw.Draw(strip)
    label_width = 150
    swatch = (width - label_width) // len(RAMP)
    draw.text((8, 12), "older -> newer", fill=(255, 255, 255), font=font(18))
    for i, (colour, t) in enumerate(zip(RAMP, times, strict=True)):
        x = label_width + i * swatch
        draw.rectangle((x, 6, x + swatch - 4, 38), fill=colour)
        text_colour = (0, 0, 0) if sum(colour) > 300 else (255, 255, 255)
        draw.text((x + 6, 12), f"{t:.1f}s", fill=text_colour, font=font(16))
    return strip


def aligned_to_last(frames: list[Rgb], indices: list[int]) -> list[tuple[Rgb, np.ndarray]]:
    shifts = shifts_to_last([downscale(frames[i]) @ LUMA for i in indices])
    return [
        undo_shift(frames[i], dx * DOWNSCALE, dy * DOWNSCALE)
        for i, (dx, dy) in zip(indices, shifts, strict=True)
    ]


def evenly(count: int, last: int, step: int) -> list[int]:
    return [max(0, last - step * k) for k in range(count, 0, -1)]


def trail_image(frames: list[Rgb], fps: float, legend: bool) -> Image.Image:
    last = len(frames) - 1
    step = last // TRAIL_GHOSTS
    indices = evenly(TRAIL_GHOSTS, last, step)
    final = frames[last]
    aligned = aligned_to_last(frames, [*indices, last])[:-1]
    stack = np.stack([a for a, _ in aligned] + [final]).astype(np.float32)
    background = np.median(stack, axis=0)
    out = final.astype(np.float32)
    for (ghost, valid), colour in zip(aligned, RAMP, strict=True):
        ghost_f = ghost.astype(np.float32)
        moved = (
            valid
            & (np.abs(ghost_f - final).mean(axis=2) > 30)
            & (np.abs(ghost_f - background).mean(axis=2) > 30)
        )
        tint = 0.2 * ghost_f + 0.8 * np.array(colour, dtype=np.float32)
        out[moved] = 0.15 * out[moved] + 0.85 * tint[moved]
    trail = np.clip(out, 0, 255).astype(np.uint8)
    times = [i / fps for i in indices]
    panels = pair(
        final,
        trail,
        f"frame {last + 1} (final)",
        f"trail: frames {indices[0] + 1}-{last + 1}",
    )
    return with_strip(panels, ramp_strip(final.shape[1], times)) if legend else panels


def text_strip(width: int, text: str) -> Image.Image:
    strip = Image.new("RGB", (width, 44), (24, 24, 24))
    ImageDraw.Draw(strip).text((8, 12), text, fill=(255, 255, 255), font=font(18))
    return strip


def object_tracks(frames: list[Rgb], indices: list[int]) -> list[list[tuple[int, Point]]]:
    smalls = [downscale(frames[i]) for i in indices]
    shifts = shifts_to_last([small @ LUMA for small in smalls])
    aligned = []
    for small, (dx, dy) in zip(smalls, shifts, strict=True):
        shifted, valid = undo_shift(small, dx, dy)
        aligned.append(np.where(valid[..., None], shifted, np.nan))
    background = np.nanmedian(np.stack(aligned), axis=0)
    per_step = []
    for frame in aligned:
        diff = np.nan_to_num(np.abs(frame - background).mean(axis=2), nan=0.0)
        per_step.append(blobs(diff > BLOB_THRESHOLD, BLOB_MIN_AREA))
    return link_tracks(per_step, max_jump=0.5 * smalls[0].shape[1])


def draw_path(draw: ImageDraw.ImageDraw, points: list[Point], colour: tuple[int, int, int]) -> None:
    draw.line(points, fill=OUTLINE, width=7, joint="curve")
    draw.line(points, fill=colour, width=3, joint="curve")
    for x, y in points[:-1]:
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=OUTLINE)
        draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=colour)
    tip = np.array(points[-1])
    previous = next((np.array(p) for p in reversed(points[:-1]) if np.hypot(*(tip - p)) > 1), None)
    if previous is None:
        return
    direction = (tip - previous) / np.hypot(*(tip - previous))
    normal = np.array([-direction[1], direction[0]])
    head = [
        tip + direction * 4,
        tip - direction * 14 + normal * 8,
        tip - direction * 14 - normal * 8,
    ]
    draw.polygon([tuple(v) for v in head], fill=colour, outline=OUTLINE, width=2)


def path_length(points: list[Point]) -> float:
    return float(sum(np.hypot(b[0] - a[0], b[1] - a[1]) for a, b in pairwise(points)))


def lines_image(frames: list[Rgb], fps: float) -> Image.Image:
    last = len(frames) - 1
    indices = sorted({round(i) for i in np.linspace(0, last, LINE_SAMPLES)})
    overlay = Image.fromarray(frames[last])
    draw = ImageDraw.Draw(overlay)
    paths = []
    for track in object_tracks(frames, indices):
        points = [(x * DOWNSCALE, y * DOWNSCALE) for _, (x, y) in track]
        xs, ys = zip(*points, strict=True)
        if max(max(xs) - min(xs), max(ys) - min(ys)) >= MIN_PATH_PX:
            paths.append(points)
    # Busy real footage can give many tracks; only the longest few stay readable.
    paths = sorted(paths, key=path_length, reverse=True)[:MAX_TRACKS]
    for points, colour in zip(paths, LINE_COLOURS * len(paths), strict=False):
        draw_path(draw, points, colour)
    panels = pair(
        frames[last],
        np.asarray(overlay),
        f"frame {last + 1} (final)",
        f"paths: frames {indices[0] + 1}-{last + 1}",
    )
    strip = text_strip(frames[last].shape[1], "line = path over the clip, arrow = where it ended")
    return with_strip(panels, strip)


def onion_image(frames: list[Rgb], fps: float) -> Image.Image:
    last = len(frames) - 1
    indices = [*evenly(ONION_PREVIOUS, last, last // (ONION_PREVIOUS + 1)), last]
    weights = np.array([0.7 ** (len(indices) - 1 - k) for k in range(len(indices))])
    weights /= weights.sum()
    blend = sum(w * frames[i].astype(np.float32) for w, i in zip(weights, indices, strict=True))
    onion = np.clip(blend, 0, 255).astype(np.uint8)
    return pair(
        frames[last],
        onion,
        f"frame {last + 1} (final)",
        f"blend: frames {indices[0] + 1}-{last + 1}",
    )


def heat_colours(values: np.ndarray) -> np.ndarray:
    v = np.clip(values, 0, 1)[..., None]
    stops = np.array([[0, 0, 0], [180, 20, 20], [255, 160, 0], [255, 255, 255]], dtype=np.float32)
    position = v * (len(stops) - 1)
    low = np.floor(position).astype(int).clip(0, len(stops) - 2)
    frac = position - low
    return stops[low[..., 0]] * (1 - frac) + stops[low[..., 0] + 1] * frac


def diff_image(frames: list[Rgb], fps: float) -> Image.Image:
    last = len(frames) - 1
    final = frames[last]
    final_grey = downscale(final) @ LUMA
    sampled = list(range(last % 2, last + 1, 2))
    smalls = [downscale(frames[i]) for i in sampled]
    shifts = shifts_to_last([small @ LUMA for small in smalls])
    previous: tuple[np.ndarray, np.ndarray] | None = None
    total = np.zeros(final_grey.shape, dtype=np.float32)
    for small, (dx, dy) in zip(smalls, shifts, strict=True):
        shifted, valid = undo_shift(small, dx, dy)
        if previous is not None:
            both = valid & previous[1]
            total += np.where(both, colour_diff(shifted, previous[0]), 0)
        previous = (shifted, valid)
    heat = heat_colours(total / 300)
    heat_full = np.asarray(
        Image.fromarray(heat.astype(np.uint8)).resize(
            (final.shape[1], final.shape[0]), Image.Resampling.BILINEAR
        ),
        dtype=np.float32,
    )
    dimmed = (final.astype(np.float32) @ LUMA)[..., None] * 0.35
    shown = np.clip(np.maximum(dimmed, heat_full), 0, 255).astype(np.uint8)
    return pair(final, shown, f"frame {last + 1} (final)", "change over the whole clip")


def step_frames(frames: list[Rgb], fps: float) -> int:
    seconds = len(frames) / fps
    target = max(TRACK_STEP_SECONDS, np.ceil(seconds / MAX_TRACK_STEPS / 0.5) * 0.5)
    return max(1, round(target * fps))


def step_seconds(frames: list[Rgb], fps: float) -> float:
    return round(step_frames(frames, fps) / fps, 2)


def track_steps(frames: list[Rgb], fps: float) -> list[tuple[float, int, int]]:
    step = step_frames(frames, fps)
    last = len(frames) - 1
    return [(start / fps, start, min(start + step, last)) for start in range(0, last, step)]


def stamp(seconds: float) -> str:
    return f"{int(seconds // 60)}:{seconds % 60:04.1f}"


def track1(frames: list[Rgb], fps: float) -> str:
    digits = [
        int(quantise(motion_step(frames[a], frames[b], align=False).overall, TRACK1_FLOOR))
        for _, a, b in track_steps(frames, fps)
    ]
    step = step_seconds(frames, fps)
    return f"motion per {step:g} s from 0:00.0: {''.join(str(d) for d in digits)}"


def track3x3(frames: list[Rgb], fps: float, camera: bool) -> str:
    lines = []
    for t, a, b in track_steps(frames, fps):
        step = motion_step(frames[a], frames[b], align=camera)
        bg = f"bg {shift_words(*step.shift)} " if camera else ""
        lines.append(f"[{stamp(t)}] {bg}{grid_digits(step.grid)}")
    step = step_seconds(frames, fps)
    header = [] if step == TRACK_STEP_SECONDS else [f"(each step is {step:g} s, not 0.5 s)"]
    return "\n".join(header + lines)


def one_per_second(clip_path: Path, edge: int) -> tuple[dict[str, object], int]:
    options: dict[str, object] = {"targetFps": 1, "outputResolution": edge}
    frame_count = len(plan_from_options(clip_path, {**options, "framesPerGrid": 100}).plan.frames)
    if frame_count > GRID_MAX_CELLS:
        seconds = probe_video(clip_path).duration_seconds
        options = {**options, "targetFps": GRID_MAX_CELLS / seconds, "frameCount": GRID_MAX_CELLS}
        frame_count = GRID_MAX_CELLS
    return options, frame_count


def grid_sheets(clip_path: Path, out_dir: Path) -> list[Path]:
    options, frame_count = one_per_second(clip_path, LONGEST_EDGE)
    # One sheet sized to the frame count, so a 5 s clip gets five large cells, not a sparse 4x4.
    result = render_from_options(
        clip_path, out_dir / "sheets", {**options, "framesPerGrid": frame_count}
    )
    return [Path(sheet.path) for sheet in result.sheets]


# The grid's own sample times and stamp text, one cell per sheet, so only the packing differs.
def render_frames(clip_path: Path, out_dir: Path) -> Rendered:
    options, _ = one_per_second(clip_path, FRAME_EDGE)
    planned = plan_from_options(clip_path, {**options, "framesPerGrid": 1})
    sheets = planned.plan.to_dict()["sheets"]
    images = capture_frames(clip_path, planned.plan, planned.info)
    paths = []
    for number, (sheet, image) in enumerate(zip(sheets, images, strict=True), start=1):
        if image is None:
            continue
        mark = next(w for w in sheet["cells"][0]["watermarks"] if w["anchor"] == "top-left")
        scale = FRAME_EDGE / max(image.size)
        frame = image.convert("RGB").resize(
            (round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS
        )
        ImageDraw.Draw(frame).text(
            (6, 4),
            mark["text"],
            fill="black",
            font=font(mark["fontSizePx"]),
            stroke_width=mark["strokeWidthPx"],
            stroke_fill="white",
        )
        path = out_dir / f"frame_{number:02d}.jpg"
        frame.save(path, quality=JPEG_QUALITY)
        paths.append(path)
    return Rendered(paths, "")


def render_grid(clip_path: Path, out_dir: Path) -> Rendered:
    return Rendered(grid_sheets(clip_path, out_dir), "")


def render_burst(clip_path: Path, out_dir: Path) -> Rendered:
    path = out_dir / "image_1.jpg"
    render_single_sheet(clip_path, out_path=path, frames=16, output_resolution=LONGEST_EDGE)
    return Rendered([path], "")


def from_frames(
    build: Callable[[list[Rgb], float], Image.Image],
) -> Callable[[Path, Path], Rendered]:
    def render(clip_path: Path, out_dir: Path) -> Rendered:
        frames, fps = decode(clip_path)
        return Rendered([save(build(frames, fps), out_dir)], "")

    return render


def with_track(build: Callable[[list[Rgb], float], str]) -> Callable[[Path, Path], Rendered]:
    def render(clip_path: Path, out_dir: Path) -> Rendered:
        frames, fps = decode(clip_path)
        return Rendered(grid_sheets(clip_path, out_dir), build(frames, fps))

    return render


def native_video(fps: float) -> Callable[[Path, Path], Rendered]:
    def render(clip_path: Path, out_dir: Path) -> Rendered:
        return Rendered([], "", fps)

    return render


def supports(condition: str, provider: str) -> bool:
    return condition not in NATIVE_FPS or provider == "gemini"


def middle_frame(frames: list[Rgb], fps: float) -> Image.Image:
    middle = len(frames) // 2
    image = Image.fromarray(frames[middle])
    corner_label(image, f"frame {middle + 1}")
    return image


CONDITIONS: dict[str, Callable[[Path, Path], Rendered]] = {
    "single_frame": from_frames(middle_frame),
    "grid_1fps": render_grid,
    "burst": render_burst,
    "frames_1fps": render_frames,
    "trail_pair": from_frames(lambda f, fps: trail_image(f, fps, legend=True)),
    "trail_pair_nolegend": from_frames(lambda f, fps: trail_image(f, fps, legend=False)),
    "trail_lines": from_frames(lines_image),
    "onion_pair": from_frames(onion_image),
    "diff_pair": from_frames(diff_image),
    "grid_track1": with_track(track1),
    "grid_track3x3": with_track(lambda f, fps: track3x3(f, fps, camera=False)),
    "grid_track3x3_cam": with_track(lambda f, fps: track3x3(f, fps, camera=True)),
    **{name: native_video(fps) for name, fps in NATIVE_FPS.items()},
}


def render(condition: str, clip_path: Path, out_dir: Path) -> Rendered:
    meta_path = out_dir / "rendered.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text())
        images = [out_dir / name for name in meta["images"]]
        return Rendered(images, meta["track"], meta.get("video_fps"))
    out_dir.mkdir(parents=True, exist_ok=True)
    rendered = CONDITIONS[condition](clip_path, out_dir)
    images = [path.relative_to(out_dir).as_posix() for path in rendered.images]
    meta = {"images": images, "track": rendered.track, "video_fps": rendered.video_fps}
    meta_path.write_text(json.dumps(meta, indent=2))
    if rendered.track:
        (out_dir / "track.txt").write_text(rendered.track + "\n")
    return rendered
