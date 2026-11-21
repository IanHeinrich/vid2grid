from itertools import pairwise

import numpy as np

from motion import (
    blobs,
    grid_digits,
    link_tracks,
    motion_step,
    phase_shift,
    quantise,
    region_energy,
    shift_words,
    shifts_to_last,
    track_v2,
)


def texture(h: int = 90, w: int = 160, seed: int = 1) -> np.ndarray:
    return np.random.default_rng(seed).uniform(0, 255, (h, w)).astype(np.float32)


def rgb(grey: np.ndarray) -> np.ndarray:
    return np.repeat(np.clip(grey, 0, 255).astype(np.uint8)[..., None], 3, axis=2)


def test_phase_shift_recovers_a_known_shift() -> None:
    reference = texture()
    moving = np.roll(reference, (-3, 5), axis=(0, 1))
    assert phase_shift(reference, moving) == (5, -3)


def test_static_pair_gives_zero_energy() -> None:
    frame = rgb(texture())
    step = motion_step(frame, frame, align=True)
    assert step.shift == (0, 0)
    assert grid_digits(step.grid) == "000|000|000"
    assert step.overall == 0.0


def test_moving_square_lights_the_right_cell() -> None:
    background = np.full((90, 150), 60.0, dtype=np.float32)
    earlier = background.copy()
    later = background.copy()
    earlier[10:20, 110:120] = 220
    later[10:20, 125:135] = 220
    step = motion_step(rgb(earlier), rgb(later), align=False, factor=1)
    digits = quantise(step.grid)
    assert digits[0, 2] > 0
    assert digits.sum() == digits[0, 2]


def test_aligned_pan_leaves_little_residual() -> None:
    scene = texture(90, 200)
    earlier = rgb(scene[:, 20:180])
    later = rgb(scene[:, 28:188])
    step = motion_step(earlier, later, align=True, factor=1)
    assert step.shift == (-8, 0)
    assert grid_digits(step.grid) == "000|000|000"
    assert shift_words(*step.shift) == "left 8px"


def test_region_energy_ignores_invalid_pixels() -> None:
    diff = np.full((6, 6), 9.0, dtype=np.float32)
    valid = np.zeros((6, 6), dtype=bool)
    valid[:2, :2] = True
    energy = region_energy(diff, valid)
    assert energy[0, 0] == 9.0
    assert energy[2, 2] == 0.0


def test_blobs_finds_each_region_centroid() -> None:
    mask = np.zeros((10, 12), dtype=bool)
    mask[1:4, 1:4] = True
    mask[6:9, 8:11] = True
    mask[0, 11] = True
    assert blobs(mask, min_area=2) == [(2.0, 2.0), (9.0, 7.0)]


def test_link_tracks_keeps_crossing_objects_apart() -> None:
    frames = []
    for step in range(6):
        mask = np.zeros((20, 40), dtype=bool)
        left_x, right_x = 2 + 6 * step, 34 - 6 * step
        mask[4:7, left_x : left_x + 3] = True
        mask[8:11, right_x : right_x + 3] = True
        frames.append(blobs(mask))
    tracks = link_tracks(frames, max_jump=15)
    assert len(tracks) == 2
    ends = sorted((t[0][1][0], t[-1][1][0]) for t in tracks)
    assert ends == [(3.0, 33.0), (35.0, 5.0)]
    assert all(len(t) == 6 for t in tracks)


def test_link_tracks_bridges_a_merged_blob() -> None:
    frames = [[(0.0, 5.0), (20.0, 5.0)], [(5.0, 5.0), (15.0, 5.0)], [(10.0, 5.0)]]
    frames += [[(15.0, 5.0), (5.0, 5.0)], [(20.0, 5.0), (0.0, 5.0)]]
    tracks = link_tracks(frames, max_jump=8)
    paths = sorted([p[0] for _, p in t] for t in tracks)
    assert paths == [[0.0, 5.0, 10.0, 15.0, 20.0], [20.0, 15.0, 5.0, 0.0]]


def test_link_tracks_follows_one_object_through_turns() -> None:
    xs = [0.0, 30.0, 60.0, 40.0, 10.0, 0.0, 35.0, 60.0]
    tracks = link_tracks([[(x, 5.0)] for x in xs], max_jump=40)
    assert len(tracks) == 1
    assert [p[0] for _, p in tracks[0]] == xs


def test_shifts_to_last_chains_neighbouring_shifts() -> None:
    scene = texture(90, 260)
    greys = [scene[:, 10 * k : 10 * k + 160] for k in range(6)]
    assert shifts_to_last(greys) == [(50, 0), (40, 0), (30, 0), (20, 0), (10, 0), (0, 0)]


def noisy(frame: np.ndarray, seed: int, gain: float = 1.0) -> np.ndarray:
    noise = np.random.default_rng(seed).normal(0, 8, frame.shape)
    return rgb(frame * gain + noise)


def smooth_texture(h: int, w: int, seed: int = 1) -> np.ndarray:
    coarse = texture(h // 8, w // 8, seed)
    return np.kron(coarse, np.ones((8, 8), dtype=np.float32)) * 0.6 + 50


def test_v2_static_noisy_flickering_clip_shows_no_motion() -> None:
    scene = smooth_texture(180, 320)
    frames = [noisy(scene, seed, gain=1.15 if seed % 2 else 0.9) for seed in range(7)]
    track = track_v2(list(pairwise(frames)))
    assert all(digits == "000|000|000" for _, digits in track)
    assert all(shift == (0, 0) for shift, _ in track)


def test_v2_pan_gives_camera_shift_and_quiet_cells() -> None:
    scene = smooth_texture(180, 480)
    frames = [noisy(scene[:, 16 * k : 16 * k + 320], seed=k) for k in range(7)]
    track = track_v2(list(pairwise(frames)))
    assert all(shift == (-16, 0) for shift, _ in track)
    assert all(digits == "000|000|000" for _, digits in track)


def test_v2_moving_object_lights_only_its_cells() -> None:
    scene = smooth_texture(180, 320)
    frames = []
    for k in range(7):
        frame = scene.copy()
        x = 220 + 12 * k
        frame[20:44, x : x + 24] = 250
        frames.append(noisy(frame, seed=k))
    track = track_v2(list(pairwise(frames)))
    for _, digits in track:
        top, middle, bottom = digits.split("|")
        assert top[2] != "0"
        assert top[:2] == "00"
        assert middle == bottom == "000"
