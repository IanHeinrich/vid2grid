import json
import random
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import av
import pyarrow.parquet as pq

ROOT = Path(__file__).parent / "clips"
SOURCE = ROOT / "tempcompass"
VIDEOS = SOURCE / "videos" / "videos"
MANIFEST = ROOT / "tempcompass_manifest.json"
DIMS = ("direction", "speed", "order")
PER_DIM = 30
SEED = 7
REVERSE = "_reverse"


def probe(path: Path) -> tuple[float, float, bool]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        seconds = float(container.duration or 0) / 1_000_000
        return seconds, float(stream.average_rate or 0), bool(container.streams.audio)


def options(question: str) -> list[str]:
    return re.findall(r"^([A-Z])\. ", question, re.MULTILINE)


# Pairs of a video and its reversed copy come first, so reverse consistency can be read off.
def pick_videos(by_video: dict[str, list[dict[str, Any]]], rng: random.Random) -> list[str]:
    bases = sorted({v.removesuffix(REVERSE) for v in by_video})
    pairs = [b for b in bases if b in by_video and f"{b}{REVERSE}" in by_video]
    singles = sorted(v for v in by_video if v.removesuffix(REVERSE) not in pairs)
    rng.shuffle(pairs)
    rng.shuffle(singles)
    chosen: list[str] = []
    for base in pairs:
        if len(chosen) + 2 > PER_DIM:
            break
        chosen += [base, f"{base}{REVERSE}"]
    chosen += singles[: PER_DIM - len(chosen)]
    return chosen


def main() -> None:
    rows = pq.read_table(SOURCE / "multi-choice.parquet").to_pylist()
    manifest = []
    for dim in DIMS:
        rng = random.Random(f"{SEED}-{dim}")
        by_video: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            if row["dim"] == dim and (VIDEOS / f"{row['video_id']}.mp4").is_file():
                by_video[str(row["video_id"])].append(row)
        chosen = pick_videos(by_video, rng)
        for video_id in chosen:
            row = rng.choice(sorted(by_video[video_id], key=lambda r: r["question"]))
            letters = options(row["question"])
            answer = str(row["answer"]).strip()[:1]
            if answer not in letters:
                continue
            seconds, fps, audio = probe(VIDEOS / f"{video_id}.mp4")
            base = video_id.removesuffix(REVERSE)
            paired = video_id != base and base in chosen
            manifest.append(
                {
                    "id": f"tc_{dim}_{video_id}",
                    "kind": f"tc_{dim}",
                    "file": f"tempcompass/videos/videos/{video_id}.mp4",
                    "reverse_of": f"tc_{dim}_{base}" if paired else None,
                    "question": row["question"],
                    "options": letters,
                    "truth": {"answer": answer},
                    "fps": fps,
                    "seconds": seconds,
                    "audio": audio,
                }
            )
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    counts = {dim: sum(c["kind"] == f"tc_{dim}" for c in manifest) for dim in DIMS}
    pairs = sum(c["reverse_of"] is not None for c in manifest)
    print(f"{len(manifest)} questions {counts}, {pairs} reversed pairs, in {MANIFEST}")


if __name__ == "__main__":
    main()
