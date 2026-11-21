from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

Grey = NDArray[np.float32]
Rgb = NDArray[np.uint8]

LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)
DOWNSCALE = 2
PIXEL_THRESHOLD = 10.0
ENERGY_FLOOR = 0.25
# Keeps sensor noise, which phase-only correlation weights like texture, from swamping the
# peak. In cycles per pixel at the motion downscale.
SHIFT_LOW_PASS = 0.05
MIN_OVERLAP = 0.3
NOISE_Z = 3.0
V2_POOL = 2
CELL_K = 3.0
V2_FLOOR = 0.5
V2_MIN_SHIFT_PX = 12


def downscale(rgb: Rgb, factor: int = DOWNSCALE) -> NDArray[np.float32]:
    h = rgb.shape[0] // factor * factor
    w = rgb.shape[1] // factor * factor
    blocks = rgb[:h, :w].astype(np.float32).reshape(h // factor, factor, w // factor, factor, -1)
    return blocks.mean(axis=(1, 3), dtype=np.float32)


def grey_small(rgb: Rgb, factor: int = DOWNSCALE) -> Grey:
    return downscale(rgb, factor) @ LUMA


# Colour, not luma: a red ball can match a textured background's brightness.
def colour_diff(a: NDArray[np.float32], b: NDArray[np.float32]) -> Grey:
    diff = np.abs(a - b).mean(axis=2)
    return np.where(diff < PIXEL_THRESHOLD, 0, diff).astype(np.float32)


def phase_shift(reference: Grey, moving: Grey, low_pass: float | None = None) -> tuple[int, int]:
    """(dx, dy) by which the content of `moving` sits displaced from `reference`."""
    h, w = reference.shape
    window = np.outer(np.hanning(h), np.hanning(w))
    a = np.fft.fft2((reference - reference.mean()) * window)
    b = np.fft.fft2((moving - moving.mean()) * window)
    cross = b * np.conj(a)
    cross /= np.maximum(np.abs(cross), 1e-9)
    if low_pass:
        fy = np.fft.fftfreq(h)[:, None]
        fx = np.fft.fftfreq(w)[None, :]
        cross *= np.exp(-(fx**2 + fy**2) / (2 * low_pass**2))
    surface = np.abs(np.fft.ifft2(cross))
    dy, dx = np.unravel_index(int(np.argmax(surface)), surface.shape)
    return (int(dx) - w if dx > w // 2 else int(dx), int(dy) - h if dy > h // 2 else int(dy))


def residual(reference: Grey, moving: Grey, shift: tuple[int, int]) -> float:
    shifted, valid = undo_shift(moving, *shift)
    if valid.mean() < MIN_OVERLAP:
        return float("inf")
    return float(np.abs(shifted - reference)[valid].mean())


# Clean footage aligns exactly with plain phase correlation; noisy footage needs the low-pass,
# so each estimate is checked against the pixels and the closest fit wins, plain first on ties.
def best_shift(
    reference: Grey, moving: Grey, extra: tuple[tuple[int, int], ...] = ()
) -> tuple[int, int]:
    candidates = [
        phase_shift(reference, moving),
        phase_shift(reference, moving, SHIFT_LOW_PASS),
        *extra,
    ]
    return min(candidates, key=lambda shift: residual(reference, moving, shift))


# Far-apart frames of noisy footage can overlap too little, so neighbours are chained as well.
def shifts_to_last(greys: list[Grey]) -> list[tuple[int, int]]:
    chained = [(0, 0)]
    for earlier, later in zip(greys[-2::-1], greys[:0:-1], strict=True):
        dx, dy = phase_shift(later, earlier, SHIFT_LOW_PASS)
        chained.append((chained[-1][0] + dx, chained[-1][1] + dy))
    chained.reverse()
    last = greys[-1]
    return [best_shift(last, grey, (chain,)) for grey, chain in zip(greys, chained, strict=True)]


def undo_shift(
    image: NDArray[np.generic], dx: int, dy: int
) -> tuple[NDArray[np.generic], NDArray[np.bool_]]:
    """Moves `image` back by (dx, dy); the mask marks pixels that had a source."""
    h, w = image.shape[:2]
    out = np.zeros_like(image)
    valid = np.zeros((h, w), dtype=bool)
    if abs(dx) >= w or abs(dy) >= h:
        return out, valid
    target = (slice(max(0, -dy), min(h, h - dy)), slice(max(0, -dx), min(w, w - dx)))
    source = (slice(max(0, dy), min(h, h + dy)), slice(max(0, dx), min(w, w + dx)))
    out[target] = image[source]
    valid[target] = True
    return out, valid


def region_energy(
    diff: Grey, valid: NDArray[np.bool_] | None = None, rows: int = 3, cols: int = 3
) -> NDArray[np.float32]:
    mask = np.ones(diff.shape, dtype=bool) if valid is None else valid
    energy = np.zeros((rows, cols), dtype=np.float32)
    row_bands = np.array_split(np.arange(diff.shape[0]), rows)
    col_bands = np.array_split(np.arange(diff.shape[1]), cols)
    for r, ys in enumerate(row_bands):
        for c, xs in enumerate(col_bands):
            cell = np.ix_(ys, xs)
            count = int(mask[cell].sum())
            energy[r, c] = float(diff[cell][mask[cell]].sum()) / count if count else 0.0
    return energy


# Log scale, so a small object and a whole-frame pan both land inside 1..9.
def quantise(values: NDArray[np.floating] | float, floor: float = ENERGY_FLOOR) -> NDArray[np.int_]:
    array = np.asarray(values, dtype=np.float64)
    digits = 1 + np.floor(np.log2(np.maximum(array, floor) / floor))
    return np.where(array < floor, 0, np.clip(digits, 1, 9)).astype(int)


@dataclass(frozen=True)
class MotionStep:
    shift: tuple[int, int]
    grid: NDArray[np.float32]
    overall: float


def motion_step(earlier: Rgb, later: Rgb, *, align: bool, factor: int = DOWNSCALE) -> MotionStep:
    a = downscale(earlier, factor)
    b = downscale(later, factor)
    dx, dy = best_shift(a @ LUMA, b @ LUMA) if align else (0, 0)
    shifted, valid = undo_shift(b, dx, dy)
    diff = colour_diff(a, shifted)
    overall = float(diff[valid].mean()) if valid.any() else 0.0
    return MotionStep((dx * factor, dy * factor), region_energy(diff, valid), overall)


def shift_words(dx: int, dy: int, min_px: int = 4) -> str:
    parts = []
    if abs(dx) >= min_px:
        parts.append(f"{'right' if dx > 0 else 'left'} {abs(dx)}px")
    if abs(dy) >= min_px:
        parts.append(f"{'down' if dy > 0 else 'up'} {abs(dy)}px")
    return " ".join(parts) or "none"


def grid_digits(grid: NDArray[np.float32], floor: float = ENERGY_FLOOR) -> str:
    return "|".join("".join(str(d) for d in row) for row in quantise(grid, floor))


def robust_spread(values: NDArray[np.floating]) -> float:
    """Median absolute deviation scaled to match a normal distribution's sigma."""
    return float(1.4826 * np.median(np.abs(values - np.median(values))))


# Gain and offset per channel, so flicker and exposure drift do not read as motion.
def match_brightness(
    image: NDArray[np.float32], reference: NDArray[np.float32], valid: NDArray[np.bool_]
) -> NDArray[np.float32]:
    out = np.empty_like(image)
    for c in range(image.shape[2]):
        src, ref = image[..., c][valid], reference[..., c][valid]
        gain = ref.std() / max(float(src.std()), 1e-6)
        out[..., c] = (image[..., c] - src.mean()) * gain + ref.mean()
    return out


def pool(values: NDArray[np.float32], factor: int) -> NDArray[np.float32]:
    h = values.shape[0] // factor * factor
    w = values.shape[1] // factor * factor
    return values[:h, :w].reshape(h // factor, factor, w // factor, factor).mean(axis=(1, 3))


def motion_step_v2(earlier: Rgb, later: Rgb) -> MotionStep:
    a = downscale(earlier)
    b = downscale(later)
    dx, dy = best_shift(a @ LUMA, b @ LUMA)
    shifted, valid = undo_shift(b, dx, dy)
    if not valid.any():
        return MotionStep((dx * DOWNSCALE, dy * DOWNSCALE), np.zeros((3, 3), np.float32), 0.0)
    signed = a - match_brightness(shifted, a, valid)
    sigma = robust_spread(signed[valid])
    excess = np.maximum(np.abs(signed).mean(axis=2) - NOISE_Z * sigma, 0).astype(np.float32)
    # Pooling after the per-pixel cut keeps small objects while averaging out stray specks.
    pooled = pool(np.where(valid, excess, 0), V2_POOL)
    pooled_valid = pool(valid.astype(np.float32), V2_POOL) == 1
    overall = float(pooled[pooled_valid].mean()) if pooled_valid.any() else 0.0
    grid = region_energy(pooled, pooled_valid)
    return MotionStep((dx * DOWNSCALE, dy * DOWNSCALE), grid, overall)


# The clip's own quiet cells set the bar, so steady noise or texture residue stays at 0.
def adaptive_floor(grids: list[NDArray[np.float32]]) -> float:
    values = np.concatenate([g.ravel() for g in grids]) if grids else np.zeros(1)
    return max(V2_FLOOR, float(np.median(values)) + CELL_K * robust_spread(values))


def track_v2(pairs: list[tuple[Rgb, Rgb]]) -> list[tuple[tuple[int, int], str]]:
    steps = [motion_step_v2(earlier, later) for earlier, later in pairs]
    floor = adaptive_floor([step.grid for step in steps])
    return [(step.shift, grid_digits(step.grid, floor)) for step in steps]


Point = tuple[float, float]


def blobs(mask: NDArray[np.bool_], min_area: int = 1) -> list[Point]:
    """Centroids (x, y) of 4-connected regions of at least `min_area` pixels."""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    centroids = []
    for y0, x0 in zip(*np.nonzero(mask), strict=True):
        if seen[y0, x0]:
            continue
        seen[y0, x0] = True
        stack = [(int(y0), int(x0))]
        xs, ys = [], []
        while stack:
            y, x = stack.pop()
            xs.append(x)
            ys.append(y)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(xs) >= min_area:
            centroids.append((float(np.mean(xs)), float(np.mean(ys))))
    return centroids


def predicted(track: list[tuple[int, Point]], step: int) -> Point:
    last_step, (x, y) = track[-1]
    if len(track) < 2:
        return x, y
    previous_step, (px, py) = track[-2]
    span = last_step - previous_step
    ahead = step - last_step
    return x + (x - px) / span * ahead, y + (y - py) / span * ahead


# Prediction keeps crossing objects apart; the last position still catches a sudden turn.
def link_tracks(
    per_step: list[list[Point]], max_jump: float, max_gap: int = 2
) -> list[list[tuple[int, Point]]]:
    tracks: list[list[tuple[int, Point]]] = []
    for step, points in enumerate(per_step):
        live = [t for t in tracks if step - t[-1][0] <= max_gap + 1]
        pairs = sorted(
            (min(float(np.hypot(px - qx, py - qy)), float(np.hypot(px - lx, py - ly))), ti, pi)
            for ti, track in enumerate(live)
            for (qx, qy), (lx, ly) in [(predicted(track, step), track[-1][1])]
            for pi, (px, py) in enumerate(points)
        )
        used_tracks: set[int] = set()
        used_points: set[int] = set()
        for distance, ti, pi in pairs:
            if distance > max_jump or ti in used_tracks or pi in used_points:
                continue
            live[ti].append((step, points[pi]))
            used_tracks.add(ti)
            used_points.add(pi)
        tracks += [[(step, p)] for pi, p in enumerate(points) if pi not in used_points]
    return [t for t in tracks if len(t) >= 2]
