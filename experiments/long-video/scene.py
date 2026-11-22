import itertools
import math
import time
from dataclasses import dataclass
from pathlib import Path

import av

FRAMES = 80
COVERAGE_SEGMENTS = 20
WINDOW_SECONDS = 3
# Keyframes this close to the longest regular gap are the encoder's forced cadence, not cuts.
CADENCE_SLACK = 0.25


@dataclass(frozen=True)
class PacketStats:
    duration: float
    keyframes: tuple[float, ...]
    inter_bytes: tuple[int, ...]
    demux_seconds: float

    def to_dict(self) -> dict[str, object]:
        return {
            "duration": self.duration,
            "keyframes": list(self.keyframes),
            "inter_bytes": list(self.inter_bytes),
            "demux_seconds": self.demux_seconds,
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "PacketStats":
        keyframes = data["keyframes"]
        inter = data["inter_bytes"]
        assert isinstance(keyframes, list) and isinstance(inter, list)
        return cls(
            float(str(data["duration"])),
            tuple(float(k) for k in keyframes),
            tuple(int(b) for b in inter),
            float(str(data["demux_seconds"])),
        )


def read_packet_stats(path: Path) -> PacketStats:
    started = time.perf_counter()
    keyframes: list[float] = []
    per_second: dict[int, int] = {}
    last = 0.0
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        base = float(stream.time_base or 0)
        for packet in container.demux(stream):
            if packet.pts is None:
                continue
            seconds = float(packet.pts) * base
            last = max(last, seconds)
            if packet.is_keyframe:
                keyframes.append(seconds)
            else:
                second = int(seconds)
                per_second[second] = per_second.get(second, 0) + packet.size
        duration = (
            float(stream.duration) * base
            if stream.duration
            else (container.duration or 0) / 1_000_000 or last
        )
    inter = tuple(per_second.get(s, 0) for s in range(math.ceil(duration)))
    return PacketStats(duration, tuple(sorted(keyframes)), inter, time.perf_counter() - started)


def even_times(duration: float, count: int = FRAMES) -> list[float]:
    return [i * duration / count for i in range(count)]


def cut_keyframes(keyframes: tuple[float, ...]) -> list[float]:
    gaps = [b - a for a, b in itertools.pairwise(keyframes)]
    if not gaps:
        return list(keyframes)
    cadence = sorted(gaps)[int(0.95 * (len(gaps) - 1))]
    cuts = [k for k, gap in zip(keyframes[1:], gaps, strict=True) if gap < cadence - CADENCE_SLACK]
    return cuts or list(keyframes)


def window_mean(values: tuple[int, ...], start: float, end: float) -> float:
    lo, hi = max(0, math.floor(start)), min(len(values), math.ceil(end))
    return sum(values[lo:hi]) / (hi - lo) if hi > lo else 0.0


# How much the stream's bitrate level changes across t: a cut or a new shot changes how much
# each inter frame has to encode.
def change_score(stats: PacketStats, t: float) -> float:
    before = window_mean(stats.inter_bytes, t - WINDOW_SECONDS, t)
    after = window_mean(stats.inter_bytes, t, t + WINDOW_SECONDS)
    return abs(math.log1p(after) - math.log1p(before))


def scored_candidates(stats: PacketStats) -> list[tuple[float, float]]:
    return [(t, change_score(stats, t)) for t in cut_keyframes(stats.keyframes)]


def pick_scene_times(
    duration: float,
    candidates: list[tuple[float, float]],
    count: int = FRAMES,
    segments: int = COVERAGE_SEGMENTS,
) -> list[float]:
    ranked = sorted(candidates, key=lambda c: (-c[1], c[0]))
    picks: list[float] = []
    segment = duration / segments
    for index in range(segments):
        lo, hi = index * segment, (index + 1) * segment
        inside = [t for t, _ in ranked if lo <= t < hi]
        picks.append(inside[0] if inside else lo + segment / 2)
    spacing = duration / (2 * count)
    for t, _ in ranked:
        if len(picks) >= count:
            break
        if all(abs(t - p) >= spacing for p in picks):
            picks.append(t)
    grid = even_times(duration, count)
    while len(picks) < count:
        farthest = max(grid, key=lambda g: min(abs(g - p) for p in picks))
        picks.append(farthest)
    return sorted(picks)
