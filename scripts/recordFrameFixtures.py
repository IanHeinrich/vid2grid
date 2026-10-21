# Records fixtures/frames/ by applying the pick rule to a plain decode of every source frame,
# then refuses to write if the Python package's capture picks differently. Run by hand, from
# apps/python-library/:
#   uv run python ../../scripts/recordFrameFixtures.py
import json
import math
from pathlib import Path
from typing import Any

import av

from vid2grid import build_render_plan, capture, probe_video
from vid2grid.contract import CollagePlanRequest

REPO_ROOT = Path(__file__).resolve().parents[1]
TINY = "fixtures/videos/tiny.mp4"
KEYFRAMES_20S = "fixtures/videos/keyframes-20s.mp4"
OUT_DIR = REPO_ROOT / "fixtures" / "frames"


def _request(start: float, end: float, fps: float, *, keyframes: bool = False) -> dict[str, Any]:
    return {
        "startSeconds": start,
        "endSeconds": end,
        "targetFps": fps,
        **({"keyframeSampling": True} if keyframes else {}),
        "framesPerGrid": 4,
        "outputResolution": 512,
        "jpegQuality": 85,
    }


CASES = {
    "tiny-fps4": (TINY, _request(0, 3, 4)),
    "tiny-fps7-from-0.25-to-2.95": (TINY, _request(0.25, 2.95, 7)),
    "tiny-fps3": (TINY, _request(0, 3, 3)),
    "tiny-keyframes": (TINY, _request(0, 3, 1, keyframes=True)),
    # A sampled plan probes no keyframes, so capture reseeks past its default 4 s gap.
    "keyframes-20s-fps0.22": (KEYFRAMES_20S, _request(0, 20, 0.22)),
    "keyframes-20s-fps3-from-5.25-to-9.75": (KEYFRAMES_20S, _request(5.25, 9.75, 3)),
    "keyframes-20s-keyframes-from-2.5-to-9.5": (
        KEYFRAMES_20S,
        _request(2.5, 9.5, 1, keyframes=True),
    ),
}


def _round_to_microseconds(seconds: float) -> float:
    return math.floor(seconds * 1e6 + 0.5) / 1e6


# JSON.stringify writes 1.0 as 1, so integral floats are written the same way here.
def _like_javascript(value: Any) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _like_javascript(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_like_javascript(item) for item in value]
    return value


def _all_source_frame_seconds(path: Path) -> list[float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        assert stream.time_base is not None
        return sorted(
            _round_to_microseconds(float(frame.pts * stream.time_base))
            for frame in container.decode(stream)
            if frame.pts is not None
        )


def _first_at_or_after(source: list[float], planned: float, name: str) -> int:
    for index, seconds in enumerate(source):
        if seconds >= planned:
            return index
    raise SystemExit(f"{name}: no source frame at or after {planned}")


def _record(name: str, video: str, request_json: dict[str, Any]) -> dict[str, Any]:
    path = REPO_ROOT / video
    info = probe_video(path, keyframes=request_json.get("keyframeSampling", False))
    plan = build_render_plan(CollagePlanRequest.from_dict(request_json), info)
    source = _all_source_frame_seconds(path)
    picks = [_first_at_or_after(source, frame.timestamp_seconds, name) for frame in plan.frames]
    expected = [source[index] for index in picks]

    captured = [
        _round_to_microseconds(frame.time) for frame in capture.iter_source_frames(path, plan, info)
    ]
    if captured != expected:
        raise SystemExit(f"{name}: capture picked {captured}, the pick rule gives {expected}")

    # From the last frame before the first planned time, so a reader can see each pick is first.
    window_start = max(picks[0] - 1, 0) if picks else 0
    window_end = picks[-1] + 1 if picks else 0
    return {
        "name": name,
        "video": video,
        "request": request_json,
        "info": info.to_dict(),
        "sourceFrameSeconds": source[window_start:window_end],
        "frames": [
            {
                "frameIndex": frame.frame_index,
                "plannedSeconds": frame.timestamp_seconds,
                "decodedSeconds": decoded_seconds,
            }
            for frame, decoded_seconds in zip(plan.frames, expected, strict=True)
        ],
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, (video, request_json) in CASES.items():
        fixture = _like_javascript(_record(name, video, request_json))
        text = json.dumps(fixture, indent=2) + "\n"
        (OUT_DIR / f"{name}.json").write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote fixtures/frames/{name}.json")


if __name__ == "__main__":
    main()
