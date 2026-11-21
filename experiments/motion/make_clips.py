import argparse
import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
from PIL import Image

from motion import Rgb

WIDTH, HEIGHT, FPS, SECONDS = 640, 360, 30, 5
FRAMES = FPS * SECONDS
WORLD_WIDTH = WIDTH + 2 * 2 * FRAMES + 64
RADIUS = 18
COLOURS = {"red": (230, 40, 40), "blue": (40, 80, 230)}
CLIPS_DIR = Path(__file__).parent / "clips"
HARD_MARGIN = 24
HARD_RADIUS = 11
HARD_COLOURS = {"red": (200, 75, 65), "blue": (70, 95, 185)}
HARD_NOISE = 6.0
HARD_CRF = "34"
BLUR_SAMPLES = 5
# Base design id -> whether its hard copy gets a drifting, flickering background patch.
HARD_DESIGNS = {
    "single_right_slow": False,
    "single_up_fast": True,
    "bounce_right_left": False,
    "bounce_down_up": True,
    "two_cross_horizontal": False,
    "two_apart": True,
    "repeat_3_horizontal": True,
    "repeat_4_vertical": False,
    "pan_camera_right": True,
    "pan_right_ball_left": False,
    "static_clean": False,
    "static_noisy": True,
}
FLIP = {"left": "right", "right": "left", "up": "down", "down": "up", "none": "none"}

Path2D = Callable[[float], tuple[float, float]]


def linear(x: float, y: float, vx: float, vy: float) -> Path2D:
    return lambda t: (x + vx * t, y + vy * t)


def bounce(x: float, y: float, first: tuple[float, float], second: tuple[float, float]) -> Path2D:
    turn = SECONDS / 2

    def at(t: float) -> tuple[float, float]:
        if t < turn:
            return x + first[0] * t, y + first[1] * t
        tx, ty = x + first[0] * turn, y + first[1] * turn
        return tx + second[0] * (t - turn), ty + second[1] * (t - turn)

    return at


def oscillate(x: float, y: float, amplitude: float, cycles: int, axis: str) -> Path2D:
    def at(t: float) -> tuple[float, float]:
        offset = amplitude * (1 - np.cos(2 * np.pi * cycles * t / SECONDS))
        return (x + offset, y) if axis == "x" else (x, y + offset)

    return at


@dataclass(frozen=True)
class Spec:
    id: str
    kind: str
    truth: dict[str, str]
    objects: dict[str, Path2D]
    camera_speed: float = 0.0
    noise: float = 0.0
    seed: int = 0
    hard: bool = False
    distractor: bool = False


def build_specs() -> list[Spec]:
    specs: list[Spec] = []
    speeds = {"slow": (40, 30), "fast": (110, 60)}
    for pace, (horizontal, vertical) in speeds.items():
        for direction, (vx, vy, x, y) in {
            "left": (-horizontal, 0, 560, 180),
            "right": (horizontal, 0, 80, 180),
            "up": (0, -vertical, 320, 330),
            "down": (0, vertical, 320, 30),
        }.items():
            specs.append(
                Spec(
                    f"single_{direction}_{pace}",
                    "single",
                    {"direction_red": direction, "background": "none", "moved": "yes"},
                    {"red": linear(x, y, vx, vy)},
                )
            )

    for name, start, first, second, words in [
        ("bounce_right_left", (120, 180), (120, 0), (-120, 0), ("right", "left")),
        ("bounce_down_up", (320, 60), (0, 90), (0, -90), ("down", "up")),
        ("bounce_left_up", (520, 300), (-120, 0), (0, -90), ("left", "up")),
    ]:
        specs.append(
            Spec(
                name,
                "bounce",
                {
                    "first_direction": words[0],
                    "second_direction": words[1],
                    "background": "none",
                    "moved": "yes",
                },
                {"red": bounce(*start, first, second)},
            )
        )

    for name, red, blue, truth in [
        (
            "two_cross_horizontal",
            linear(60, 180, 110, 0),
            linear(580, 190, -40, 0),
            {"direction_red": "right", "direction_blue": "left", "faster": "red"},
        ),
        (
            "two_cross_vertical",
            linear(330, 330, 0, -30),
            linear(310, 30, 0, 60),
            {"direction_red": "up", "direction_blue": "down", "faster": "blue"},
        ),
        (
            "two_apart",
            linear(320, 320, 0, -40),
            linear(60, 80, 110, 0),
            {"direction_red": "up", "direction_blue": "right", "faster": "blue"},
        ),
        (
            "two_same_speed",
            linear(80, 110, 80, 0),
            linear(80, 250, 80, 0),
            {"direction_red": "right", "direction_blue": "right", "faster": "same"},
        ),
    ]:
        specs.append(
            Spec(
                name,
                "two",
                {**truth, "background": "none", "moved": "yes"},
                {"red": red, "blue": blue},
            )
        )

    for cycles, axis in [(2, "x"), (3, "x"), (4, "y"), (5, "x")]:
        start = (170, 180) if axis == "x" else (320, 70)
        amplitude = 150 if axis == "x" else 110
        specs.append(
            Spec(
                f"repeat_{cycles}_{'horizontal' if axis == 'x' else 'vertical'}",
                "repeat",
                {"count": str(cycles), "background": "none", "moved": "yes"},
                {"red": oscillate(*start, amplitude, cycles, axis)},
            )
        )

    for name, camera, red, red_direction, background in [
        ("pan_camera_right", 60.0, linear(320, 180, 0, 0), "none", "left"),
        ("pan_camera_left", -60.0, linear(320, 180, 0, 0), "none", "right"),
        ("pan_right_ball_left", 60.0, linear(620, 180, -40, 0), "left", "left"),
        ("pan_left_ball_up", -60.0, linear(120, 320, 0, -50), "up", "right"),
    ]:
        specs.append(
            Spec(
                name,
                "pan",
                {"direction_red": red_direction, "background": background, "moved": "yes"},
                {"red": red},
                camera_speed=camera,
            )
        )

    for name, noise in [("static_clean", 0.0), ("static_noisy", 4.0)]:
        specs.append(
            Spec(
                name,
                "static",
                {"direction_red": "none", "background": "none", "moved": "no"},
                {"red": linear(300, 170, 0, 0)},
                noise=noise,
            )
        )

    return [replace(spec, seed=seed) for seed, spec in enumerate(specs, start=1)]


def build_hard_specs(specs: list[Spec]) -> list[Spec]:
    hard = []
    for spec in specs:
        if spec.id not in HARD_DESIGNS:
            continue
        still = spec.kind == "static" or spec.truth.get("direction_red") == "none"
        # Shake moves the picture, so "moved" is yes everywhere; object_moved asks about the balls.
        truth = {**spec.truth, "moved": "yes", "object_moved": "no" if still else "yes"}
        hard.append(
            replace(
                spec,
                id=f"hard_{spec.id}",
                kind=f"hard_{spec.kind}",
                truth=truth,
                seed=1000 + spec.seed,
                noise=HARD_NOISE,
                hard=True,
                distractor=HARD_DESIGNS[spec.id],
            )
        )
    return hard


def world_texture(seed: int, height: int = HEIGHT, width: int = WORLD_WIDTH) -> Rgb:
    rng = np.random.default_rng(seed)
    octaves = np.zeros((height, width), dtype=np.float32)
    for cell, weight in [(64, 0.5), (16, 0.3), (4, 0.2)]:
        coarse = rng.random((height // cell + 2, width // cell + 2)).astype(np.float32)
        image = Image.fromarray((coarse * 255).astype(np.uint8)).resize(
            ((width // cell + 2) * cell, (height // cell + 2) * cell),
            Image.Resampling.BICUBIC,
        )
        octaves += weight * np.asarray(image, dtype=np.float32)[:height, :width] / 255
    # Near-grey, so neither the red and blue balls nor the trail colours blend into it.
    tint = rng.uniform(-12, 12, 3).astype(np.float32)
    dark = rng.uniform(45, 75) + tint
    light = rng.uniform(165, 200) + tint
    gradient = np.linspace(0.85, 1.1, height, dtype=np.float32)[:, None, None]
    world = (dark + octaves[..., None] * (light - dark)) * gradient
    return np.clip(world, 0, 255).astype(np.uint8)


def draw_frame(spec: Spec, world: Rgb, index: int) -> Rgb:
    t = index / FPS
    camera_x = spec.camera_speed * t
    left = round(WORLD_WIDTH / 2 - WIDTH / 2 + camera_x)
    frame = world[:, left : left + WIDTH].copy()
    ys, xs = np.mgrid[0:HEIGHT, 0:WIDTH]
    for colour, path in spec.objects.items():
        x, y = path(t)
        frame[(xs - (x - camera_x)) ** 2 + (ys - y) ** 2 <= RADIUS**2] = COLOURS[colour]
    if spec.noise:
        rng = np.random.default_rng(spec.seed * 10_000 + index)
        frame = np.clip(frame + rng.normal(0, spec.noise, frame.shape), 0, 255).astype(np.uint8)
    return frame


@dataclass(frozen=True)
class HardScene:
    world: np.ndarray
    shake: np.ndarray
    gain: np.ndarray
    patch: tuple[float, float]


def hard_scene(spec: Spec) -> HardScene:
    rng = np.random.default_rng(spec.seed)
    margin = 2 * HARD_MARGIN
    world = world_texture(spec.seed, HEIGHT + margin, WORLD_WIDTH + margin).astype(np.float32)
    world = world.mean() + 0.55 * (world - world.mean())
    kernel = np.ones(7) / 7
    walk = np.stack(
        [np.convolve(rng.normal(size=FRAMES + 6), kernel, "valid") for _ in range(3)], axis=1
    )
    walk /= walk.std(axis=0)
    shake = walk * [3.0, 3.0, 0.35] + rng.normal(size=(FRAMES, 3)) * [0.6, 0.6, 0.05]
    t = np.arange(FRAMES) / FPS
    gain = 1 + 0.035 * np.sin(2 * np.pi * 1.3 * t + rng.uniform(0, 2 * np.pi))
    gain += rng.normal(0, 0.01, FRAMES)
    side = rng.choice([rng.uniform(100, 220), rng.uniform(420, 540)])
    return HardScene(world, shake, gain, (float(side), float(rng.uniform(60, 110))))


def blend_disc(canvas: np.ndarray, cx: float, cy: float, colour: np.ndarray, alpha: float) -> None:
    reach = HARD_RADIUS + 2
    x0, x1 = max(0, int(cx - reach)), min(canvas.shape[1], int(cx + reach) + 1)
    y0, y1 = max(0, int(cy - reach)), min(canvas.shape[0], int(cy + reach) + 1)
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    cover = np.clip(HARD_RADIUS + 0.5 - np.hypot(xs - cx, ys - cy), 0, 1)[..., None] * alpha
    canvas[y0:y1, x0:x1] = canvas[y0:y1, x0:x1] * (1 - cover) + colour * cover


def draw_hard_frame(spec: Spec, scene: HardScene, index: int) -> Rgb:
    t = index / FPS
    left = round(WORLD_WIDTH / 2 - WIDTH / 2 + spec.camera_speed * t)
    canvas = scene.world[:, left : left + WIDTH + 2 * HARD_MARGIN].copy()
    if spec.distractor:
        px = scene.patch[0] + 9 * t - spec.camera_speed * t + HARD_MARGIN
        py = scene.patch[1] + 3 * t + HARD_MARGIN
        ys, xs = np.mgrid[0 : canvas.shape[0], 0 : canvas.shape[1]]
        strength = 0.5 * (0.7 + 0.3 * np.sin(2 * np.pi * 0.6 * t))
        cover = strength * np.exp(-((xs - px) ** 2 + (ys - py) ** 2) / (2 * 22.0**2))
        canvas = canvas * (1 - cover[..., None]) + np.array([205, 195, 150]) * cover[..., None]
    for colour, path in spec.objects.items():
        rgb = np.array(HARD_COLOURS[colour], dtype=np.float32)
        # Sub-frame positions over the exposure blur a moving ball and leave a still one sharp.
        for k in range(BLUR_SAMPLES):
            ts = t - k / (FPS * BLUR_SAMPLES)
            x, y = path(ts)
            cx = x - spec.camera_speed * ts + HARD_MARGIN
            blend_disc(canvas, cx, y + HARD_MARGIN, rgb, 1 / (BLUR_SAMPLES - k))
    canvas *= scene.gain[index]
    dx, dy, angle = scene.shake[index]
    image = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8)).rotate(
        float(angle), resample=Image.Resampling.BILINEAR, translate=(float(dx), float(dy))
    )
    frame = np.asarray(
        image.crop((HARD_MARGIN, HARD_MARGIN, HARD_MARGIN + WIDTH, HARD_MARGIN + HEIGHT)),
        dtype=np.float32,
    )
    rng = np.random.default_rng(spec.seed * 10_000 + index)
    return np.clip(frame + rng.normal(0, spec.noise, frame.shape), 0, 255).astype(np.uint8)


def write_video(path: Path, frames: list[Rgb], crf: str = "18") -> None:
    with av.open(str(path), "w") as container:
        stream = container.add_stream("libx264", rate=FPS)
        stream.width, stream.height, stream.pix_fmt = WIDTH, HEIGHT, "yuv420p"
        stream.options = {"crf": crf, "preset": "medium", "threads": "1"}
        for index, array in enumerate(frames):
            frame = av.VideoFrame.from_ndarray(array, format="rgb24")
            frame.pts = index
            frame.time_base = Fraction(1, FPS)
            container.mux(stream.encode(frame))
        container.mux(stream.encode())


def reversed_truth(truth: dict[str, str]) -> dict[str, str]:
    flipped = {
        k: FLIP.get(v, v) if k.startswith(("direction", "background")) else v
        for k, v in truth.items()
    }
    if "first_direction" in truth:
        flipped["first_direction"] = FLIP.get(truth["second_direction"], "")
        flipped["second_direction"] = FLIP.get(truth["first_direction"], "")
    return flipped


def render_frames(spec: Spec) -> list[Rgb]:
    if spec.hard:
        scene = hard_scene(spec)
        return [draw_hard_frame(spec, scene, i) for i in range(FRAMES)]
    world = world_texture(spec.seed)
    return [draw_frame(spec, world, i) for i in range(FRAMES)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the synthetic clips and their manifest.")
    parser.add_argument(
        "--hard", action="store_true", help="also write the hard_ clips with real-footage problems"
    )
    args = parser.parse_args()
    CLIPS_DIR.mkdir(exist_ok=True)
    manifest = []
    specs = build_specs()
    for spec in specs + (build_hard_specs(specs) if args.hard else []):
        frames = render_frames(spec)
        variants = [(spec.id, frames, spec.truth, None)]
        if not spec.kind.endswith("static"):
            variants.append((f"{spec.id}_rev", frames[::-1], reversed_truth(spec.truth), spec.id))
        for clip_id, clip_frames, truth, reverse_of in variants:
            write_video(CLIPS_DIR / f"{clip_id}.mp4", clip_frames, HARD_CRF if spec.hard else "18")
            manifest.append(
                {
                    "id": clip_id,
                    "kind": spec.kind,
                    "file": f"{clip_id}.mp4",
                    "reverse_of": reverse_of,
                    "objects": sorted(spec.objects),
                    "truth": truth,
                    "seed": spec.seed,
                    "fps": FPS,
                    "seconds": SECONDS,
                }
            )
            print(f"wrote {clip_id}")
    (CLIPS_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"{len(manifest)} clips in {CLIPS_DIR}")


if __name__ == "__main__":
    main()
