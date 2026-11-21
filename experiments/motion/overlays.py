import itertools
from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

from motion import Rgb, robust_spread

Matrix = NDArray[np.float64]
Mask = NDArray[np.bool_]
Path2 = list[tuple[float, float, float]]

WINDOW_SECONDS = 1.0
MIN_WINDOWS = 2
MAX_WINDOWS = 4
SECONDS_PER_WINDOW = 3.0
TRACK_FPS = 12.0
CUT_FLOOR = 25.0
CUT_K = 8.0
MAX_POINTS = 400
MIN_POINT_GAP = 7
FB_ERROR_PX = 1.0
RANSAC_PX = 2.0
MIN_RAW_MOTION_PX = 2.0
MIN_EXTENT = 0.02
MAX_WIGGLE = 4.0
CLUSTER_RADIUS = 0.2
CLUSTER_COSINE = 0.6
MIN_MEMBERS = 3
MAX_MOVERS = 3
GHOST_FRACTIONS = (0.0, 1 / 3, 2 / 3)
GHOST_MIN_DIFF = 25.0
GHOST_K = 4.0
GHOST_MIN_AREA = 0.002
MAX_GHOST_AREA = 0.15
SCREEN_STATIC_STD = 4.0


@dataclass(frozen=True)
class Tracked:
    frames: list[Rgb]
    times: list[float]
    to_last: list[Matrix]


@dataclass(frozen=True)
class Window:
    start: float
    end: float
    final: Rgb
    camera: str


@dataclass(frozen=True)
class PathWindow(Window):
    movers: list[Path2]


@dataclass(frozen=True)
class GhostWindow(Window):
    ghosts: list[tuple[float, Rgb, Mask]]
    skipped: bool


def grey(rgb: Rgb) -> NDArray[np.uint8]:
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)


# A cut shows as a spike in frame-to-frame difference far above the clip's usual change.
def cut_starts(frames: list[Rgb]) -> list[int]:
    small = [cv2.resize(grey(f), (80, 45), interpolation=cv2.INTER_AREA) for f in frames]
    diffs = np.array(
        [float(np.abs(b.astype(np.float32) - a).mean()) for a, b in itertools.pairwise(small)]
    )
    if not len(diffs):
        return []
    level = max(CUT_FLOOR, float(np.median(diffs)) + CUT_K * robust_spread(diffs))
    return [i + 1 for i, d in enumerate(diffs) if d > level]


def windows(frames: list[Rgb], fps: float) -> list[tuple[int, int]]:
    last = len(frames) - 1
    count = min(MAX_WINDOWS, max(MIN_WINDOWS, round(len(frames) / fps / SECONDS_PER_WINDOW)))
    span = max(2, round(WINDOW_SECONDS * fps))
    cuts = cut_starts(frames)
    chosen = []
    for k in range(count):
        end = round((k + 1) / count * last)
        start = max(0, end - span)
        start = max([start, *(c for c in cuts if start < c <= end)])
        if end - start >= 2:
            chosen.append((start, end))
    return chosen


def seed_points(image: NDArray[np.uint8], existing: NDArray[np.float32]) -> NDArray[np.float32]:
    mask = np.full(image.shape, 255, dtype=np.uint8)
    for x, y in existing:
        cv2.circle(mask, (round(float(x)), round(float(y))), MIN_POINT_GAP, 0, -1)
    wanted = MAX_POINTS - len(existing)
    if wanted <= 0:
        return np.zeros((0, 2), np.float32)
    found = cv2.goodFeaturesToTrack(image, wanted, 0.01, MIN_POINT_GAP, mask=mask)
    return np.zeros((0, 2), np.float32) if found is None else found.reshape(-1, 2)


def homogeneous(affine: Matrix | None) -> Matrix:
    out = np.eye(3)
    if affine is not None:
        out[:2] = affine
    return out


# Each point is tracked frame to frame and kept only if tracking it back lands where it began.
def track_points(greys: list[NDArray[np.uint8]]) -> tuple[dict[int, Path2], list[Matrix]]:
    paths: dict[int, Path2] = {}
    points = np.zeros((0, 2), np.float32)
    ids: list[int] = []
    steps: list[Matrix] = []
    for t in range(len(greys) - 1):
        fresh = seed_points(greys[t], points)
        new_ids = list(range(len(paths), len(paths) + len(fresh)))
        for i, (x, y) in zip(new_ids, fresh, strict=True):
            paths[i] = [(t, float(x), float(y))]
        points = np.vstack([points, fresh]).astype(np.float32)
        ids += new_ids
        if len(points) == 0:
            steps.append(np.eye(3))
            continue
        ahead, ok, _ = cv2.calcOpticalFlowPyrLK(greys[t], greys[t + 1], points, None)
        back, ok_back, _ = cv2.calcOpticalFlowPyrLK(greys[t + 1], greys[t], ahead, None)
        error = np.linalg.norm(back - points, axis=1)
        good = (ok.ravel() == 1) & (ok_back.ravel() == 1) & (error < FB_ERROR_PX)
        affine = None
        if good.sum() >= 6:
            affine, _ = cv2.estimateAffinePartial2D(
                points[good], ahead[good], method=cv2.RANSAC, ransacReprojThreshold=RANSAC_PX
            )
        steps.append(homogeneous(affine))
        ids = [i for i, keep in zip(ids, good, strict=True) if keep]
        points = ahead[good]
        for i, (x, y) in zip(ids, points, strict=True):
            paths[i].append((t + 1, float(x), float(y)))
    to_last = [np.eye(3)]
    for step in reversed(steps):
        to_last.append(to_last[-1] @ step)
    to_last.reverse()
    return paths, to_last


def track_window(
    frames: list[Rgb], fps: float, start: int, end: int
) -> tuple[Tracked, dict[int, Path2]]:
    stride = max(1, round(fps / TRACK_FPS))
    indices = list(range(start, end + 1, stride))
    indices = indices if indices[-1] == end else [*indices, end]
    chosen = [frames[i] for i in indices]
    paths, to_last = track_points([grey(f) for f in chosen])
    return Tracked(chosen, [i / fps for i in indices], to_last), paths


def to_last_frame(path: Path2, to_last: list[Matrix]) -> NDArray[np.float64]:
    return np.array([(to_last[int(t)] @ (x, y, 1.0))[:2] for t, x, y in path])


def extent(points: NDArray[np.float64]) -> float:
    return float(np.linalg.norm(points - points[0], axis=1).max())


# Screen-fixed points (watermarks, captions) stay put in raw coordinates; real movers do not.
def moving_tracks(
    paths: dict[int, Path2], to_last: list[Matrix], width: int
) -> list[tuple[NDArray[np.int_], NDArray[np.float64]]]:
    min_steps = max(3, len(to_last) // 2)
    kept = []
    for path in paths.values():
        if len(path) < min_steps:
            continue
        raw = np.array([(x, y) for _, x, y in path])
        if extent(raw) < MIN_RAW_MOTION_PX:
            continue
        stable = to_last_frame(path, to_last)
        reach = extent(stable)
        length = float(np.linalg.norm(np.diff(stable, axis=0), axis=1).sum())
        if reach >= MIN_EXTENT * width and length <= MAX_WIGGLE * reach:
            kept.append((np.array([int(t) for t, _, _ in path]), stable))
    return kept


def cluster_movers(
    tracks: list[tuple[NDArray[np.int_], NDArray[np.float64]]], width: int, steps: int
) -> list[list[tuple[int, float, float]]]:
    order = sorted(range(len(tracks)), key=lambda i: -extent(tracks[i][1]))
    unused = set(order)
    movers = []
    for seed in order:
        if seed not in unused:
            continue
        seed_end = tracks[seed][1][-1]
        seed_move = tracks[seed][1][-1] - tracks[seed][1][0]
        members = []
        for i in order:
            if i not in unused:
                continue
            move = tracks[i][1][-1] - tracks[i][1][0]
            cosine = float(move @ seed_move) / max(
                float(np.linalg.norm(move) * np.linalg.norm(seed_move)), 1e-9
            )
            near = np.linalg.norm(tracks[i][1][-1] - seed_end) < CLUSTER_RADIUS * width
            if near and cosine > CLUSTER_COSINE:
                members.append(i)
        unused -= set(members)
        if len(members) >= MIN_MEMBERS:
            movers.append(members)
    movers.sort(key=len, reverse=True)
    paths = []
    for members in movers[:MAX_MOVERS]:
        path = []
        for step in range(steps):
            here = [tracks[i][1][tracks[i][0] == step][0] for i in members if step in tracks[i][0]]
            if here:
                x, y = np.median(np.array(here), axis=0)
                path.append((step, float(x), float(y)))
        paths.append(path)
    return paths


def camera_words(to_first: Matrix, width: int, height: int) -> str:
    centre = np.array([width / 2, height / 2, 1.0])
    dx, dy = (to_first @ centre)[:2] - centre[:2]
    scale = float(np.sqrt(abs(np.linalg.det(to_first[:2, :2]))))
    parts = []
    if abs(dx) >= 0.02 * width:
        parts.append(f"scene drifted {'right' if dx > 0 else 'left'} {abs(dx):.0f}px")
    if abs(dy) >= 0.02 * height:
        parts.append(f"scene drifted {'down' if dy > 0 else 'up'} {abs(dy):.0f}px")
    if abs(scale - 1) >= 0.03:
        parts.append(f"scene {'grew' if scale > 1 else 'shrank'} {scale:.2f}x")
    return "camera: " + (", ".join(parts) if parts else "about still")


def window_info(tracked: Tracked) -> tuple[float, float, Rgb, str]:
    final = tracked.frames[-1]
    height, width = final.shape[:2]
    camera = camera_words(tracked.to_last[0], width, height)
    return tracked.times[0], tracked.times[-1], final, camera


def path_windows(frames: list[Rgb], fps: float) -> list[PathWindow]:
    out = []
    width = frames[0].shape[1]
    for start, end in windows(frames, fps):
        tracked, paths = track_window(frames, fps, start, end)
        moving = moving_tracks(paths, tracked.to_last, width)
        movers = cluster_movers(moving, width, len(tracked.to_last))
        timed = [[(tracked.times[s], x, y) for s, x, y in mover] for mover in movers]
        out.append(PathWindow(*window_info(tracked), timed))
    return out


def warp(image: NDArray[np.generic], matrix: Matrix) -> NDArray[np.generic]:
    height, width = image.shape[:2]
    return cv2.warpAffine(image, matrix[:2], (width, height), flags=cv2.INTER_LINEAR)


def clean_mask(mask: Mask) -> Mask:
    opened = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
    keep = np.zeros(count, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= GHOST_MIN_AREA * mask.size
    return keep[labels]


def changed(image: Rgb, background: NDArray[np.float32], valid: Mask) -> Mask:
    diff = np.abs(image.astype(np.float32) - background).mean(axis=2)
    if not valid.any():
        return np.zeros(diff.shape, dtype=bool)
    level = float(np.median(diff[valid])) + GHOST_K * robust_spread(diff[valid])
    return clean_mask((diff > max(GHOST_MIN_DIFF, level)) & valid)


def ghost_window(tracked: Tracked) -> GhostWindow:
    final = tracked.frames[-1]
    height, width = final.shape[:2]
    ones = np.ones((height, width), np.uint8)
    warped = [
        (warp(frame, matrix), warp(ones, matrix) == 1)
        for frame, matrix in zip(tracked.frames, tracked.to_last, strict=True)
    ]
    stack = np.stack([np.where(valid[..., None], image, np.nan) for image, valid in warped])
    background = np.nan_to_num(np.nanmedian(stack.astype(np.float32), axis=0), nan=0.0)
    raw = np.stack([grey(frame).astype(np.float32) for frame in tracked.frames])
    screen_static = (raw.std(axis=0) < SCREEN_STATIC_STD).astype(np.uint8)
    final_moving = changed(final, background, np.ones((height, width), bool))
    last = len(tracked.frames) - 1
    ghosts = []
    for fraction in GHOST_FRACTIONS:
        i = round(fraction * last)
        image, valid = warped[i]
        static_here = warp(screen_static, tracked.to_last[i]) == 1
        mask = changed(image, background, valid) & ~final_moving & ~static_here
        ghosts.append((tracked.times[i], image, mask & (screen_static == 0)))
    covered = np.logical_or.reduce([mask for _, _, mask in ghosts]) | final_moving
    skipped = float(covered.mean()) > MAX_GHOST_AREA
    return GhostWindow(*window_info(tracked), [] if skipped else ghosts, skipped)


def ghost_windows(frames: list[Rgb], fps: float) -> list[GhostWindow]:
    return [
        ghost_window(track_window(frames, fps, start, end)[0])
        for start, end in windows(frames, fps)
    ]


def window_ends(frames: list[Rgb], fps: float) -> list[tuple[float, Rgb]]:
    return [(end / fps, frames[end]) for _, end in windows(frames, fps)]


# A camera that follows its subject gives scene paths longer than the frame; shrinking a path
# toward its end keeps its direction and shape on screen.
def fit_inside(path: Path2, width: int, height: int, margin: float = 12) -> tuple[Path2, bool]:
    _, end_x, end_y = path[-1]
    cx = min(max(end_x, margin), width - margin)
    cy = min(max(end_y, margin), height - margin)
    scale = 1.0
    for _, x, y in path:
        for offset, centre, size in ((x - end_x, cx, width), (y - end_y, cy, height)):
            if offset > 0:
                scale = min(scale, (size - margin - centre) / offset)
            elif offset < 0:
                scale = min(scale, (centre - margin) / -offset)
    fitted = [(t, cx + (x - end_x) * scale, cy + (y - end_y) * scale) for t, x, y in path]
    return fitted, scale < 0.99 or (cx, cy) != (end_x, end_y)
